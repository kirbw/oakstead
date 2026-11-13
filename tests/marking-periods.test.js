const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolFixture } = require('./helpers/school');

test('period settings preserve links and roll back conflicts and database failures', async (t) => {
  const app = await schoolFixture(t);
  const periods = () => app.withDb((db) => db.prepare('SELECT * FROM os_marking_periods WHERE school_year_id=1 ORDER BY period_number').all());
  const year = () => app.withDb((db) => db.prepare('SELECT * FROM os_school_years WHERE id=1').get());
  const save = (fields = {}) => app.post('/marking-periods', {
    periodCount:6,schoolDays:180,startDate:'2025-08-15',endDate:'2026-05-31',...fields
  },'admin');
  const original = periods();
  assert.equal((await save()).status,302);
  assert.deepEqual(periods(),original);
  assert.equal((await save({periodCount:8,endDate:'2026-06-15'})).status,302);
  assert.deepEqual(periods().slice(0,6).map(p=>p.id),original.map(p=>p.id));
  assert.equal(periods().length,8);
  assert.equal((await save()).status,302);
  assert.deepEqual(periods(),original);
  app.withDb((db) => db.exec(`UPDATE os_assignments SET marking_period_id=${original[5].id} WHERE id=101;`));
  const beforeYear=year();
  const rejected=await save({periodCount:5,schoolDays:200,startDate:'2025-09-01'});
  assert.equal(rejected.status,409);
  assert.match(await rejected.text(),/has assignments/);
  assert.deepEqual(periods(),original);
  assert.deepEqual(year(),beforeYear);
  app.withDb((db) => db.exec("CREATE TRIGGER fixture_failure BEFORE UPDATE ON os_marking_periods WHEN NEW.period_number=3 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;"));
  assert.equal((await save({endDate:'2026-06-15',schoolDays:200})).status,500);
  assert.deepEqual(periods(),original);
  assert.deepEqual(year(),beforeYear);
  app.withDb((db) => db.exec('DROP TRIGGER fixture_failure; UPDATE os_assignments SET marking_period_id=99999 WHERE id=101;'));
  assert.equal((await save()).status,302);
  assert.equal(app.withDb((db)=>db.prepare('SELECT marking_period_id FROM os_assignments WHERE id=101').get().marking_period_id),99999,'do not guess historical repairs');
  assert.equal((await app.request('/report-cards?yearId=1&grade=1&studentId=101&markingPeriodId=1',{headers:{Cookie:app.cookie('admin')}})).status,200);
});
