const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notice, emptyState, field, button } = require('../server/ui');
const { schoolFixture } = require('./helpers/school');

test('shared UI states escape content and distinguish error, loading and empty results', () => {
  const hostile='<script>alert("unsafe")</script>';
  for(const html of [notice({kind:'error',message:hostile}),emptyState(hostile),field({name:'name',label:'Name',value:hostile}),button({label:hostile,attributes:{onclick:'unsafe'}})]) {
    assert.doesNotMatch(html,/<script>|onclick=/);
    assert.match(html,/&lt;script&gt;/);
  }
  assert.match(notice({kind:'error',message:'Failed'}),/data-ui-state="error" role="alert"/);
  assert.match(notice({kind:'loading',message:'Loading'}),/data-ui-state="loading" role="status"/);
  assert.match(emptyState('No grades yet'),/data-ui-state="empty"/);
  assert.doesNotMatch(emptyState('No grades yet'),/role="alert"/);
  const invalid=field({name:'endDate',label:'End',description:'Calendar date',error:'Must follow start'});
  assert.match(invalid,/for="field-endDate"/);
  assert.match(invalid,/aria-invalid="true" aria-describedby="field-endDate-hint field-endDate-error"/);
  assert.doesNotMatch(field({name:'password',label:'Password',type:'password',value:'private-password'}),/private-password/);
});

test('all Setup sections preserve forms and expose their selected navigation state for allowed roles', async (t) => {
  const app=await schoolFixture(t);
  const sections=['families','districts','congregations','teachers','classrooms','subjects','years','weights','letter-grades','users','settings','network','backups','updates'];
  for(const role of ['admin','principal'])for(const section of sections) {
    const page=await app.request('/setup?section='+section,{headers:{Cookie:app.cookie(role)}});
    assert.equal(page.status,200,role+'/'+section);
    const html=await page.text();
    assert.match(html,new RegExp(`href="/setup\\?section=${section}" aria-current="page"`));
    assert.doesNotMatch(html,/view-loading-status|Loading view/);
    assert.match(html,/method="post"/);
  }
  const badLogin=await (await app.request('/login?error=1')).text();
  assert.match(badLogin,/data-ui-state="error" role="alert"/);
  assert.match(badLogin,/autocomplete="current-password" required/);
  const empty=await (await app.request('/setup?section=congregations',{headers:{Cookie:app.cookie('admin')}})).text();
  assert.match(empty,/data-ui-state="empty"/);
  for (const [route, section] of [['/congregations','congregations'], ['/school-districts','districts']]) {
    assert.equal((await app.post(route,{name:'Browser QA record'},'principal')).status,302);
    const populated=await app.request('/setup?section='+section,{headers:{Cookie:app.cookie('principal')}});
    assert.equal(populated.status,200,section+' after creating its first record');
    assert.match(await populated.text(),/Browser QA record<\/td><td>0<\/td>/);
    app.withDb(db=>db.exec(`UPDATE os_families SET ${section==='districts'?'school_district_id':'congregation_id'}=1 WHERE id=101;`));
    const linked=await app.request('/setup?section='+section,{headers:{Cookie:app.cookie('principal')}});
    assert.equal(linked.status,200);
    assert.match(await linked.text(),/Browser QA record<\/td><td>1<\/td>/);
  }
  const error=await app.request('/system/operations',{headers:{Cookie:app.cookie('teacher')}});
  assert.equal(error.status,403);assert.match(await error.text(),/data-ui-state="error" role="alert"/);
});
