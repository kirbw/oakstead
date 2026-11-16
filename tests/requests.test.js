const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBrowserRequest } = require('../server/browser-request');
const { createHttpHelpers } = require('../server/http');
const { schoolFixture } = require('./helpers/school');

function response(status, body, type='application/json', url='http://localhost/gradebook') {
  return {status,ok:status<400,url,headers:new Headers({'Content-Type':type,'X-Request-ID':'fixture-id'}),text:async()=>body};
}

test('browser requests classify safe errors, field errors, malformed responses and lost authentication', async () => {
  let calls=0,auth=0;
  const cases=[
    [response(400,JSON.stringify({error:'Invalid score',problem:{fields:{score_1:'Enter a number'}}})),/Invalid score/,400],
    [response(403,'{}'),/could not be completed/,403],
    [response(200,'<html>login</html>','text/html','http://localhost/login'),/session ended/,401],
    [response(200,'not json'),/unreadable response/,200],
    [response(200,'<html>unexpected</html>','text/html'),/unexpected response/,200]
  ];
  for(const [next,pattern,status] of cases) {
    const request=createBrowserRequest({fetch:async()=>{calls++;return next;},onAuthLoss:()=>auth++});
    await assert.rejects(request('/gradebook',{method:'POST'}),error=>{
      assert.match(error.message,pattern);assert.equal(error.status,status);
      if(status===400){assert.equal(error.requestId,'fixture-id');assert.equal(error.fields.score_1,'Enter a number');}
      return true;
    });
  }
  assert.equal(auth,1);assert.equal(calls,cases.length,'no automatic mutation retries');
});

test('browser timeout aborts stalled fetch and stalled response bodies', async () => {
  for(const bodyStalled of [false,true]) {
    const request=createBrowserRequest({timeoutMs:10,fetch:(_,options)=>{
      const pending=new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Aborted'),{name:'AbortError'}))));
      return bodyStalled ? {ok:true,status:200,headers:new Headers(),text:()=>pending} : pending;
    }});
    await assert.rejects(request('/gradebook',{method:'POST'}),/timed out/);
  }
});

test('body limits reject declared and streamed oversize bodies without destroying the request', async () => {
  const {parseBody}=createHttpHelpers({escapeHtml:String,maxBodySize:100});
  for(const declared of [true,false]) {
    const req=Readable.from([Buffer.alloc(60),Buffer.alloc(60)]);
    req.headers={'content-type':'application/x-www-form-urlencoded',...(declared?{'content-length':'120'}:{})};
    await assert.rejects(parseBody(req),{statusCode:413});
  }
});

test('real errors include request IDs, preserve success fields, protect details and disable personalized caching', async (t) => {
  const app=await schoolFixture(t);
  const jsonPost=(url,fields,cookie=app.cookie('admin'))=>app.request(url,{method:'POST',headers:{Cookie:cookie,Accept:'application/json'},body:new URLSearchParams({csrfToken:'fixture',schoolYearId:'1',gradeLevel:'1',subjectId:'101',markingPeriodId:'1',...fields})});
  const invalid=await jsonPost('/marking-periods',{startDate:'2026-08-15',endDate:'2026-01-01'});
  assert.equal(invalid.status,400);assert.equal(invalid.headers.get('cache-control'),'no-store');
  const problem=await invalid.json();assert.equal(problem.ok,false);assert.ok(problem.problem.fields.endDate);assert.equal(problem.requestId,invalid.headers.get('x-request-id'));
  const denied=await jsonPost('/users',{},app.cookie('teacher'));assert.equal(denied.status,403);assert.equal((await denied.json()).problem.status,403);
  const lost=await jsonPost('/gradebook',{},'csrfToken=fixture');assert.equal(lost.status,401);assert.match((await lost.json()).error,/session ended/);
  const oversized=await app.request('/gradebook',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:'x'.repeat(1024*1024+1)});
  assert.equal(oversized.status,413);assert.equal((await oversized.json()).problem.status,413);
  app.withDb(db=>db.exec("CREATE TRIGGER failing_score BEFORE INSERT ON os_scores BEGIN SELECT RAISE(ABORT,'private database contents'); END;"));
  const failure=await jsonPost('/gradebook',{action:'grid-score',assignmentId:'101',studentId:'101',scoreValue:'90'});
  assert.equal(failure.status,500);assert.doesNotMatch(await failure.text(),/private database|RAISE|stack|SQLITE/);
  app.withDb(db=>db.exec('DROP TRIGGER failing_score'));
  const saved=await jsonPost('/gradebook',{action:'grid-score',assignmentId:'101',studentId:'101',scoreValue:'0',scoreMode:'percent'});
  assert.equal(saved.status,200);assert.equal((await saved.json()).percent,0);
  assert.equal((await app.request('/',{headers:{Cookie:app.cookie('teacher')}})).headers.get('cache-control'),'no-store');
  assert.match((await app.request('/assets/app.js')).headers.get('cache-control'),/immutable/);
});
