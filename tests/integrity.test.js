const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createDb } = require('../server/db');
const { SCHEMA_SQL, applyAdditiveMigrations } = require('../server/schema');
const { collectDataIntegrityIssues } = require('../server/integrity');
const { schoolFixture } = require('./helpers/school');
const { startApp } = require('./helpers/app');

test('connections enforce foreign keys after reopen and failed nested writes roll back', (t) => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-fk-test-'));
  const db=createDb({dbFile:path.join(directory,'school.db')});
  t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  db.runSql(SCHEMA_SQL);db.applySchemaMigrations();
  db.runSql("INSERT INTO os_school_years (name) VALUES ('Fixture'); INSERT INTO os_users (name,username,role,password_hash) VALUES ('Admin','admin','admin','unused');");
  db.runSql("INSERT INTO os_families (id,family_name) VALUES (1,'Family'); INSERT INTO os_students (id,family_id,first_name,last_name) VALUES (1,1,'Student','One');");
  for(const reopen of [()=>{},()=>db.withDatabaseClosed(()=>{})]) {
    reopen();assert.equal(db.querySql('PRAGMA foreign_keys')[0].foreign_keys,1);
    assert.throws(()=>db.runSql("INSERT INTO os_students (family_id,first_name,last_name) VALUES (999,'Invalid','Student')"),/FOREIGN KEY/);
    assert.throws(()=>db.transaction(()=>{
      db.runSql("INSERT INTO os_settings (key,value) VALUES ('must_rollback','yes')");
      db.transaction(()=>db.runSql('DELETE FROM os_families WHERE id=1'));
    }),/FOREIGN KEY/);
    assert.equal(db.querySql("SELECT * FROM os_settings WHERE key='must_rollback'").length,0);
    assert.equal(db.querySql('SELECT * FROM os_families').length,1);
  }
  db.checkpoint();
  const backup=path.join(directory,'backup.db');fs.copyFileSync(path.join(directory,'school.db'),backup);
  db.restoreDatabase(backup);
  assert.equal(db.querySql('PRAGMA foreign_keys')[0].foreign_keys,1);
  assert.throws(()=>db.runSql("INSERT INTO os_students (family_id,first_name,last_name) VALUES (999,'Invalid','After restore')"),/FOREIGN KEY/);
});

test('legacy violations are retained, logged at startup and restricted to admin diagnostics', async (t) => {
  const app=await startApp(t,{prepare(directory){
    const c=new DatabaseSync(path.join(directory,'school.db'));
    c.exec(SCHEMA_SQL);applyAdditiveMigrations(c);c.exec('PRAGMA foreign_keys=OFF;');
    c.exec(`INSERT INTO os_school_years (id,name) VALUES (1,'Legacy');
      INSERT INTO os_users (id,name,username,role,password_hash) VALUES (1,'Admin','admin','admin','unused'),(2,'Principal','principal','principal','unused');
      INSERT INTO os_sessions (session_token,user_id,expires_at) VALUES ('legacy-admin',1,'2099-01-01T00:00:00Z'),('legacy-principal',2,'2099-01-01T00:00:00Z');
      INSERT INTO os_scores (id,assignment_id,student_id,score) VALUES (777,999,999,80);
      INSERT INTO os_assignments (id,school_year_id,grade_level,subject_id,title,category,marking_period_id) VALUES (888,1,'1',999,'Legacy','Test',999);
      INSERT INTO os_person_roles (id,person_type,person_id,group_id,role_type_id) VALUES (999,'teacher',999,999,999);
      INSERT INTO os_grade_weight_items (group_id,category,weight) VALUES (999,'Lesson',50);`);
    c.close();
  }});
  assert.match(app.logs(),/Historical relationship needs review: os_scores, row 777/);
  const response=await app.request('/system/diagnostics',{headers:{Cookie:'sessionToken=legacy-admin'}});
  assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/os_scores/);assert.match(html,/777/);assert.match(html,/marking_period_id 999/);assert.match(html,/person_id 999/);
  assert.equal((await app.request('/system/diagnostics',{headers:{Cookie:'sessionToken=legacy-principal'}})).status,403);
  assert.equal((await app.request('/system/diagnostics')).status,302);
  const c=new DatabaseSync(app.dbFile);
  try {assert.equal(c.prepare('SELECT score FROM os_scores WHERE id=777').get().score,80);assert.equal(c.prepare("SELECT category FROM os_grade_weight_items WHERE group_id=999").get().category,'Lesson');}
  finally {c.close();}
});

test('record routes cascade assignments and roll back multi-step failures before responding', async (t) => {
  const app=await schoolFixture(t);
  for(const role of ['teacher','principal','parent'])assert.equal((await app.request('/system/diagnostics',{headers:{Cookie:app.cookie(role)}})).status,403);
  assert.equal((await app.request('/system/diagnostics',{headers:{Cookie:app.cookie('admin')}})).status,200);
  const old=app.withDb(db=>db.prepare('SELECT * FROM os_students WHERE id=101').get());
  const invalid=await app.post('/students',{studentId:101,familyId:101,firstName:'Should roll back',lastName:'Changed',classroomId:999},'admin');
  assert.equal(invalid.status,409);assert.match(await invalid.text(),/linked record/);
  assert.deepEqual(app.withDb(db=>db.prepare('SELECT * FROM os_students WHERE id=101').get()),old);
  const active=app.withDb(db=>db.prepare('SELECT is_active FROM os_school_years WHERE id=1').get().is_active);
  assert.equal((await app.post('/school-years',{name:'Other year',makeActive:'1'},'admin')).status,500);
  assert.equal(app.withDb(db=>db.prepare('SELECT is_active FROM os_school_years WHERE id=1').get().is_active),active);
  assert.equal((await app.post('/person-roles',{personType:'teacher',personId:999,roleTypeId:1},'admin')).status,400);
  assert.equal((await app.post('/gradebook',{action:'add-assignment',markingPeriodId:999,title:'Invalid'},'admin')).status,400);
  app.withDb(db=>db.exec('INSERT INTO os_scores (assignment_id,student_id,score) VALUES (101,101,80)'));
  assert.equal((await app.post('/gradebook',{action:'update-assignment',assignmentId:101,deleteAssignment:'1'},'admin')).status,302);
  assert.equal(app.withDb(db=>db.prepare('SELECT COUNT(*) AS n FROM os_scores WHERE assignment_id=101').get().n),0);
  const enrollment=app.withDb(db=>db.prepare('SELECT id FROM os_student_years WHERE student_id=101 AND school_year_id=1').get().id);
  assert.equal((await app.post('/enrollments',{studentId:101,classroomId:101},'admin')).status,302);
  assert.equal(app.withDb(db=>db.prepare('SELECT id FROM os_student_years WHERE student_id=101 AND school_year_id=1').get().id),enrollment);
});

test('demo reset and repeated seeding work with enforcement enabled', async (t) => {
  const app=await schoolFixture(t);
  for(let i=0;i<2;i++) {
    const result=spawnSync(process.execPath,['scripts/seed-demo.js','--reset'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DB_FILE:app.dbFile},encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    const issues=app.withDb(db=>collectDataIntegrityIssues(sql=>db.prepare(sql).all()));
    assert.deepEqual(issues,[]);
    assert.ok(app.withDb(db=>db.prepare('SELECT COUNT(*) AS n FROM os_scores').get().n)>0);
  }
});
