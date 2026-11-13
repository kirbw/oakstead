const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHttpHelpers } = require('../server/http');
const { startApp } = require('./helpers/app');

test('malformed cookies do not discard valid neighbours', () => {
  const { parseCookies } = createHttpHelpers({ escapeHtml: String, maxBodySize: 100 });
  const cookies = parseCookies({ headers: { cookie: 'good=a%20b; broken=%ZZ; incomplete=%; tail=ok' } });
  assert.deepEqual(cookies, { good: 'a b', tail: 'ok' });
});

test('real server survives malformed cookies and preserves login and CSRF checks', async (t) => {
  const app = await startApp(t);
  for (const cookie of ['broken=%ZZ', 'broken=%', 'sessionToken=%E0%A4', 'csrfToken=%ZZ; valid=yes']) {
    assert.equal((await app.request('/login', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await app.request('/login')).status, 200);
  }
  const { cookie, token } = await app.login();
  const dashboard = await app.request('/', { headers: { Cookie: `${cookie}; broken=%ZZ` } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Dashboard/);
  const post = (csrfToken) => app.request('/switch-year', { method: 'POST', headers: { Cookie: cookie },
    body: new URLSearchParams({ csrfToken, yearId: '1' }) });
  assert.equal((await post('wrong')).status, 403);
  assert.equal((await post(token)).status, 302);
  assert.equal(app.child.exitCode, null);
});
