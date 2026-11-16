const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLifecycle, stopHttpServer, installShutdownSignals, restartAfterDrain } = require('../server/lifecycle');

test('partial startup unwinds every attempted resource in reverse order', async () => {
  for (const failureAt of [0,1,2]) {
    const events=[];
    const app=createLifecycle(['db','jobs','http'].map((name,index)=>({name,start(){events.push('start '+name);if(index===failureAt)throw Error('Injected');},stop(){events.push('stop '+name);}})));
    await assert.rejects(app.start(),/Injected/);
    assert.equal(app.state(),'failed');
    assert.deepEqual(events,['db','jobs','http'].slice(0,failureAt+1).map(n=>'start '+n).concat(['db','jobs','http'].slice(0,failureAt+1).reverse().map(n=>'stop '+n)));
    await app.stop();await app.stop();
    assert.equal(events.length,(failureAt+1)*2);
  }
});

test('start/stop are idempotent, wait for startup, and continue cleanup after failures', async () => {
  let release;const entered=new Promise(resolve=>{release=resolve;});let starts=0,stops=0;
  const app=createLifecycle([{name:'resource',async start(){starts++;await entered;},stop(){stops++;}}]);
  const started=app.start();const stopped=app.stop();release();await started;await stopped;
  await app.stop();assert.equal(starts,1);assert.equal(stops,1);
  await app.start();await app.start();await app.stop();assert.equal(starts,2);assert.equal(stops,2);
  const events=[];
  const failing=createLifecycle([{name:'db',start(){},stop(){events.push('db');}},{name:'jobs',start(){},stop(){events.push('jobs');throw Error('Cleanup');}}]);
  await failing.start();await assert.rejects(failing.stop(),/cleanup failed/);assert.deepEqual(events,['jobs','db']);
});

test('HTTP shutdown stops jobs immediately, drains pending requests and releases its port', async (t) => {
  let finish,received;const pending=new Promise(resolve=>{received=resolve;});
  const server=http.createServer((req,res)=>{res.setHeader('Connection','close');finish=()=>res.end('completed');received();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const port=server.address().port;
  const response=fetch(`http://127.0.0.1:${port}/`);await pending;
  let jobsStopped=false,drained=false;
  const stop=stopHttpServer(server,{beforeDrain:()=>{jobsStopped=true;}}).then(()=>{drained=true;});
  assert.equal(jobsStopped,true);assert.equal(server.listening,false);assert.equal(drained,false);
  finish();assert.equal(await (await response).text(),'completed');await stop;
  const replacement=http.createServer();replacement.listen(port,'127.0.0.1');await once(replacement,'listening');await new Promise(resolve=>replacement.close(resolve));
});

test('stalled HTTP requests are forced closed after the configured grace period', async (t) => {
  let received;const pending=new Promise(resolve=>{received=resolve;});
  const server=http.createServer(()=>received());server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const response=fetch(`http://127.0.0.1:${server.address().port}/`).catch(error=>error);await pending;
  let forced=0;await stopHttpServer(server,{graceMs:20,onForced:()=>forced++});
  assert.equal(forced,1);assert.ok((await response) instanceof Error);
});

test('signals stop once and replacement starts only after draining', async () => {
  const fake=new EventEmitter();let exits=[];fake.exit=code=>exits.push(code);let stops=0;
  const cleanup=installShutdownSignals({async stop(){stops++;}},fake);
  fake.emit('SIGINT');fake.emit('SIGTERM');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stops,1);assert.deepEqual(exits,[0]);cleanup();assert.equal(fake.listenerCount('SIGTERM'),0);
  for(const supervised of [false,true]) {
    const events=[];await restartAfterDrain({supervised,stop:async()=>events.push('stop'),spawnReplacement:()=>events.push('spawn'),exit:()=>events.push('exit')});
    assert.deepEqual(events,supervised?['stop','exit']:['stop','spawn','exit']);
  }
});

test('real application import is inert; repeated API start/stop clears timers and reopens database', (t) => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-lifecycle-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source=`const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
    (async()=>{const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));process.env.PORT=String(probe.address().port);await new Promise(resolve=>probe.close(resolve));
    const timers=new Set(),set=global.setInterval,clear=global.clearInterval;
    global.setInterval=(...args)=>{const timer=set(...args);timers.add(timer);return timer;};global.clearInterval=timer=>{timers.delete(timer);clear(timer);};
    const {createApplication}=require('./server');assert.equal(fs.existsSync(process.env.DB_FILE),false);assert.equal(timers.size,0);
    const app=createApplication();assert.equal(app.state(),'created');
    for(let i=0;i<2;i++){await app.start();assert.equal(app.state(),'ready');assert.equal(timers.size,1);assert.equal((await fetch('http://127.0.0.1:'+process.env.PORT+'/login')).status,200);await app.stop();await app.stop();assert.equal(timers.size,0);assert.equal(app.state(),'stopped');}
    const blocker=net.createServer();await new Promise(resolve=>blocker.listen(Number(process.env.PORT),'127.0.0.1',resolve));
    await assert.rejects(app.start(),/EADDRINUSE/);assert.equal(timers.size,0);assert.equal(app.state(),'failed');await new Promise(resolve=>blocker.close(resolve));
    await app.start();await app.stop();assert.equal(timers.size,0);
    const db=new(require('node:sqlite').DatabaseSync)(process.env.DB_FILE);assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
    console.log('Lifecycle complete');})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result=spawnSync(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',DEMO_MODE:'0',OAKSTEAD_DATA_DIR:directory,DB_FILE:path.join(directory,'school.db')},windowsHide:true,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Lifecycle complete/);
  const cli=spawnSync(process.execPath,['server.js','--network-status'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:'3000',DEMO_MODE:'0',OAKSTEAD_DATA_DIR:directory,DB_FILE:path.join(directory,'school.db')},windowsHide:true,encoding:'utf8',timeout:5000});
  assert.equal(cli.status,0,cli.stderr);assert.doesNotMatch(cli.stdout,/Oakstead running on/);
});
