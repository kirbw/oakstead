const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'windows');
const VENDOR = path.join(ROOT, 'packaging', 'windows', 'vendor');
const IGNORED_SOURCES = new Set([
  path.join(ROOT, 'public', 'uploads')
]);

const APP_ITEMS = [
  'server.js',
  'package.json',
  'package-lock.json',
  'README.md',
  'RELEASE_NOTES.md',
  'LICENSE',
  'html2pdf.bundle.min.js',
  'assets',
  'public',
  'scripts'
];

function copyRecursive(source, target) {
  if (IGNORED_SOURCES.has(source)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((entry) => {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function requirePath(source, label) {
  if (!fs.existsSync(source)) {
    console.error(`Missing ${label}: ${path.relative(ROOT, source)}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function copyRequired(source, target, label) {
  if (requirePath(source, label)) copyRecursive(source, target);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

APP_ITEMS.forEach((item) => {
  copyRecursive(path.join(ROOT, item), path.join(DIST, 'app', item));
});

copyRequired(path.join(VENDOR, 'node'), path.join(DIST, 'runtime', 'node'), 'Node.js Windows runtime');
copyRequired(path.join(VENDOR, 'sqlite'), path.join(DIST, 'runtime', 'sqlite'), 'SQLite Windows tools');
copyRequired(path.join(VENDOR, 'winsw', 'Oakstead.Service.exe'), path.join(DIST, 'service', 'Oakstead.Service.exe'), 'WinSW service executable');
copyRecursive(path.join(ROOT, 'packaging', 'windows', 'service', 'Oakstead.Service.xml'), path.join(DIST, 'service', 'Oakstead.Service.xml'));
copyRecursive(path.join(ROOT, 'packaging', 'windows', 'open-oakstead.cmd'), path.join(DIST, 'open-oakstead.cmd'));

if (process.exitCode) {
  console.error('Windows package prep failed. Add the missing vendor files and run again.');
} else {
  console.log(`Windows package staged in ${path.relative(ROOT, DIST)}`);
}
