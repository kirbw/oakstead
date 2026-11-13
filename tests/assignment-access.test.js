const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolFixture } = require('./helpers/school');

test('actual assignments and students are authorized before every read/write path', async (t) => {
  const app = await schoolFixture(t);
  const snapshot = () => app.withDb((db) => JSON.stringify({
    assignments: db.prepare('SELECT * FROM os_assignments ORDER BY id').all(),
    scores: db.prepare('SELECT * FROM os_scores ORDER BY id').all()
  }));
  const original = snapshot();
  for (const id of [102,103,104,105,999]) {
    for (const route of ['/assignments','/gradebook']) {
      const response = await app.request(`${route}?yearId=1&grade=1&subjectId=101&assignmentId=${id}&grid=off`, { headers: { Cookie: app.cookie() } });
      assert.equal(response.status,403, `${route} read ${id}`);
      assert.doesNotMatch(await response.text(), /secret/);
    }
    for (const [route,fields] of [
      ['/assignments',{action:'update',assignmentId:id,title:'Tampered',maxScore:50}],
      ['/assignments',{action:'scores',assignmentId:id,score_101:70}],
      ['/gradebook',{assignmentId:id,score_101:70}],
      ['/gradebook',{action:'update-assignment',assignmentId:id,deleteAssignment:'1'}],
      ['/gradebook',{action:'grid-score',assignmentId:id,studentId:101,scoreValue:70}],
      ['/gradebook',{action:'grid-scores',gridscore_101_101:70,[`gridscore_${id}_101`]:50}]
    ]) {
      assert.equal((await app.post(route,fields)).status,403,`${route} ${fields.action} ${id}`);
      assert.equal(snapshot(),original,'denied request must not partially write');
    }
  }
  for (const studentId of [102,103,999]) {
    for (const [route,fields] of [
      ['/assignments',{action:'scores',assignmentId:101,score_101:70,[`score_${studentId}`]:50}],
      ['/gradebook',{assignmentId:101,score_101:70,[`score_${studentId}`]:50}],
      ['/gradebook',{action:'grid-score',assignmentId:101,studentId,scoreValue:50}],
      ['/gradebook',{action:'grid-scores',gridscore_101_101:70,[`gridscore_101_${studentId}`]:50}],
      ['/gradebook',{title:'Must not create',score_101:70,[`score_${studentId}`]:50}]
    ]) {
      assert.equal((await app.post(route,fields)).status,403);
      assert.equal(snapshot(),original);
    }
  }
  for (const role of ['teacher','principal','admin']) {
    assert.equal((await app.post('/assignments',{action:'update',assignmentId:101,title:'Allowed assignment',maxScore:100,category:'Test'},role)).status,302);
    assert.equal((await app.post('/gradebook',{action:'grid-score',assignmentId:101,studentId:101,scoreValue:90},role)).status,200);
    assert.equal((await app.post('/assignments',{action:'scores',assignmentId:101,score_101:85},role)).status,302);
    assert.equal((await app.post('/gradebook',{assignmentId:101,score_101:88},role)).status,302);
    assert.equal((await app.post('/gradebook',{action:'grid-scores',gridscore_101_101:92},role)).status,302);
    assert.equal((await app.request('/assignments?yearId=1&grade=1&subjectId=101&assignmentId=101', {headers:{Cookie:app.cookie(role)}})).status,200);
  }
  assert.equal((await app.post('/assignments',{action:'update',assignmentId:101,title:'No'},'parent')).status,403);
  assert.equal((await app.post('/gradebook',{action:'update-assignment',assignmentId:101,deleteAssignment:'1'})).status,302);
});
