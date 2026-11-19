const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrateDatabase, MIGRATIONS, CURRENT_SCHEMA_VERSION } = require('../server/migrations');
const { SCHEMA_SQL } = require('../server/schema');
const { startApp } = require('./helpers/app');
const { schoolFixture } = require('./helpers/school');

test('fresh and unversioned databases migrate idempotently with existing records preserved', () => {
  for(const legacy of [false,true]) {
    const db=new DatabaseSync(':memory:');
    try {
      if(legacy){db.exec(SCHEMA_SQL);db.exec("INSERT INTO os_school_years(id,name) VALUES(45,'Historical');");}
      assert.equal(migrateDatabase(db),CURRENT_SCHEMA_VERSION);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,CURRENT_SCHEMA_VERSION);
      assert.ok(db.prepare('PRAGMA table_info(os_assignments)').all().some(row=>row.name==='marking_period_id'));
      assert.equal(migrateDatabase(db),CURRENT_SCHEMA_VERSION);
      if(legacy)assert.deepEqual({...db.prepare('SELECT id,name FROM os_school_years').get()},{id:45,name:'Historical'});
    } finally {db.close();}
  }
});

test('pending migration steps roll back schema, data and version as one operation', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(SCHEMA_SQL);db.exec("INSERT INTO os_school_years(id,name) VALUES(45,'Historical');");
    const failed=[...MIGRATIONS,{version:CURRENT_SCHEMA_VERSION+1,up(connection){connection.exec("ALTER TABLE os_students ADD COLUMN fixture_column TEXT; UPDATE os_school_years SET name='Changed';");throw Error('Injected migration failure');}}];
    assert.throws(()=>migrateDatabase(db,{migrations:failed}),/Injected/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(db.prepare('SELECT name FROM os_school_years').get().name,'Historical');
    assert.ok(!db.prepare('PRAGMA table_info(os_students)').all().some(row=>row.name==='fixture_column'));
    assert.ok(!db.prepare('PRAGMA table_info(os_assignments)').all().some(row=>row.name==='marking_period_id'),'earlier pending step also rolled back');
    const steps=[...MIGRATIONS,{version:CURRENT_SCHEMA_VERSION+1,up:connection=>connection.exec('ALTER TABLE os_students ADD COLUMN fixture_column TEXT;')}];
    assert.equal(migrateDatabase(db,{migrations:steps}),CURRENT_SCHEMA_VERSION+1);
    assert.equal(db.prepare('SELECT name FROM os_school_years').get().name,'Historical');
    assert.throws(()=>migrateDatabase(db),/newer than supported/);
  } finally {db.close();}
});

test('partial, unrelated and future schemas are rejected without fabricated tables', () => {
  for(const setup of ['CREATE TABLE other(id INTEGER);','CREATE TABLE os_school_years(id INTEGER,name TEXT);','PRAGMA user_version=999;']) {
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(setup);const before=db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
      assert.throws(()=>migrateDatabase(db),/missing required|incompatible|newer than supported/);
      assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),before);
    } finally {db.close();}
  }
});

test('startup rejects future schema before initialization or accepting requests', async (t) => {
  await assert.rejects(startApp(t,{prepare(directory){
    const db=new DatabaseSync(path.join(directory,'school.db'));db.exec(SCHEMA_SQL);db.exec("PRAGMA user_version=999; INSERT INTO os_settings(key,value) VALUES('future','preserved');");db.close();
  }}),/newer than supported version/);
});

test('staged restore uses migration registry and rejects future backups without changing active data', async (t) => {
  const app=await schoolFixture(t);
  assert.equal(app.withDb(db=>db.prepare('PRAGMA user_version').get().user_version),CURRENT_SCHEMA_VERSION);
  const backup=path.join(app.directory,'future.db');
  const future=new DatabaseSync(backup);future.exec(SCHEMA_SQL);future.exec('PRAGMA user_version=999;');future.close();
  const form=new FormData();form.set('csrfToken','fixture');form.set('backupFile',new Blob([fs.readFileSync(backup)]),'future.db');
  const response=await app.request('/backup/restore',{method:'POST',headers:{Cookie:app.cookie('admin')},body:form});
  assert.equal(response.status,400);assert.match(await response.text(),/newer than supported/);
  assert.equal(app.withDb(db=>db.prepare('SELECT title FROM os_assignments WHERE id=101').get().title),'Allowed assignment');
  assert.equal(app.withDb(db=>db.prepare('PRAGMA user_version').get().user_version),CURRENT_SCHEMA_VERSION);
});
