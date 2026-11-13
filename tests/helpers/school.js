const { DatabaseSync } = require('node:sqlite');
const { startApp } = require('./app');

async function schoolFixture(t) {
  const app = await startApp(t);
  const withDb = (fn) => {
    const db = new DatabaseSync(app.dbFile);
    try { return fn(db); } finally { db.close(); }
  };
  withDb((db) => db.exec(`
    INSERT INTO os_school_years (id,name) VALUES (2,'Other year');
    INSERT INTO os_families (id,family_name) VALUES (101,'Fixture');
    INSERT INTO os_teachers (id,name) VALUES (101,'Teacher One'),(102,'Teacher Two');
    INSERT INTO os_classrooms (id,school_year_id,teacher_id,name) VALUES
      (101,1,101,'One'),(102,1,102,'Two'),(103,1,102,'Other first grade');
    INSERT INTO os_classroom_grades (classroom_id,grade_level) VALUES (101,'1'),(102,'2'),(103,'1');
    INSERT INTO os_subjects (id,name) VALUES (101,'Math'),(102,'Reading');
    INSERT INTO os_grade_subjects (school_year_id,grade_level,subject_id) VALUES (1,'1',101),(1,'2',101);
    INSERT INTO os_students (id,family_id,first_name,last_name) VALUES
      (101,101,'One','Student'),(102,101,'Two','Student'),(103,101,'Three','Student');
    INSERT INTO os_student_years (student_id,school_year_id,grade_level,classroom_id) VALUES
      (101,1,'1',101),(102,1,'2',102),(103,1,'1',103);
    INSERT INTO os_assignments (id,school_year_id,grade_level,subject_id,classroom_id,teacher_id,title,category,max_score,marking_period_id) VALUES
      (101,1,'1',101,NULL,102,'Allowed assignment','Test',100,1),
      (102,1,'2',101,NULL,102,'Other grade secret','Test',100,1),
      (103,1,'1',101,103,102,'Other classroom secret','Test',100,1),
      (104,2,'1',101,NULL,101,'Other year secret','Test',100,NULL),
      (105,1,'1',102,NULL,101,'Other subject secret','Test',100,1);
    INSERT INTO os_users (id,name,username,role,password_hash,teacher_id) VALUES
      (101,'Teacher One','teacher-one','teacher','unused',101),
      (102,'Principal','principal','principal','unused',NULL);
    INSERT INTO os_users (id,name,username,role,password_hash,parent_family_id) VALUES
      (103,'Parent','parent','parent','unused',101);
    INSERT INTO os_sessions (session_token,user_id,expires_at) VALUES
      ('fixture-teacher',101,'2099-01-01T00:00:00.000Z'),
      ('fixture-principal',102,'2099-01-01T00:00:00.000Z'),
      ('fixture-admin',1,'2099-01-01T00:00:00.000Z'),
      ('fixture-parent',103,'2099-01-01T00:00:00.000Z');
  `));
  const cookie = (role = 'teacher') => `csrfToken=fixture; sessionToken=fixture-${role}`;
  const post = (url, fields, role = 'teacher') => app.request(url, {
    method: 'POST', headers: { Cookie: cookie(role) }, body: new URLSearchParams({
      csrfToken: 'fixture', schoolYearId: '1', gradeLevel: '1', subjectId: '101',
      markingPeriodId: '1', scoreMode: 'percent', ...fields
    })
  });
  return { ...app, withDb, cookie, post };
}

module.exports = { schoolFixture };
