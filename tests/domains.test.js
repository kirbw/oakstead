const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const { createTransactionalService } = require('../server/domains/service');
const { createDomainRoutes } = require('../server/domains/routes');
const { text, redirectTo } = require('../server/domains/results');
const { createAcademicAccess } = require('../server/domains/academic-access');
const { asInt, sqlValue } = require('../server/input');
const { schoolFixture } = require('./helpers/school');

test('domain services validate before dispatch and roll back rejected or failed operations', () => {
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(value TEXT)');
  const repository={transaction(fn){db.exec('SAVEPOINT domain');try{const value=fn();db.exec('RELEASE domain');return value;}catch(error){db.exec('ROLLBACK TO domain; RELEASE domain');throw error;}}};
  const service=createTransactionalService(['/records'],(_,body)=>{
    db.prepare('INSERT INTO records(value) VALUES(?)').run(body.value);
    if(body.fail)throw Error('Injected failure');
    return body.reject ? text(400,'Invalid') : redirectTo('/records');
  },repository);
  try {
    assert.equal(service.execute('/other',{},{}),null);
    assert.throws(()=>service.execute('/records',null,{}),{statusCode:400});
    assert.equal(service.execute('/records',{value:'rejected',reject:true},{}).status,400);
    assert.throws(()=>service.execute('/records',{value:'failed',fail:true},{}),/Injected/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n,0);
    assert.deepEqual(service.execute('/records',{value:'saved'},{}),redirectTo('/records'));
    assert.equal(db.prepare('SELECT value FROM records').get().value,'saved');
  } finally {db.close();}
});

test('transport adapter emits a response only after the domain operation commits', async () => {
  const events=[];
  const service={paths:new Set(['/one']),execute(){events.push('commit');return text(200,'Saved',{'X-Test':'yes'});}};
  const routes=createDomainRoutes({services:[service],sendText:(res,status,body,headers)=>events.push([status,body,headers]),sendJson(){},redirect(){}});
  assert.equal(await routes.handle({}, {}, '/missing', {}, {}, {}),false);
  assert.equal(await routes.handle({}, {}, '/one', {}, {}, {'X-Request':'id'}),true);
  assert.deepEqual(events,['commit',[200,'Saved',{'X-Request':'id','X-Test':'yes'}]]);
  const cookies = createDomainRoutes({services:[{paths:new Set(['/cookie']),execute:()=>text(200,'ok',{'Set-Cookie':'session=value'})}],
    sendText:(_,status,body,headers)=>assert.deepEqual(headers['Set-Cookie'],['csrfToken=token','session=value'])});
  await cookies.handle({}, {}, '/cookie', {}, {}, {'Set-Cookie':'csrfToken=token'});
  assert.throws(()=>createDomainRoutes({services:[service,service]}),/Duplicate/);
});

test('academic services authorize actual assignments and students without an HTTP request', async (t) => {
  const app=await schoolFixture(t);
  const access=createAcademicAccess({repository:{querySql:(sql,parameters=[])=>app.withDb(db=>db.prepare(sql).all(...parameters))},asInt,sqlValue,
    isAdmin:user=>user.role==='admin',isPrincipal:user=>user.role==='principal',isTeacher:user=>user.role==='teacher',isParent:user=>user.role==='parent'});
  const teacher={role:'teacher',teacher_id:101};
  assert.equal(access.authorizedAssignments(teacher,1,'1',101,[101]).get(101).title,'Allowed assignment');
  assert.throws(()=>access.authorizedAssignments(teacher,1,'1',101,[102]),{statusCode:403});
  assert.throws(()=>access.authorizedAssignments(teacher,1,'1',101,[103]),{statusCode:403});
  assert.throws(()=>access.requireScoreStudents(teacher,1,'1',[103]),{statusCode:403});
});

test('extracted client asset parses and retains CSP-compatible content-hash delivery', () => {
  const {STATIC_ASSETS,APP_CLIENT_SCRIPT_VERSION}=require('../server/assets');
  const script=STATIC_ASSETS.get('/assets/app.js');
  assert.doesNotThrow(()=>new vm.Script(script.body.toString('utf8')));
  assert.equal(require('node:crypto').createHash('sha256').update(script.body).digest('hex').slice(0,8),APP_CLIENT_SCRIPT_VERSION);
  assert.deepEqual(require('node:zlib').gunzipSync(script.gzipped),script.body);
});
