const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compactPercent } = require('../server/input');
const { schoolFixture } = require('./helpers/school');

test('grade formatting preserves integer zeroes and trims only fractional padding', () => {
  for (const value of [0, 10, 90, 100, 80, 50]) {
    assert.equal(compactPercent(value), String(value));
    assert.equal(compactPercent(String(value)), String(value));
    assert.equal(compactPercent(value, 2), String(value));
  }
  assert.equal(compactPercent(89.6), '90');
  assert.equal(compactPercent(99.6), '100');
  assert.equal(compactPercent(90.1, 2), '90.1');
  assert.equal(compactPercent(90.25, 2), '90.25');
  assert.equal(compactPercent(90.01, 2), '90.01');
  assert.equal(compactPercent(1e30, 2), '1e+30');
  for (const value of [null, undefined, '', NaN, Infinity, 'invalid']) {
    assert.equal(compactPercent(value), '');
  }
});

test('initial gradebook and autosave averages preserve 0, 10, 90 and 100', async (t) => {
  const app = await schoolFixture(t);
  for (const score of [0, 10, 90, 100]) {
    const response = await app.post('/gradebook', {
      action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: String(score)
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.percent, score);
    for (const name of ['assignmentAverage', 'studentAverage', 'classAverage']) {
      assert.match(result.display[name], new RegExp(`^${score}<sup>`), name);
    }
    const page = await app.request('/gradebook?yearId=1&grade=1&subjectId=101&markingPeriodId=1&grid=on', {
      headers: { Cookie: app.cookie() }
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const attribute of ['data-grid-assignment-average="101"', 'data-grid-student-average="101"', 'data-grid-class-average']) {
      assert.match(html, new RegExp(`${attribute}>${score}<sup>`), attribute);
    }
    assert.equal(app.withDb((db) => db.prepare('SELECT score FROM os_scores WHERE assignment_id=101 AND student_id=101').get().score), score);
  }
  const cleared = await app.post('/gradebook', {
    action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: ''
  });
  assert.equal(cleared.status, 200);
  const result = await cleared.json();
  assert.equal(result.percent, null);
  assert.deepEqual(result.display, { assignmentAverage: '&mdash;', studentAverage: '&mdash;', classAverage: '&mdash;' });
});
