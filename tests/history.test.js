const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { schoolFixture } = require('./helpers/school');
const { migrateDatabase, MIGRATIONS } = require('../server/migrations');
const { DatabaseSync } = require('node:sqlite');
const { createAcademicHistory } = require('../server/history');

test('all score paths record atomic changes, zeroes and clears but not no-ops or rejections', async t => {
  const app = await schoolFixture(t);
  const rows = () => app.withDb(db => db.prepare('SELECT * FROM os_academic_history ORDER BY id').all());
  for (const [url, fields, key] of [
    ['/gradebook', { action: 'grid-score', studentId: '101' }, 'scoreValue'],
    ['/gradebook', { action: 'grid-scores' }, 'gridscore_101_101'],
    ['/gradebook', {}, 'score_101'],
    ['/assignments', { action: 'scores' }, 'score_101']
  ]) {
    const post = value => app.post(url, { assignmentId: '101', ...fields, [key]: value });
    const before = rows().length;
    const response = await post('90');
    assert.ok([200, 302].includes(response.status));
    assert.equal(rows().length, before + 1);
    assert.equal(rows().at(-1).request_id, response.headers.get('X-Request-ID'));
    await post('90'); assert.equal(rows().length, before + 1);
    await post('0'); assert.equal(JSON.parse(rows().at(-1).after_json).score, 0);
    await post(''); assert.equal(rows().at(-1).operation, 'delete');
    assert.equal(JSON.parse(rows().at(-1).before_json).score, 0);
    await post(''); assert.equal(rows().length, before + 3);
  }
  const before = rows().length;
  assert.equal((await app.post('/gradebook', { action: 'grid-scores', gridscore_101_101: '70', gridscore_102_102: '80' })).status, 403);
  assert.equal(rows().length, before);
  app.withDb(db => db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON os_academic_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END;"));
  assert.equal((await app.post('/gradebook', { action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: '72' })).status, 500);
  assert.equal(app.withDb(db => db.prepare('SELECT COUNT(*) AS n FROM os_scores').get().n), 0);
  assert.equal(rows().length, before);
  app.withDb(db => db.exec('INSERT INTO os_scores(assignment_id,student_id,score) VALUES(101,101,75)'));
  assert.equal((await app.post('/gradebook', { action: 'update-assignment', assignmentId: '101', deleteAssignment: '1' })).status, 500);
  assert.equal(app.withDb(db => db.prepare('SELECT score FROM os_scores WHERE assignment_id=101 AND student_id=101').get().score), 75);
  assert.ok(app.withDb(db => db.prepare('SELECT id FROM os_assignments WHERE id=101').get()));
  assert.equal(rows().length, before);
});

test('assignment interpretation, cascaded scores and attendance retain actor snapshots after deletion', async t => {
  const app = await schoolFixture(t);
  await app.post('/gradebook', { action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: '80' });
  await app.post('/assignments', { action: 'update', assignmentId: '101', title: 'Changed', category: 'Quiz', assignmentDate: '2026-11-19', maxScore: '50' });
  assert.equal(app.withDb(db => db.prepare("SELECT COUNT(*) AS n FROM os_academic_history WHERE event_type='assignment'").get().n), 1);
  await app.post('/absences', { studentId: '101', absenceDate: '2026-11-19', kind: 'tardy', amount: '0.5', unit: 'hours', notes: "Élodie 🌳" });
  await app.post('/gradebook', { action: 'update-assignment', assignmentId: '101', deleteAssignment: '1' });
  const history = app.withDb(db => db.prepare('SELECT * FROM os_academic_history ORDER BY id').all());
  assert.ok(history.some(row => row.event_type === 'attendance' && JSON.parse(row.after_json).notes === 'Élodie 🌳'));
  assert.ok(history.some(row => row.event_type === 'assignment' && row.operation === 'delete'));
  assert.ok(history.some(row => row.event_type === 'score' && row.operation === 'delete' && JSON.parse(row.before_json).score === 80));
  app.withDb(db => db.exec('DELETE FROM os_sessions WHERE user_id=101; DELETE FROM os_users WHERE id=101;'));
  assert.equal(app.withDb(db => db.prepare('SELECT COUNT(*) AS n FROM os_academic_history').get().n), history.length);
  assert.ok(history.every(row => row.actor_name === 'Teacher One' && row.actor_role === 'teacher'));
});

test('history is staff-restricted, escaped, filtered and paginated with stable cursors', async t => {
  const app = await schoolFixture(t);
  for (const role of ['teacher', 'parent']) assert.equal((await app.request('/history', { headers: { Cookie: app.cookie(role) } })).status, 403);
  for (let score = 0; score < 52; score++) await app.post('/gradebook', { action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: String(score) });
  app.withDb(db => db.prepare('UPDATE os_academic_history SET actor_name=?').run('<script>unsafe</script>'));
  for (const role of ['admin', 'principal']) {
    const response = await app.request('/history?studentId=101&eventType=score', { headers: { Cookie: app.cookie(role) } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
    assert.ok(!html.includes('<script>unsafe</script>'));
    assert.equal((html.match(/score create|score update/g) || []).length, 50);
    const next = html.match(/href="(\/history\?[^\"]*before[^\"]*)"/)[1].replaceAll('&amp;', '&');
    const older = await (await app.request(next, { headers: { Cookie: app.cookie(role) } })).text();
    assert.equal((older.match(/score create|score update/g) || []).length, 2);
  }
  assert.equal((await app.request('/history?from=2026-02-30', { headers: { Cookie: app.cookie('admin') } })).status, 400);
});

test('history migration rolls back and version-one backups restore with no fabricated events', async t => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateDatabase(db, { migrations: MIGRATIONS.slice(0, 1) });
    const failed = [MIGRATIONS[0], { version: 2, up(connection) { MIGRATIONS[1].up(connection); throw Error('Injected'); } }];
    assert.throws(() => migrateDatabase(db, { migrations: failed }), /Injected/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='os_academic_history'").get().n, 0);
  } finally { db.close(); }
  const app = await schoolFixture(t);
  const backup = path.join(app.directory, 'older.db');
  app.withDb(db => db.prepare('VACUUM INTO ?').run(backup));
  const old = new DatabaseSync(backup);
  old.exec('DROP TABLE os_academic_history; PRAGMA user_version=1;'); old.close();
  await app.post('/gradebook', { action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: '80' });
  const form = new FormData(); form.set('csrfToken', 'fixture'); form.set('backupFile', new Blob([fs.readFileSync(backup)]), 'older.db');
  const response = await app.request('/backup/restore', { method: 'POST', headers: { Cookie: app.cookie('admin') }, body: form });
  assert.equal(response.status, 302);
  assert.equal(app.withDb(db => db.prepare('PRAGMA user_version').get().user_version), 2);
  assert.equal(app.withDb(db => db.prepare('SELECT COUNT(*) AS n FROM os_academic_history').get().n), 0);
});

test('demo history labels actors without recording a real identity', () => {
  const events = [];
  const history = createAcademicHistory({ querySql: () => [{ id: 1, school_year_id: 1, student_id: 1 }], executeSql: (_, values) => events.push(values) }, { demoMode: true });
  history.record({ kind: 'attendance', lastId: 0 }, { id: 99, name: 'Real name', role: 'admin' }, 'request');
  assert.deepEqual(events[0].slice(1, 4), [null, 'Demo', 'Demo']);
});

test('creating an assignment records its new ID even if the form includes an old selection', async t => {
  const app = await schoolFixture(t);
  for (const [url, action] of [['/assignments', 'add'], ['/gradebook', 'add-assignment']]) {
    const response = await app.post(url, { action, assignmentId: '101', title: 'New lesson', category: 'Quiz', maxScore: '100' });
    assert.equal(response.status, 302);
    const event = app.withDb(db => db.prepare('SELECT * FROM os_academic_history ORDER BY id DESC LIMIT 1').get());
    assert.equal(event.event_type, 'assignment'); assert.equal(event.operation, 'create');
    assert.ok(event.assignment_id > 105);
  }
});
