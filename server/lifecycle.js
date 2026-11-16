function createLifecycle(components, { onError = () => {} } = {}) {
  let state = 'created';
  let starting;
  let stopping;
  const started = [];
  async function unwind() {
    const errors = [];
    while (started.length) {
      const component = started.pop();
      try { await component.stop(); }
      catch (error) { errors.push(error); onError(component.name, error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed.');
  }
  function start() {
    if (state === 'ready') return Promise.resolve();
    if (state === 'starting') return starting;
    if (state === 'stopping') return Promise.reject(new Error('Application is stopping.'));
    stopping = undefined;
    state = 'starting';
    starting = (async () => {
      try {
        for (const component of components) {
          // Include partially started resources in failure cleanup.
          started.push(component);
          await component.start();
        }
        state = 'ready';
      } catch (error) {
        try { await unwind(); } catch { /* Retain the startup cause after reporting cleanup faults. */ }
        state = 'failed';
        throw error;
      }
    })();
    return starting;
  }
  function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (state === 'starting') await starting.catch(() => {});
      state = 'stopping';
      try { await unwind(); }
      finally { state = 'stopped'; }
    })();
    return stopping;
  }
  return { start, stop, state: () => state };
}

async function stopHttpServer(server, { graceMs = 5000, beforeDrain = () => {}, onForced = () => {} } = {}) {
  if (!server.listening) { beforeDrain(); return; }
  let timer;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  beforeDrain();
  server.closeIdleConnections?.();
  try {
    const drained = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), graceMs); })]);
    if (!drained) {
      onForced();
      server.closeAllConnections();
      await closed;
    }
  } finally { clearTimeout(timer); }
}

function installShutdownSignals(application, processRef = process) {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void application.stop().then(() => processRef.exit(0), () => processRef.exit(1));
  };
  processRef.once('SIGINT', shutdown);
  processRef.once('SIGTERM', shutdown);
  return () => { processRef.off('SIGINT', shutdown); processRef.off('SIGTERM', shutdown); };
}

async function restartAfterDrain({ stop, spawnReplacement, exit, supervised }) {
  await stop();
  if (!supervised) spawnReplacement();
  exit(0);
}

module.exports = { createLifecycle, stopHttpServer, installShutdownSignals, restartAfterDrain };
