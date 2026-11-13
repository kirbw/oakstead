const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_SQL } = require('../../server/schema');

function createGradeFixture({ studentCount = 30, assignmentCount = 300, subjectCount = 6 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  db.exec('ALTER TABLE os_assignments ADD COLUMN marking_period_id INTEGER;');
  db.exec("INSERT INTO os_school_years (id,name) VALUES (1,'Benchmark'); INSERT INTO os_families (id,family_name) VALUES (1,'Fixture'); BEGIN;");
  for (let id = 1; id <= studentCount; id++) db.prepare('INSERT INTO os_students (id,family_id,first_name,last_name) VALUES (?,1,?,?)').run(id,`Student ${id}`,'Fixture');
  for (let id = 1; id <= 6; id++) {
    const month = String(id).padStart(2,'0');
    db.prepare('INSERT INTO os_marking_periods (id,school_year_id,period_number,name,start_date,end_date) VALUES (?,1,?,?,?,?)').run(id,id,`Period ${id}`,`2026-${month}-01`,`2026-${month}-28`);
  }
  db.exec("INSERT INTO os_grade_weight_groups (id,school_year_id,name,min_grade,max_grade) VALUES (1,1,'Default','1','2'); INSERT INTO os_grade_weight_items (group_id,category,weight) VALUES (1,'Lesson / Homework',50),(1,'Quiz',25),(1,'Test',25);");
  const insertAssignment = db.prepare('INSERT INTO os_assignments (id,school_year_id,grade_level,subject_id,title,category,assignment_date,max_score,marking_period_id) VALUES (?,1,\'1\',?,\'Fixture\',?,?,?,?)');
  const insertScore = db.prepare('INSERT INTO os_scores (assignment_id,student_id,score) VALUES (?,?,?)');
  for (let subject = 1; subject <= subjectCount; subject++) {
    db.prepare('INSERT INTO os_subjects (id,name) VALUES (?,?)').run(subject,`Subject ${subject}`);
    for (let index = 1; index <= assignmentCount; index++) {
      const id = (subject-1)*assignmentCount+index;
      const period = (index-1)%6+1;
      const points = index%97===0 ? 0 : index%3===0 ? 50 : 100;
      const category = ['Lesson','Homework','Quiz','Test','Other'][index%5];
      const date = `2026-${String(index%13===0 ? period%6+1 : period).padStart(2,'0')}-${String(index%28+1).padStart(2,'0')}`;
      insertAssignment.run(id,subject,category,date,points,index%7===0 ? null : period);
      for (let student = 1; student <= studentCount; student++) {
        if ((student+index)%19===0) continue;
        insertScore.run(id,student,(student+index)%17===0 ? null : ((index+student*3+subject)%101)*points/100);
      }
    }
  }
  db.exec('COMMIT;');
  const periods = db.prepare('SELECT * FROM os_marking_periods ORDER BY id').all();
  const subjectIds = Array.from({length:subjectCount},(_,i)=>i+1);
  const studentIds = Array.from({length:studentCount},(_,i)=>i+1);
  let queries = 0, rows = 0, scoreRows = [];
  function query(sql) {
    const result = db.prepare(sql).all(); queries++; rows += result.length;
    if (sql.includes('AS percent')) scoreRows.push(...result);
    return result;
  }
  return { db, query, periods, subjectIds, studentIds,
    reset() { queries=0;rows=0;scoreRows=[]; },
    stats: () => ({queries,rows,scoreRows}) };
}

module.exports = { createGradeFixture };
