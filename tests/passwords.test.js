const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPasswordVerifier } = require('../server/passwords');
const { startApp } = require('./helpers/app');
const { createService } = require('../server/domains/authentication');

test('login rechecks lockout and password changes after asynchronous verification', async () => {
  for (const mode of ['locked', 'changed', 'deleted', 'busy']) {
    let verified = false;
    let sessions = 0;
    const row = { id: 1, password_hash: 'original' };
    const service = createService({ asInt: Number, cleanText: String, sqlValue: value => `'${value}'`,
      requireCsrf: () => true,
      querySql: () => !verified ? [row] : mode === 'deleted' ? [] : [{ ...row, password_hash: mode === 'changed' ? 'replacement' : row.password_hash }],
      loginThrottleStatus: () => verified && mode === 'locked' ? { retryAfter: 30 } : null,
      verifyPassword: async () => { verified = true; if (mode === 'busy') throw Object.assign(new Error('busy'), { code: 'AUTH_BUSY' }); return true; },
      recordLoginFailure: () => {}, clearLoginFailures: () => {}, clearSession: () => {},
      createSession: () => sessions++, db: { transaction: fn => fn() }
    });
    const result = await service.execute('/login', { username: 'test', password: 'test' }, null, {});
    assert.equal(sessions, 0, mode);
    assert.equal(result.status, mode === 'locked' ? 429 : mode === 'busy' ? 503 : 302, mode);
  }
});

test('async password checks retain existing hashes and reject wrong or malformed credentials', async () => {
  const verify = createPasswordVerifier();
  const salt = 'existing-salt';
  const encoded = salt + ':' + crypto.scryptSync('correct', salt, 64).toString('hex');
  assert.equal(await verify('correct', encoded), true);
  assert.equal(await verify('wrong', encoded), false);
  for (const value of ['', 'broken', 'salt:zz', 'salt:00', encoded + ':extra']) assert.equal(await verify('correct', value), false);
});

test('verification bounds active and queued jobs and releases slots after failure', async () => {
  const callbacks = [];
  const verify = createPasswordVerifier({ concurrency: 1, maxPending: 1, scrypt: (password, salt, size, callback) => callbacks.push(callback) });
  const encoded = 'salt:' + '00'.repeat(64);
  const first = verify('one', encoded);
  const second = verify('two', encoded);
  assert.equal(callbacks.length, 1);
  await assert.rejects(verify('three', encoded), { code: 'AUTH_BUSY' });
  const rejected = assert.rejects(first, /injected failure/);
  callbacks[0](new Error('injected failure'));
  await rejected;
  assert.equal(callbacks.length, 2);
  callbacks[1](null, Buffer.alloc(64));
  assert.equal(await second, true);
});

test('real login creates a usable session and rejects incorrect credentials', async t => {
  const app = await startApp(t);
  const session = await app.login();
  const dashboard = await app.request('/', { headers: { Cookie: session.cookie } });
  assert.equal(dashboard.status, 200);
  await dashboard.text();
  const response = await app.request('/login', { method: 'POST', headers: { Cookie: session.cookie }, body: new URLSearchParams({ csrfToken: session.token, username: 'admin', password: 'wrong' }) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login?error=1');
  assert.ok(!response.headers.getSetCookie().some(cookie => cookie.startsWith('sessionToken=')));
});
