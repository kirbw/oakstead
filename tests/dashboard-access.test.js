const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolFixture } = require('./helpers/school');

function kpis(html) {
  return [...html.matchAll(/<article class="kpi">.*?<span>([^<]+)<\/span>.*?<strong>(\d+)<\/strong>/gs)]
    .map((match) => [match[1], Number(match[2])]);
}

test('dashboard scopes every count, assignment and score to teacher access', async (t) => {
  const app = await schoolFixture(t);
  app.withDb((db) => db.exec(`
    INSERT INTO os_families(id,family_name) VALUES(102,'Hidden family');
    UPDATE os_students SET family_id=102 WHERE id IN (102,103);
    UPDATE os_assignments SET assignment_date=date('now');
    INSERT INTO os_scores(assignment_id,student_id,score) VALUES
      (101,101,90),(101,103,10),(102,102,20),(103,103,30),(105,101,80);
  `));
  const page = async (role, url = '/') => app.request(url, { headers: { Cookie: app.cookie(role) } });
  const teacher = await (await page('teacher')).text();
  assert.match(teacher, /class="split dashboard-split"/);
  assert.match(teacher, /tabindex="0" role="region" aria-label="Recent gradebook entries"/);
  assert.match(teacher, /Allowed assignment/);
  // Grade-neutral assignments for authorized grades remain visible even if another teacher created them.
  assert.match(teacher, /Other subject secret/);
  for (const title of ['Other grade secret','Other classroom secret','Other year secret']) assert.ok(!teacher.includes(title), title);
  assert.deepEqual(kpis(teacher), [['Families',1],['Students',1],['Teachers',1],['Classrooms',1],['Assignments',2]]);
  assert.match(teacher, /90\.0%/);
  assert.ok(!teacher.includes('50.0%'), 'inaccessible student score excluded from assignment average');
  assert.match(teacher, /85\.0% school-day avg/);
  for (const role of ['admin','principal']) {
    const html = await (await page(role)).text();
    assert.match(html, /Other grade secret/);
    assert.match(html, /Other classroom secret/);
    assert.deepEqual(kpis(html), [['Families',2],['Students',3],['Teachers',2],['Classrooms',3],['Assignments',4]]);
    assert.match(html, /50\.0%/);
  }
  const otherYear = await (await page('teacher', '/?yearId=2')).text();
  assert.deepEqual(kpis(otherYear).map(([,value]) => value), [0,0,0,0,0]);
  assert.ok(!otherYear.includes('Other year secret'));
  const parent = await page('parent');
  assert.equal(parent.status, 302);
  assert.match(parent.headers.get('location'), /^\/parent/);
});
