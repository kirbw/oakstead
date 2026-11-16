const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDb } = require('../server/db');
const { createOperationalMonitor, databaseReady, sqlOperation } = require('../server/operations');
const { schoolFixture } = require('./helpers/school');

test('operational aggregates are bounded and logs never retain raw paths, SQL or parameters', () => {
  const logs=[];
  const monitor=createOperationalMonitor({log:entry=>logs.push(entry),maxRoutes:8});
  monitor.configureRoutes(Array.from({length:100},(_,i)=>'/route-'+i));
  for(let i=0;i<1000;i++)monitor.recordRequest({requestId:'generated',method:i%2?'GET':'SECRET',pathname:'/route-'+i,status:200,durationMs:5,password:'private-password'});
  monitor.recordQuery({operation:'SELECT private-password',durationMs:101,sql:'private-records'});
  monitor.recordQuery({operation:'SELECT',durationMs:100});
  assert.equal(monitor.snapshot().requests.count,1000);
  assert.ok(monitor.snapshot().routes.length<=8);
  assert.equal(logs.filter(entry=>entry.event==='database.slow').length,1);
  assert.doesNotMatch(JSON.stringify(logs),/private-password|private-records|SECRET|route-999/);
  assert.equal(sqlOperation("SELECT password_hash FROM os_users WHERE username='private-password'"),'SELECT');
  assert.equal(sqlOperation('CREATE TABLE secret(id INTEGER)'),'DDL');
  assert.equal(sqlOperation('WITH grades AS (SELECT 1) SELECT * FROM grades'),'SELECT');
});

test('readiness refuses closed/starting/stopping/failed databases without reopening them', () => {
  let calls=0;
  const options={isOpen:()=>true,query:()=>{calls++;return [{ready:1}];}};
  for(const state of ['created','starting','stopping','stopped','failed'])assert.equal(databaseReady({...options,state}),false);
  assert.equal(calls,0);
  assert.equal(databaseReady({...options,state:'ready',isOpen:()=>false}),false);
  assert.equal(databaseReady({...options,state:'ready'}),true);
  assert.equal(databaseReady({...options,state:'ready',query:()=>{throw Error('Private failure');}}),false);
});

test('database timing observes successful and failed calls without changing results', (t) => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-query-metrics-'));
  const logs=[];let clock=0;
  const monitor=createOperationalMonitor({log:entry=>logs.push(entry)});
  const db=createDb({dbFile:path.join(directory,'fixture.db'),onQuery:monitor.recordQuery,now:()=>{clock+=150;return clock;}});
  t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  db.runSql('CREATE TABLE records(value TEXT)');
  db.runSql("INSERT INTO records(value) VALUES('private-student-score')");
  assert.equal(db.querySql('SELECT value FROM records')[0].value,'private-student-score');
  assert.throws(()=>db.querySql('SELECT missing FROM records'),/missing/);
  assert.equal(monitor.snapshot().database.count,4);
  assert.equal(monitor.snapshot().database.failures,1);
  assert.doesNotMatch(JSON.stringify(logs),/private-student|records|missing/);
});

test('public health is minimal; operational diagnostics are admin-only and retain backup failures', async (t) => {
  const app=await schoolFixture(t);
  const health=await app.request('/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ready'});
  assert.equal(health.headers.get('cache-control'),'no-store');assert.equal(health.headers.getSetCookie().length,0);
  for(const role of ['teacher','principal','parent'])assert.equal((await app.request('/system/operations',{headers:{Cookie:app.cookie(role)}})).status,403);
  for(const role of ['admin','principal']) {
    const settings=await (await app.request('/setup?section=settings',{headers:{Cookie:app.cookie(role)}})).text();
    assert.equal(settings.includes('href="/system/operations"'),role==='admin');
  }
  const admin=()=>app.request('/system/operations',{headers:{Cookie:app.cookie('admin')}});
  assert.match(await (await admin()).text(),/Database ready/);
  await app.request('/private-student-score?password=private-password',{headers:{Cookie:app.cookie('admin')}});
  app.withDb(db=>db.exec("CREATE TRIGGER backup_fail BEFORE INSERT ON os_settings WHEN NEW.key='backup_last_at' BEGIN SELECT RAISE(ABORT,'private-storage-details'); END;"));
  assert.equal((await app.post('/backup/create',{},'admin')).status,500);
  const failed=await (await admin()).text();assert.match(failed,/Failed; check backup storage and retry/);assert.match(failed,/Latest failure since startup:/);assert.doesNotMatch(failed,/private-storage/);
  app.withDb(db=>db.exec('DROP TRIGGER backup_fail'));
  assert.equal((await app.post('/backup/create',{},'admin')).status,302);
  const recovered=await (await admin()).text();assert.match(recovered,/Latest result since startup: Succeeded/);assert.doesNotMatch(recovered,/Latest failure since startup: None/);
  assert.doesNotMatch(app.logs(),/private-student-score|private-password|private-storage-details|fixture-admin/);
  assert.match(app.logs(),/"route":"\/other"/);
});

test('real public readiness returns 503 on database probe failure without exposing its cause', (t) => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-readiness-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source=`const assert=require('node:assert/strict'),net=require('node:net');
    (async()=>{const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));process.env.PORT=String(probe.address().port);await new Promise(resolve=>probe.close(resolve));
    const {DatabaseSync}=require('node:sqlite'),prepare=DatabaseSync.prototype.prepare;let fail=false;
    DatabaseSync.prototype.prepare=function(sql){if(fail && sql==='SELECT 1 AS ready;')throw Error('private-storage-failure');return prepare.call(this,sql);};
    const app=require('./server').createApplication();await app.start();
    const url='http://127.0.0.1:'+process.env.PORT+'/health';assert.equal((await fetch(url)).status,200);
    fail=true;const response=await fetch(url);assert.equal(response.status,503);assert.deepEqual(await response.json(),{status:'unavailable'});
    fail=false;assert.equal((await fetch(url)).status,200);await app.stop();})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result=spawnSync(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',DEMO_MODE:'0',OAKSTEAD_DATA_DIR:directory,DB_FILE:path.join(directory,'school.db')},windowsHide:true,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout,/private-storage-failure/);
});

