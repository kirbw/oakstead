const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDb } = require('../server/db');
const { SCHEMA_SQL, applyAdditiveMigrations } = require('../server/schema');
const { schoolFixture } = require('./helpers/school');

function databaseFile(file, label) {
  const connection = new DatabaseSync(file);
  connection.exec(SCHEMA_SQL);
  applyAdditiveMigrations(connection);
  connection.prepare('INSERT INTO os_school_years (name) VALUES (?)').run(label);
  connection.exec("INSERT INTO os_users (name,username,role,password_hash) VALUES ('Admin','admin','admin','unused');");
  connection.close();
}

test('restore rejects invalid schemas and migrates supported backups before swapping', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-restore-test-'));
  const live = path.join(directory,'live.db');
  databaseFile(live,'Original');
  const db = createDb({dbFile:live});
  t.after(()=>{ db.close(); fs.rmSync(directory,{recursive:true,force:true}); });
  const label = () => db.querySql('SELECT name FROM os_school_years')[0].name;
  label(); // Open the live connection and establish WAL before taking the baseline.
  const originalHash=require('node:crypto').createHash('sha256').update(fs.readFileSync(live)).digest('hex');
  let backups=0;
  const reject = (file, pattern) => {
    assert.throws(()=>db.restoreDatabase(file,{beforeReplace:()=>{backups++}}),pattern);
    assert.equal(label(),'Original');
    assert.equal(backups,0,'invalid candidates must not trigger pre-restore writes');
  };
  const blank=path.join(directory,'blank.db');fs.writeFileSync(blank,'');reject(blank,/missing required Oakstead table/);
  const corrupt=path.join(directory,'corrupt.db');fs.writeFileSync(corrupt,'garbage');reject(corrupt,/integrity check/);
  const unrelated=path.join(directory,'unrelated.db');const other=new DatabaseSync(unrelated);other.exec('CREATE TABLE other (id INTEGER)');other.close();reject(unrelated,/missing required Oakstead table/);
  const incomplete=path.join(directory,'incomplete.db');databaseFile(incomplete,'Incomplete');let c=new DatabaseSync(incomplete);c.exec('ALTER TABLE os_students DROP COLUMN first_name');c.close();reject(incomplete,/os_students.first_name/);
  const failedMigration=path.join(directory,'migration.db');databaseFile(failedMigration,'Migration');c=new DatabaseSync(failedMigration);c.exec('ALTER TABLE os_assignments DROP COLUMN marking_period_id');c.close();
  const originalExec=DatabaseSync.prototype.exec;
  const migrationFault=t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(String(sql).startsWith('ALTER TABLE os_assignments ADD COLUMN'))throw Error('Simulated migration failure');
    return originalExec.call(this,sql);
  });
  reject(failedMigration,/Simulated migration failure/);
  migrationFault.mock.restore();
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(live)).digest('hex'),originalHash,'validation never replaces the live main file');
  const legacy=path.join(directory,'legacy.db');databaseFile(legacy,'Legacy');c=new DatabaseSync(legacy);c.exec('ALTER TABLE os_assignments DROP COLUMN marking_period_id');c.close();
  db.restoreDatabase(legacy,{beforeReplace:()=>{backups++}});
  assert.equal(backups,1);assert.equal(label(),'Legacy');
  assert.ok(db.querySql('PRAGMA table_info(os_assignments)').some(row=>row.name==='marking_period_id'));
  c=new DatabaseSync(legacy,{readOnly:true});assert.ok(!c.prepare('PRAGMA table_info(os_assignments)').all().some(row=>row.name==='marking_period_id'),'source backup remains untouched');c.close();
  const current=path.join(directory,'current.db');databaseFile(current,'Current');db.restoreDatabase(current);assert.equal(label(),'Current');
  assert.deepEqual(fs.readdirSync(directory).filter(name=>name.startsWith('.oakstead-restore-')),[]);
});

for (const fault of ['locked-original','replacement','reopen','verification']) {
  test(`restore recovers original database after ${fault} failure`, (t) => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-recovery-test-'));
    const live=path.join(directory,'live.db'), candidate=path.join(directory,'backup.db');
    databaseFile(live,'Original');databaseFile(candidate,'Candidate');
    let calls=0;
    const files={...fs,renameSync(from,to){
      calls++;
      if ((fault==='locked-original'&&calls===1)||(fault==='replacement'&&calls===2)) throw Object.assign(new Error('Simulated Windows file lock'),{code:'EBUSY'});
      fs.renameSync(from,to);
      if(fault==='reopen'&&calls===2) fs.writeFileSync(to,'corrupted replacement');
    }};
    const db=createDb({dbFile:live,files});
    t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
    db.runSql("INSERT INTO os_settings (key,value) VALUES ('wal_record','preserved')");
    assert.throws(()=>db.restoreDatabase(candidate,{verify(){if(fault==='verification')throw Error('Verification failed');}}));
    assert.equal(db.querySql('SELECT name FROM os_school_years')[0].name,'Original');
    assert.equal(db.querySql("SELECT value FROM os_settings WHERE key='wal_record'")[0].value,'preserved');
    db.runSql("INSERT INTO os_settings (key,value) VALUES ('after_failure','usable')");
    assert.deepEqual(fs.readdirSync(directory).filter(name=>name.startsWith('.oakstead-restore-')),[]);
  });
}

test('real restore route leaves active school usable after a rejected upload', async (t) => {
  const app=await schoolFixture(t);
  const form=new FormData();form.set('csrfToken','fixture');form.set('backupFile',new Blob(['']), 'blank.db');
  // A nonempty unrelated SQLite file exercises the upload path (empty uploads are ignored).
  const file=path.join(app.directory,'unrelated.db');const c=new DatabaseSync(file);c.exec('CREATE TABLE unrelated (id INTEGER)');c.close();
  form.set('backupFile',new Blob([fs.readFileSync(file)]),'unrelated.db');
  const response=await app.request('/backup/restore',{method:'POST',headers:{Cookie:app.cookie('admin')},body:form});
  assert.equal(response.status,400);
  assert.match(await response.text(),/missing required Oakstead table/);
  assert.equal((await app.request('/',{headers:{Cookie:app.cookie('admin')}})).status,200);
  assert.equal(app.withDb(db=>db.prepare('SELECT COUNT(*) AS n FROM os_assignments').get().n),5);
  assert.equal(fs.readdirSync(path.join(app.directory,'backups')).filter(name=>name.includes('pre-restore')).length,0);
  assert.equal((await app.post('/backup/create',{},'admin')).status,302);
  const backup=fs.readdirSync(path.join(app.directory,'backups')).find(name=>name.endsWith('manual.db'));
  app.withDb(db=>db.exec("UPDATE os_assignments SET title='Changed after backup' WHERE id=101"));
  assert.equal((await app.post('/backup/restore',{backupFileName:backup},'admin')).status,302);
  assert.equal(app.withDb(db=>db.prepare('SELECT title FROM os_assignments WHERE id=101').get().title),'Allowed assignment');
  assert.equal((await app.request('/',{headers:{Cookie:app.cookie('admin')}})).status,200);
});
