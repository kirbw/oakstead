const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../server/db');
const { sqlParameter } = require('../server/input');
const { scoreWriteStatements } = require('../server/gradebook-utils');
const { schoolFixture } = require('./helpers/school');

test('bound operations preserve literal values, inserted IDs and transaction rollback', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oakstead-bound-'));
  const db = createDb({ dbFile: path.join(directory, 'test.db') });
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  db.runSql('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT, amount REAL);');
  const value = "O'Brien 日本語 🌳'); DROP TABLE records; --";
  const id = db.insertReturningId('INSERT INTO records(value, amount) VALUES (?, ?);', [value, 0]);
  assert.equal(id, 1);
  assert.deepEqual({ ...db.querySql('SELECT * FROM records WHERE value=?', [value])[0] }, { id, value, amount: 0 });
  db.executeSql('UPDATE records SET value=? WHERE id=?', ['', id]);
  assert.equal(db.querySql('SELECT value FROM records')[0].value, '');
  db.executeSql('UPDATE records SET value=? WHERE id=?', [null, id]);
  assert.equal(db.querySql('SELECT value FROM records')[0].value, null);
  assert.throws(() => db.transaction(() => {
    db.executeSql('UPDATE records SET value=? WHERE id=?', [value, id]);
    db.executeSql('INSERT INTO records(id) VALUES (?)', [id]);
  }), /UNIQUE/);
  assert.equal(db.querySql('SELECT value FROM records')[0].value, null);
  assert.equal(sqlParameter(''), null);
  assert.equal(sqlParameter(0), '0');
  assert.equal(sqlParameter(value), value);
  db.close();
  assert.equal(db.querySql('SELECT COUNT(*) AS count FROM records')[0].count, 1);
});

test('structured score writes preserve zero, clearing and omitted fields', () => {
  const operations = scoreWriteStatements([
    { studentId: 1, kind: 'unchanged' },
    { studentId: 2, kind: 'score', score: 0 },
    { studentId: 3, kind: 'delete' }
  ], 10);
  assert.equal(operations.length, 2);
  assert.deepEqual(operations[0].parameters, [10, 2, 0]);
  assert.deepEqual(operations[1].parameters, [10, 3]);
});

test('people forms save quoted Unicode as data and roll back multi-step failures', async (t) => {
  const app = await schoolFixture(t);
  const familyName = "O'Brien 日本語 🌳'); DELETE FROM os_families; --";
  const response = await app.post('/families', { familyName, address: "123 L'école" }, 'admin');
  assert.equal(response.status, 302);
  const id = Number(new URL(response.headers.get('location'), app.url || 'http://localhost').searchParams.get('familyId'));
  assert.ok(id > 101);
  const family = app.withDb(db => db.prepare('SELECT family_name, address, school_district_id FROM os_families WHERE id=?').get(id));
  assert.equal(family.family_name, familyName);
  assert.equal(family.address, "123 L'école");
  assert.equal(family.school_district_id, null);
  assert.equal((await app.post('/families', { familyId: id, familyName: 'Forbidden change' })).status, 403);
  const before = app.withDb(db => db.prepare('SELECT COUNT(*) AS count FROM os_students').get().count);
  const failed = await app.post('/students', { familyId: id, firstName: 'Élodie', lastName: '日本語', schoolYearId: '999999' }, 'admin');
  assert.ok(failed.status >= 400);
  assert.equal(app.withDb(db => db.prepare('SELECT COUNT(*) AS count FROM os_students').get().count), before);
  assert.equal(app.withDb(db => db.prepare('SELECT family_name FROM os_families WHERE id=?').get(id).family_name), familyName);
});
