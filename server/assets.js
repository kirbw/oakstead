const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// Read and assemble once at startup; no bundler, eval, or request-time file work.
const read = name => fs.readFileSync(path.join(__dirname, 'browser', name), 'utf8');
const APP_STYLESHEET = ['app.css', 'ui.css'].map(read).join('\n');
const APP_CLIENT_SCRIPT = ['ui-feedback.js', 'browser-request.js', 'score-save-queue.js', 'app.js'].map(read).join('\n;\n');

function contentVersion(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
}
const APP_STYLESHEET_VERSION = contentVersion(APP_STYLESHEET);
const APP_CLIENT_SCRIPT_VERSION = contentVersion(APP_CLIENT_SCRIPT);
function staticAsset(text, contentType) {
  const body = Buffer.from(text);
  return { contentType, body, gzipped: zlib.gzipSync(body) };
}
const STATIC_ASSETS = new Map([
  ['/assets/app.css', staticAsset(APP_STYLESHEET, 'text/css; charset=utf-8')],
  ['/assets/app.js', staticAsset(APP_CLIENT_SCRIPT, 'text/javascript; charset=utf-8')]
]);

module.exports = { APP_STYLESHEET_VERSION, APP_CLIENT_SCRIPT_VERSION, STATIC_ASSETS };
