const SQL_OPERATIONS = new Set(['SELECT','INSERT','UPDATE','DELETE','PRAGMA','DDL','TRANSACTION','BATCH','OTHER']);
const METHODS = new Set(['GET','POST','HEAD','PUT','PATCH','DELETE','OPTIONS']);
const LIMITS = [1,5,20,100,500,2000,Infinity];
const stats = () => ({ count: 0, totalMs: 0, maxMs: 0, failures: 0, buckets: LIMITS.map(() => 0) });

function sqlOperation(sql) {
  const word = String(sql).trimStart().match(/^[a-z]+/i)?.[0].toUpperCase();
  if (['CREATE','ALTER','DROP'].includes(word)) return 'DDL';
  if (['BEGIN','COMMIT','SAVEPOINT','RELEASE','ROLLBACK'].includes(word)) return 'TRANSACTION';
  if (word === 'WITH') return 'SELECT';
  return SQL_OPERATIONS.has(word) ? word : 'OTHER';
}

function createOperationalMonitor({ log = entry => console.log(JSON.stringify(entry)), now = () => performance.now(), date = () => new Date(), maxRoutes = 64 } = {}) {
  let routes = new Set();
  const since = now();
  const requests = stats(), database = stats(), routeStats = new Map(), queryStats = new Map();
  const backup = { lastSuccessAt: '', lastFailureAt: '', latestResult: 'No backup attempted since startup' };
  function add(target, milliseconds, failed) {
    const duration = Number.isFinite(milliseconds) ? Math.max(0,milliseconds) : 0;
    target.count++;target.totalMs += duration;target.maxMs = Math.max(target.maxMs,duration);
    if (failed) target.failures++;
    target.buckets[LIMITS.findIndex(limit=>duration<=limit)]++;
    return duration;
  }
  function recordRequest({ requestId, method, pathname, status, durationMs }) {
    const route = routes.has(pathname) ? pathname : '/other';
    const verb = METHODS.has(method) ? method : 'OTHER';
    const duration = add(requests,durationMs,status>=400);
    let key = `${verb} ${route}`;
    if (!routeStats.has(key) && routeStats.size>=maxRoutes-1) key='OTHER /other';
    if (!routeStats.has(key)) routeStats.set(key,stats());
    add(routeStats.get(key),duration,status>=400);
    log({ event:'http.request',requestId,method:verb,route,status,durationMs:Number(duration.toFixed(2)) });
  }
  function recordQuery({ operation, durationMs, failed = false }) {
    const label = SQL_OPERATIONS.has(operation) ? operation : 'OTHER';
    const duration = add(database,durationMs,failed);
    if (!queryStats.has(label)) queryStats.set(label,stats());
    add(queryStats.get(label),duration,failed);
    if (duration>100) log({event:'database.slow',operation:label,durationMs:Number(duration.toFixed(2)),failed});
  }
  function recordBackup(success) {
    backup[success?'lastSuccessAt':'lastFailureAt'] = date().toISOString();
    backup.latestResult = success ? 'Succeeded' : 'Failed; check backup storage and retry';
    if (!success) log({event:'backup.failed'});
  }
  function summary(value) {
    return {count:value.count,meanMs:value.count?Number((value.totalMs/value.count).toFixed(2)):0,maxMs:Number(value.maxMs.toFixed(2)),failures:value.failures,buckets:[...value.buckets]};
  }
  return {
    configureRoutes(values) { routes = new Set(values); }, recordRequest,recordQuery,recordBackup,
    snapshot() { return {uptimeSeconds:Math.floor((now()-since)/1000),requests:summary(requests),database:summary(database),
      routes:[...routeStats].map(([label,value])=>({label,...summary(value)})),
      operations:[...queryStats].map(([label,value])=>({label,...summary(value)})),backup:{...backup}}; }
  };
}

function databaseReady({ state, isOpen, query }) {
  if (state !== 'ready' || !isOpen()) return false;
  try { return query('SELECT 1 AS ready;')[0]?.ready === 1; } catch { return false; }
}

function renderOperationalPage(snapshot, { escapeHtml: esc, version, ready, backupAt, scheduler }) {
  const table = (rows) => `<div class="table-wrap"><table><tr><th>Operation</th><th>Count</th><th>Mean ms</th><th>Max ms</th><th>Failures</th></tr>${rows.map(row=>`<tr><td>${esc(row.label)}</td><td>${row.count}</td><td>${row.meanMs}</td><td>${row.maxMs}</td><td>${row.failures}</td></tr>`).join('')}</table></div>`;
  return `<div class="workspace"><section class="chart-panel"><h1>Operational Health</h1>
    <p>Version ${esc(version)} · Uptime ${snapshot.uptimeSeconds}s · Database ${ready?'ready':'unavailable'}</p>
    <p>Process-local statistics since startup. Database counts measure application database calls, including batches.</p>
    <h2>Requests</h2><p>${snapshot.requests.count} requests · Mean ${snapshot.requests.meanMs} ms · ${snapshot.requests.failures} failures</p>${table(snapshot.routes)}
    <h2>Database</h2><p>${snapshot.database.count} calls · Mean ${snapshot.database.meanMs} ms · ${snapshot.database.failures} failures</p>${table(snapshot.operations)}
    <h2>Backups</h2><p>Latest successful backup: ${esc(backupAt||'None recorded')}</p>
    <p>Latest result since startup: ${esc(snapshot.backup.latestResult)}</p>
    <p>Latest failure since startup: ${esc(snapshot.backup.lastFailureAt||'None')}</p>
    <p>Scheduler: ${scheduler?.stopped?'stopped':scheduler?.running?'running a check':'waiting for next check'}</p>
    <p><a href="/system/diagnostics">Review data integrity</a> · <a href="/setup?section=backups">Backup settings</a></p>
    </section></div>`;
}

module.exports = { createOperationalMonitor, sqlOperation, databaseReady, renderOperationalPage };
