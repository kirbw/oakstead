const { test } = require('node:test');
const assert = require('node:assert/strict');
const baselineGrades = require('./helpers/baseline-grades');
const { createGradeFixture } = require('./helpers/grade-fixture');
const { calculateWeightedAverage, loadGradeAverages, rowInPeriod } = require('../server/grades');

test('bound grade reads handle empty and changing ID lists and keep text out of SQL', () => {
  const fixture = createGradeFixture({ studentCount: 3, assignmentCount: 12, subjectCount: 2 });
  try {
    const calls = [];
    const query = (sql, parameters) => { calls.push({ sql, parameters }); return fixture.query(sql, parameters); };
    const options = { yearId: 1, grade: '1', subjectIds: [1], studentIds: [], periods: fixture.periods };
    assert.equal(loadGradeAverages(query, options).get(1, fixture.periods[0]).classAverage, null);
    assert.equal(calls.length, 0);
    for (const studentIds of [[1], [1, 2, 3], [2]]) {
      const result = loadGradeAverages(query, { ...options, studentIds });
      assert.deepEqual([...result.get(1, fixture.periods[0]).studentAverages.keys()], studentIds);
    }
    const grade = "1' OR 1=1 -- 日本語";
    const result = loadGradeAverages(query, { ...options, grade, studentIds: [1] });
    assert.equal(result.get(1, fixture.periods[0]).classAverage, null);
    assert.ok(calls.every(call => !call.sql.includes(grade)));
    assert.ok(calls.some(call => call.parameters.includes(grade)));
  } finally { fixture.db.close(); }
});

test('grouped graph calculations match the frozen corrected implementation with bounded queries', () => {
  const fixture=createGradeFixture({studentCount:8,assignmentCount:36,subjectCount:4});
  try {
    fixture.db.exec("INSERT INTO os_grade_weight_groups (id,school_year_id,name,min_grade,max_grade,subject_id,calculation_mode,rounding_mode) VALUES (2,1,'Straight override','1','2',2,'straight','nearest'),(3,1,'Weighted override','1','2',3,'weighted','round-up'); INSERT INTO os_grade_weight_items (group_id,category,weight) VALUES (3,'Quiz',30),(3,'Test',70);");
    const baseline=baselineGrades(fixture.query);
    for(const students of [fixture.studentIds,[1,2],[1]]) {
      const optimized=loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:fixture.subjectIds,studentIds:students,periods:fixture.periods});
      for(const subject of fixture.subjectIds)for(const period of fixture.periods) {
        assert.deepEqual(optimized.get(subject,period),baseline.periodAverageRows(1,'1',subject,students,period));
      }
    }
    fixture.reset();
    loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:fixture.subjectIds,studentIds:fixture.studentIds,periods:fixture.periods});
    assert.equal(fixture.stats().queries,3,'one score query and two settings queries for the whole graph');
    fixture.reset();
    const period=fixture.periods[0];
    const single=loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:[1],studentIds:[1],periods:[period]});
    assert.ok(fixture.stats().scoreRows.every(row=>row.student_id===1&&rowInPeriod(row,period)),'load only authorized students and the selected period');
    assert.deepEqual(single.get(1,period),baseline.periodAverageRows(1,'1',1,[1],period));
    const fallback={id:0,start_date:'',end_date:''};
    assert.deepEqual(loadGradeAverages(fixture.query,{yearId:1,grade:'1',subjectIds:[1],studentIds:[1],periods:[fallback]}).get(1,fallback),baseline.periodAverageRows(1,'1',1,[1],fallback));
  } finally {fixture.db.close();}
});

test('weighted accumulators preserve category aliases, fallback, zeroes, missing values and rounding', () => {
  const baseline=baselineGrades(()=>[]);
  const items=[{group_id:1,category:'Lesson / Homework',weight:50},{group_id:1,category:'Quiz',weight:25},{group_id:1,category:'Test',weight:25}];
  for(const calculation_mode of ['weighted','straight'])for(const rounding_mode of ['nearest','round-up']) {
    const group={id:1,calculation_mode,rounding_mode};
    for(let seed=0;seed<30;seed++) {
      const scores=Array.from({length:seed},(_,i)=>({category:['Lesson','Homework','Quizzes','Test','Other'][i%5],percent:[0,null,'',NaN,Infinity,89.5,90.1,'95'][((i*3)+seed)%8]}));
      assert.deepEqual(calculateWeightedAverage(scores,group,items),baseline.calculateWeightedAverage(scores,group,items));
      assert.deepEqual(calculateWeightedAverage(scores,null,items),baseline.calculateWeightedAverage(scores,null,items));
    }
  }
});
