const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '../..');

async function startApp(t, { prepare } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oakstead-test-'));
  if (prepare) prepare(directory);
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, DEMO_MODE: '0', HOST: '127.0.0.1', PORT: String(port),
      OAKSTEAD_DATA_DIR: directory, DB_FILE: path.join(directory, 'school.db') },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Startup timeout: ${output}`)), 15000);
    const check = () => { if (output.includes('Oakstead running on')) finish(); };
    const failed = (code) => finish(new Error(`Server exited (${code}): ${output}`));
    const finish = (error) => {
      clearTimeout(timeout);
      child.stdout.off('data', check);
      child.off('exit', failed);
      child.off('error', finish);
      error ? reject(error) : resolve();
    };
    child.stdout.on('data', check);
    child.once('exit', failed);
    child.once('error', finish);
    check();
  });
  const request = (url, options = {}) => fetch(`http://127.0.0.1:${port}${url}`, {
    ...options, redirect: 'manual'
  });
  async function login() {
    const page = await request('/login');
    const token = (await page.text()).match(/name="csrfToken" value="([^"]+)"/)[1];
    const response = await request('/login', { method: 'POST',
      headers: { Cookie: `csrfToken=${token}` },
      body: new URLSearchParams({ csrfToken: token, username: 'admin', password: 'ChangeMeNow!' }) });
    if (response.status !== 302 || response.headers.get('location') !== '/') {
      throw new Error('Fixture login failed');
    }
    const session = response.headers.getSetCookie().find((cookie) => cookie.startsWith('sessionToken=') && !cookie.startsWith('sessionToken=;'));
    return { token, cookie: `csrfToken=${token}; ${session.split(';')[0]}` };
  }
  return { request, login, directory, dbFile: path.join(directory, 'school.db'), child, logs: () => output };
}

module.exports = { startApp };
