// Browser QA only: one explicit transient save failure, then the real handler.
const http = require('node:http');
const createServer = http.createServer;
let failed = false;
http.createServer = handler => createServer(async (req, res) => {
  if (!failed && req.method === 'POST' && req.url === '/gradebook') {
    failed = true;
    req.resume();
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'Temporary test failure. Retry your save.' }));
    return;
  }
  return handler(req, res);
});
require('./release-app');
