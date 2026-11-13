const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SESSION_VALID_SQL } = require('../server/sessions');
const { schoolFixture } = require('./helpers/school');

test('session validity and cleanup agree at UTC and millisecond boundaries', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY, expires_at TEXT)');
    const now='2026-11-13T23:59:59.500Z';
    const expiries=['2026-11-13T01:00:00.000Z','2026-11-12T23:59:59Z',now,
      '2026-11-13T23:59:59.499Z','2026-11-13T23:59:59.501Z',
      '2026-11-14T00:00:00.000Z','2026-11-14 01:00:00','invalid','',null];
    for(const [index,expiry] of expiries.entries())db.prepare('INSERT INTO sessions VALUES (?,?)').run(index,expiry);
    const predicate=SESSION_VALID_SQL.replace("julianday('now')",'julianday(?)');
    const valid=db.prepare(`SELECT id FROM sessions WHERE ${predicate} ORDER BY id`).all(now).map(row=>row.id);
    assert.deepEqual(valid,[4,5,6]);
    db.prepare(`DELETE FROM sessions WHERE NOT (${predicate})`).run(now);
    assert.deepEqual(db.prepare('SELECT id FROM sessions ORDER BY id').all().map(row=>row.id),valid);
  } finally {db.close();}
});

test('real requests reject expired or invalid sessions and retain valid ISO sessions', async (t) => {
  const app=await schoolFixture(t);
  for(const expiresAt of [new Date(Date.now()-60000).toISOString(),'invalid','']) {
    app.withDb(db=>db.prepare("UPDATE os_sessions SET expires_at=? WHERE session_token='fixture-admin'").run(expiresAt));
    const response=await app.request('/',{headers:{Cookie:app.cookie('admin')}});
    assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/login');
  }
  app.withDb(db=>db.prepare("UPDATE os_sessions SET expires_at=? WHERE session_token='fixture-admin'").run(new Date(Date.now()+60000).toISOString()));
  assert.equal((await app.request('/',{headers:{Cookie:app.cookie('admin')}})).status,200);
  const {cookie}=await app.login();
  assert.equal((await app.request('/',{headers:{Cookie:cookie}})).status,200);
});
