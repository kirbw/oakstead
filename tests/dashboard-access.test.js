const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolFixture } = require('./helpers/school');

function kpis(html) {
  return [...html.matchAll(/<article class="kpi">.*?<span>([^<]+)<\/span>.*?<strong>(\d+)<\/strong>/gs)]
    .map((match) => [match[1], Number(match[2])]);
}

test('recent dashboard limits authorized assignments before scores without changing ordering or averages', async t => {
  const app = await schoolFixture(t);
  app.withDb(db => {
    for(let i=0;i<20;i++) {
      db.prepare(`INSERT INTO os_assignments(id,school_year_id,grade_level,subject_id,title,category,assignment_date,max_score) VALUES(?,1,'1',101,?,'Test',?,?)`).run(201+i,`Recent ${i}`,i<10?'2026-01-01':'2026-01-02',i===18?0:100);
      if(i!==19)db.prepare('INSERT INTO os_scores(assignment_id,student_id,score) VALUES(?,101,?)').run(201+i,i===17?null:i===16?0:80+i);
      db.prepare('INSERT INTO os_scores(assignment_id,student_id,score) VALUES(?,103,10)').run(201+i);
    }
    db.exec("UPDATE os_assignments SET assignment_date='2099-01-01' WHERE id IN (102,103,104);");
  });
  for(const role of ['teacher','admin','principal']) {
    const expected=app.withDb(db=>db.prepare(`SELECT a.title,ROUND(AVG(sc.score/NULLIF(a.max_score,0)*100),1) average FROM os_assignments a JOIN os_subjects s ON s.id=a.subject_id LEFT JOIN os_scores sc ON sc.assignment_id=a.id ${role==='teacher'?'AND sc.student_id=101':''} WHERE a.school_year_id=1 ${role==='teacher'?"AND a.grade_level='1' AND (a.classroom_id IS NULL OR a.classroom_id=101)":''} GROUP BY a.id ORDER BY a.assignment_date DESC,a.id DESC LIMIT 8`).all());
    const response=await app.request('/',{headers:{Cookie:app.cookie(role)}});
    assert.equal(response.status,200);
    const html=await response.text();
    const region=html.split('aria-label="Recent gradebook entries"')[1].split('</table>')[0];
    const rows=[...region.matchAll(/<tr>\s*<td>([^<]+)<\/td>[\s\S]*?<span class="badge [^"]*">([^<]+)<\/span>[\s\S]*?<\/tr>/g)];
    assert.deepEqual(rows.map(row=>row[1]),expected.map(row=>row.title),role);
    assert.deepEqual(rows.map(row=>row[2]),expected.map(row=>row.average===null?'&mdash;':row.average.toFixed(1)+'%'),role);
  }
});

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
