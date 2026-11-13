const assert = require('node:assert/strict');
const { createGradeFixture } = require('../tests/helpers/grade-fixture');
const baselineGrades = require('../tests/helpers/baseline-grades');
const { loadGradeAverages } = require('../server/grades');

const fixture = createGradeFixture();
const baseline = baselineGrades(fixture.query);
function before() {
  return fixture.subjectIds.flatMap(subject => fixture.periods.map(period => baseline.periodAverageRows(1,'1',subject,fixture.studentIds,period)));
}
function after() {
  const values=loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:fixture.subjectIds,studentIds:fixture.studentIds,periods:fixture.periods});
  return fixture.subjectIds.flatMap(subject=>fixture.periods.map(period=>values.get(subject,period)));
}
function measure(fn) {
  fn();
  const timings=[];let stats;
  for(let i=0;i<5;i++) {fixture.reset();const start=performance.now();fn();timings.push(performance.now()-start);stats=fixture.stats();}
  timings.sort((a,b)=>a-b);
  return {queries:stats.queries,rows:stats.rows,medianMs:Number(timings[2].toFixed(2))};
}
try {
  assert.deepEqual(after(),before());
  const beforeSingle=()=>baseline.periodAverageRows(1,'1',1,fixture.studentIds,fixture.periods[0]);
  const afterSingle=()=>loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:[1],studentIds:fixture.studentIds,periods:[fixture.periods[0]]}).get(1,fixture.periods[0]);
  assert.deepEqual(afterSingle(),beforeSingle());
  console.log(JSON.stringify({fixture:'30 students, 6 subjects, 300 assignments per subject, 6 periods; in-memory SQLite; 5 measured runs after warmup',graph:{before:measure(before),after:measure(after)},singlePeriod:{before:measure(beforeSingle),after:measure(afterSingle)}},null,2));
} finally {fixture.db.close();}
