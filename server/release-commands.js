const { spawn } = require('node:child_process');

function terminateTree(child) {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3000);
    const done = () => { clearTimeout(timer); child.kill(); resolve(); };
    killer.once('error', done);
    killer.once('close', done);
  });
}

function createReleaseCommands({ cwd, spawnFn = spawn, killTree = terminateTree, maxBytes = 1024 * 1024 } = {}) {
  const cancellations = new Set();
  let stopped = false;
  let stopping;
  function run(command, args, { deadline = Date.now() + 20000 } = {}) {
    if (stopped) return Promise.reject(new Error('Release checks are shutting down.'));
    return new Promise((resolve, reject) => {
      let child, timer, settled = false, bytes = 0;
      const chunks = [];
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellations.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      let cancelling = false;
      const cancel = async (message = 'Release check cancelled during shutdown.') => {
        if (settled || cancelling) return;
        cancelling = true;
        try { await killTree(child); }
        finally { finish(new Error(message)); }
      };
      if (deadline <= Date.now()) return finish(new Error('Release check timed out.'));
      try {
        child = spawnFn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
      } catch (error) { finish(error); return; }
      cancellations.add(cancel);
      timer = setTimeout(() => void cancel('Release check timed out.'), Math.max(1, deadline - Date.now()));
      const capture = chunk => {
        if (cancelling || settled) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) { void cancel('Release check output exceeded its limit.'); return; }
        chunks.push(Buffer.from(chunk));
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.once('error', error => { if (!cancelling) finish(error); });
      child.once('close', code => {
        if (!cancelling) finish(code === 0 ? null : new Error(`Release command failed (exit ${code}).`), Buffer.concat(chunks).toString('utf8').trim());
      });
    });
  }
  return { run, stop() {
    stopped = true;
    return stopping ||= Promise.all([...cancellations].map(cancel => cancel()));
  } };
}

module.exports = { createReleaseCommands, terminateTree };
