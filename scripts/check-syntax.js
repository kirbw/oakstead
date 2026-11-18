const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function check(file) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
}
function directory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) directory(file);
    else if (entry.name.endsWith('.js')) check(file);
  }
}
check(path.join(root, 'server.js'));
directory(path.join(root, 'server'));
console.log('Server and browser JavaScript syntax checks passed.');
