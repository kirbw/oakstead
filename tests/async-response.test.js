const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createHttpHelpers, acceptsGzip } = require('../server/http');
const { createPasswordHasher, createPasswordVerifier } = require('../server/passwords');
const { schoolFixture } = require('./helpers/school');
const response = () => ({ writeHead(code, headers) { this.code=code;this.headers=headers; }, end(body) { this.body=body;this.writableEnded=true; } });

test('HTML compression is bounded, falls back safely, and respects disconnects and negotiation', async () => {
  const jobs=[];
  const helpers=createHttpHelpers({ escapeHtml:String,maxBodySize:100,gzip:(body,done)=>jobs.push({body,done}) });
  const request={headers:{'accept-encoding':'gzip'}};
  const replies=Array.from({length:5},response);
  const pending=replies.map(res=>helpers.sendHtml(request,res,'<p>hello</p>'));
  assert.equal(jobs.length,4);
  assert.equal(replies[4].body,'<p>hello</p>');
  assert.equal(replies[0].headers,undefined,'headers wait for compression');
  replies[2].destroyed=true;
  jobs.forEach((job,i)=>job.done(i===1?Error('injected'):null,zlib.gzipSync(job.body)));
  await Promise.all(pending);
  assert.equal(zlib.gunzipSync(replies[0].body).toString(),'<p>hello</p>');
  assert.equal(replies[1].body,'<p>hello</p>');
  assert.equal(replies[1].headers['Content-Encoding'],undefined);
  assert.equal(replies[2].headers,undefined);
  assert.equal(acceptsGzip({headers:{'accept-encoding':'gzip;q=0, *;q=1'}}),false);
  assert.equal(acceptsGzip({headers:{'accept-encoding':'br, gzip;q=0.5'}}),true);
});

test('password hashing preserves verification format and bounds work without a queue', async () => {
  const hash=await createPasswordHasher()('fixture');
  assert.equal(await createPasswordVerifier()('fixture',hash),true);
  let finish;
  const hasher=createPasswordHasher({concurrency:1,scrypt:(_,salt,length,done)=>{finish=done;}});
  const pending=hasher('one');
  await assert.rejects(hasher('two'),{statusCode:503});
  finish(null,Buffer.alloc(64));
  assert.match(await pending,/^[a-f0-9]{32}:[a-f0-9]{128}$/);
});

test('slow compression falls back without freeing a still-active worker slot', async () => {
  const jobs=[];
  const helpers=createHttpHelpers({escapeHtml:String,maxBodySize:100,gzip:(_,done)=>jobs.push(done)});
  const req={headers:{'accept-encoding':'gzip'}};
  const replies=Array.from({length:4},response);
  await Promise.all(replies.map(res=>helpers.sendHtml(req,res,'slow')));
  assert.ok(replies.every(res=>res.body==='slow' && !res.headers['Content-Encoding']));
  const next=response();
  await helpers.sendHtml(req,next,'next');
  assert.equal(jobs.length,4,'timed-out work still counts against concurrency');
  jobs.forEach(done=>done(null,Buffer.from('late result')));
  assert.ok(replies.every(res=>res.body==='slow'),'late callbacks cannot send another response');
});

test('busy request admission skips compression and real gzip pages preserve content and headers', async t => {
  const helpers=createHttpHelpers({escapeHtml:String,maxBodySize:100,canCompress:()=>false,gzip:()=>assert.fail('busy app must not start compression')});
  const reply=response();
  await helpers.sendHtml({headers:{'accept-encoding':'gzip'}},reply,'busy');
  assert.equal(reply.body,'busy');
  const app=await schoolFixture(t);
  const request=encoding=>app.request('/',{headers:{Cookie:app.cookie('admin').replace('csrfToken=fixture', 'csrfToken='+'a'.repeat(48)),'Accept-Encoding':encoding}});
  const plain=await request('identity');
  const plainHtml=await plain.text();
  const compressed=await request('gzip');
  assert.equal(compressed.headers.get('content-encoding'),'gzip');
  assert.equal(await compressed.text(),plainHtml);
  assert.equal(compressed.headers.get('cache-control'),'no-store');
  assert.equal(compressed.headers.get('vary'),'Accept-Encoding');
  assert.equal(compressed.headers.get('content-security-policy'),plain.headers.get('content-security-policy'));
});

test('account save rechecks actor and target after asynchronous hashing', async t => {
  const app=await schoolFixture(t);
  const {createAdministrationService}=require('../server/domains/administration');
  for(const change of ['actor','target']) {
    let finish;
    const actor={id:1,role:'admin'};
    let target={id:101,role:'teacher',name:'Before'};
    let writes=0,inTransaction=false;
    const repository={querySql:()=>[target],runSql:()=>{assert.equal(inTransaction,true);writes++;},transaction:fn=>{inTransaction=true;try{return fn();}finally{inTransaction=false;}}};
    const service=createAdministrationService({repository,ROLES:['admin','principal','teacher','parent'],ROLE_ADMIN:'admin',ROLE_PRINCIPAL:'principal',ROLE_TEACHER:'teacher',ROLE_PARENT:'parent',asInt:Number,cleanText:v=>String(v||''),sqlValue:JSON.stringify,canManageSchoolUsers:u=>u?.role==='admin',canManageAdminUsers:u=>u?.role==='admin',currentUser:()=>actor,hashPassword:()=>{assert.equal(inTransaction,false);return new Promise(resolve=>{finish=resolve;});}});
    const pending=service.execute('/users',{userId:101,role:'teacher',teacherId:101,password:'new'},actor,{});
    if(change==='actor')actor.role='teacher';else target={...target,name:'Changed'};
    finish('encoded');
    assert.equal((await pending).status,change==='actor'?403:409);
    assert.equal(writes,0);
  }
  const created=await app.post('/users',{name:'New account',username:'async-created',role:'teacher',teacherId:101,password:'fixture-new'},'admin');
  assert.equal(created.status,302);
  const hash=app.withDb(db=>db.prepare("SELECT password_hash FROM os_users WHERE username='async-created'").get()).password_hash;
  assert.equal(await createPasswordVerifier()('fixture-new',hash),true);
});
