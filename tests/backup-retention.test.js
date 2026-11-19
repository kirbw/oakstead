const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createDb } = require('../server/db');
const { createBackupStorage, retentionCount, scheduledTimestamp } = require('../server/backup-storage');
const { schoolFixture } = require('./helpers/school');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oakstead-retention-'));
  const backupDir = path.join(directory, 'backups'), dbFile = path.join(directory, 'live.db');
  const db = createDb({ dbFile }); db.applySchemaMigrations();
  db.executeSql("INSERT INTO os_school_years(name) VALUES('Fixture')");
  db.executeSql("INSERT INTO os_users(name,username,role,password_hash) VALUES('Admin','admin','admin','unused')");
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  let clock = new Date('2026-11-19T12:00:00.000Z');
  const storage = createBackupStorage({ backupDir, dbFile, checkpoint: db.checkpoint,
    withDatabaseClosed: db.withDatabaseClosed, validate: db.prepareBackupDatabase, now: () => clock, ...overrides });
  return { db, storage, directory, backupDir, advance() { clock = new Date(+clock + 1000); } };
}

test('retention is opt-in, deterministic at boundaries, and preserves other backup types', t => {
  const f = fixture(t);
  assert.equal(retentionCount(undefined), 0);
  for (const invalid of ['-1', '2', '3.5', 'bad']) assert.throws(() => retentionCount(invalid));
  const scheduled = [];
  for (let i = 0; i < 5; i++) { scheduled.push(f.storage.publish('scheduled').fileName); f.advance(); }
  for (const reason of ['manual', 'uploaded', 'pre-restore', 'pre-update', 'pre-installer-update']) f.storage.publish(reason);
  fs.writeFileSync(path.join(f.backupDir, 'unrecognized.db'), 'preserve');
  assert.deepEqual(f.storage.preview(0), []);
  assert.deepEqual(f.storage.cleanup(0).deleted, []);
  assert.deepEqual(f.storage.preview(3), [scheduled[1], scheduled[0]]);
  assert.deepEqual(f.storage.preview(3, true), [scheduled[2], scheduled[1], scheduled[0]]);
  assert.deepEqual(f.storage.cleanup(3).deleted, [scheduled[1], scheduled[0]]);
  assert.equal(fs.readdirSync(f.backupDir).length, 9);
  for (const name of scheduled.slice(2)) {
    f.db.restoreDatabase(path.join(f.backupDir, name));
    assert.equal(f.db.querySql('SELECT name FROM os_school_years')[0].name, 'Fixture');
  }
  const sameTime = [f.storage.publish('scheduled').fileName, f.storage.publish('scheduled').fileName];
  assert.deepEqual(f.storage.preview(3), f.storage.preview(3), 'identical timestamps have stable filename ordering');
  assert.notEqual(sameTime[0], sameTime[1]);
  assert.equal(scheduledTimestamp('../' + scheduled[0]), null);
  assert.equal(scheduledTimestamp('oakstead-backup-2026-02-30T12-00-00-000Z-scheduled.db'), null);
});

test('publication validates before rename and failures preserve usable backups', t => {
  const f = fixture(t);
  const original = f.storage.publish('manual');
  const before = fs.readFileSync(original.path);
  for (const failure of ['copy', 'validation', 'rename']) {
    const files = { ...fs,
      copyFileSync(source, target) { if (failure === 'copy') { fs.writeFileSync(target, 'partial'); throw Error('disk full'); } return fs.copyFileSync(source, target); },
      renameSync(source, target) { if (failure === 'rename') throw Object.assign(Error('locked'), { code: 'EBUSY' }); return fs.renameSync(source, target); }
    };
    const broken = createBackupStorage({ backupDir: f.backupDir, dbFile: path.join(f.directory, 'live.db'),
      checkpoint: f.db.checkpoint, withDatabaseClosed: f.db.withDatabaseClosed, files,
      validate(file) { if (failure === 'validation') throw Error('invalid'); f.db.prepareBackupDatabase(file); } });
    assert.throws(() => broken.publish('scheduled'));
    assert.deepEqual(fs.readFileSync(original.path), before);
    assert.deepEqual(fs.readdirSync(f.backupDir), [original.fileName]);
  }
});

test('cleanup reports locked files separately and skips symlinks, directories and path escapes', t => {
  let locked;
  const files = { ...fs, unlinkSync(file) { if (file === locked) throw Object.assign(Error('Windows lock'), { code: 'EBUSY' }); return fs.unlinkSync(file); } };
  const f = fixture(t, { files });
  const names = [];
  for (let i = 0; i < 6; i++) { names.push(f.storage.publish('scheduled').fileName); f.advance(); }
  locked = path.join(f.backupDir, names[0]);
  const outside = path.join(f.directory, 'outside.db'); fs.writeFileSync(outside, 'preserve');
  const symlink = path.join(f.backupDir, 'oakstead-backup-2020-01-01T00-00-00-000Z-scheduled.db');
  try { fs.symlinkSync(outside, symlink, 'file'); }
  catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Exercise the same no-follow guard when Windows does not allow symlink creation.
    fs.writeFileSync(symlink, 'placeholder');
    files.lstatSync = file => file === symlink ? { isFile: () => true, isSymbolicLink: () => true } : fs.lstatSync(file);
  }
  fs.mkdirSync(path.join(f.backupDir, 'oakstead-backup-2020-01-02T00-00-00-000Z-scheduled.db'));
  const result = f.storage.cleanup(3);
  assert.deepEqual(result.failed, [names[0]]);
  assert.equal(result.deleted.length, 2);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve');
  assert.ok(fs.existsSync(symlink));
  assert.ok(fs.existsSync(locked));
});

test('retention settings require an administrator and saving or manual backup never cleans files', async t => {
  const app = await schoolFixture(t);
  const fields = { action: 'retention', retentionCount: '3' };
  assert.equal((await app.post('/backup-settings', fields, 'principal')).status, 403);
  assert.equal((await app.post('/backup-settings', { ...fields, retentionCount: '2' }, 'admin')).status, 400);
  const backupDir = path.join(app.directory, 'backups'); fs.mkdirSync(backupDir, { recursive: true });
  for (let day = 1; day <= 5; day++) fs.writeFileSync(path.join(backupDir, `oakstead-backup-2026-01-0${day}T00-00-00-000Z-scheduled.db`), 'preserve');
  assert.equal((await app.post('/backup-settings', fields, 'admin')).status, 302);
  assert.equal(fs.readdirSync(backupDir).length, 5);
  assert.equal((await app.post('/backup/create', {}, 'admin')).status, 302);
  assert.equal(fs.readdirSync(backupDir).length, 6);
  const preview = await app.request('/setup?section=backups&previewRetention=1&retentionEnabled=1&retentionCount=3', { headers: { Cookie: app.cookie('admin') } });
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /Saving deletes nothing/);
  assert.equal(fs.readdirSync(backupDir).length, 6);
});

test('Windows exclusive file handles preserve the locked backup and allow later retry', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const first = f.storage.publish('scheduled'); f.advance();
  for (let i = 0; i < 3; i++) { f.storage.publish('scheduled'); f.advance(); }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$stream=[IO.File]::Open($env:OAKSTEAD_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null; $stream.Dispose()'],
  { env: { ...process.env, OAKSTEAD_LOCK_FILE: first.path }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Windows lock fixture timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => { if (String(data).includes('LOCKED')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); if (code) reject(Error('Windows lock fixture failed')); });
  });
  assert.deepEqual(f.storage.cleanup(3).failed, [first.fileName]);
  const exited = once(child, 'exit'); child.stdin.end('\n'); await exited;
  assert.deepEqual(f.storage.cleanup(3).deleted, [first.fileName]);
});
