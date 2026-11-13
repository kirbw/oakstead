const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setupFixture } = require('./helpers/setup-fixture');
const { schoolFixture } = require('./helpers/school');
const { startApp } = require('./helpers/app');

const sections=['families','districts','congregations','teachers','classrooms','subjects','years','weights','letter-grades','users','settings','network','backups','updates'];
const normalize=html=>html.replace(/\s+/g,' ').replace(/> </g,'><').trim();

test('selected-section rendering preserves corrected baseline HTML and navigation counts', () => {
  const fixture=setupFixture({familyCount:4,studentCount:12});
  try {
    for(const role of ['admin','principal'])for(const section of sections)for(const action of ['',`add-${section==='families'?'family':section==='teachers'?'teacher':section==='users'?'user':section==='subjects'?'subject':'year'}`]) {
      const url=new URL(`http://localhost/setup?section=${section}&action=${action}`);
      const args=[fixture.selectedYear,'fixture',url,{role}];
      assert.equal(normalize(fixture.after(...args)),normalize(fixture.before(...args)),`${role}/${section}/${action}`);
    }
    for(const [section,param] of [['families','familyId=3&action=edit-family'],['families','familyId=3&studentId=7&action=edit-child'],['families','familyId=999'],['subjects','subjectId=1'],['weights','weightGroupId=1'],['years','yearId=1']]) {
      const args=[fixture.selectedYear,'fixture',new URL(`http://localhost/setup?section=${section}&${param}`),{role:'admin'}];
      assert.equal(normalize(fixture.after(...args)),normalize(fixture.before(...args)));
    }
  } finally {fixture.db.close();}
});

test('unrelated loaders, file reads and render helpers are not called', () => {
  const fixture=setupFixture();
  try {
    for(const section of ['network','settings','updates','backups']) {
      fixture.reset();
      fixture.after(fixture.selectedYear,'fixture',new URL(`http://localhost/setup?section=${section}`),{role:'admin'});
      const {calls,io}=fixture.stats();
      assert.ok(!calls.some(sql=>/SELECT st\.\*|SELECT f\.\*|SELECT pr\.\*|SELECT wg\.\*|SELECT lg\.\*/.test(sql)),`${section} must not fetch school detail records`);
      assert.equal(io.network||0,section==='network'?1:0);
      assert.equal(io.updates||0,section==='updates'?1:0);
      assert.equal(io.backups||0,section==='backups'?1:0);
    }
    fixture.reset();
    fixture.after(fixture.selectedYear,'fixture',new URL('http://localhost/setup?section=districts'),{role:'admin'});
    assert.ok(!fixture.stats().calls.some(sql=>sql.includes('os_emergency_contacts')),'family renderer did not run');
  } finally {fixture.db.close();}
});

test('real Setup sections retain forms, selections, counts and role permissions', async (t) => {
  const app=await schoolFixture(t);
  for(const role of ['admin','principal'])for(const section of sections) {
    const response=await app.request(`/setup?section=${section}`,{headers:{Cookie:app.cookie(role)}});
    assert.equal(response.status,200,`${role}/${section}`);
    const html=await response.text();assert.match(html,/1 households/);assert.match(html,/2 records/);
    assert.match(html,new RegExp(`setup-link active[^>]*href="/setup\\?section=${section}"`));
  }
  for(const role of ['teacher','parent'])assert.equal((await app.request('/setup',{headers:{Cookie:app.cookie(role)}})).status,403);
  const posts=[
    ['/families',{familyId:101,familyName:'Updated Fixture',fatherName:'Father',motherName:'Mother'}],
    ['/school-districts',{name:'Fixture District'}],
    ['/congregations',{name:'Fixture Church'}],
    ['/teachers',{teacherId:101,name:'Teacher One'}],
    ['/classrooms',{classroomId:101,name:'One',teacherId:101,grades:'1'}],
    ['/subjects',{subjectId:101,name:'Math',grades:'1'}],
    ['/school-years',{yearId:1,name:'2025-2026',startDate:'2025-08-15',endDate:'2026-05-31',makeActive:'1'}],
    ['/grade-weights',{weightGroupId:1,name:'Default',minGrade:'1',maxGrade:'2',subjectId:'',weight_Test:'100'}],
    ['/letter-grades',{letterGroupId:1,name:'Default',minGrade:'1',maxGrade:'12',subjectId:'',letter_0:'A',threshold_0:'90',letter_1:'F',threshold_1:'0'}],
    ['/users',{userId:101,name:'Teacher One',username:'teacher-one',role:'teacher',teacherId:101}],
    ['/system-settings',{schoolName:'Fixture School'}],
    ['/backup-settings',{frequency:'manual'}]
  ];
  for(const [route,body] of posts)assert.equal((await app.post(route,body,'admin')).status,302,route);
  const families=await app.request('/setup?section=families&familyId=101&action=edit-family',{headers:{Cookie:app.cookie('admin')}});
  assert.match(await families.text(),/value="Updated Fixture"/);
  const network=await app.request('/setup?section=network',{headers:{Cookie:app.cookie('admin')}});
  assert.match(await network.text(),/disabled/,'environment-managed network controls remain disabled');
  assert.equal((await app.post('/network-settings',{},'admin')).status,400);
  // Update installation is intentionally not run during UI rendering verification.
  assert.equal((await app.request('/system-update',{method:'POST',headers:{Cookie:app.cookie('admin')},body:new URLSearchParams({})})).status,403);
});

test('demo mode continues hiding administrative sections and defaults invalid sections to families', async (t) => {
  const app=await startApp(t,{demoMode:true});
  for(const section of ['network','backups','updates','invalid']) {
    const response=await app.request(`/setup?section=${section}`);assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/setup-link active[^>]*href="\/setup\?section=families"/);
    assert.doesNotMatch(html,/href="\/setup\?section=(?:network|backups|updates)"/);
  }
});
