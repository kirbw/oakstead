const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { startApp } = require('./helpers/app');

test('browser assets assemble from source and survive standalone Windows package layout', t => {
  const root=path.resolve(__dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'oakstead-browser-package-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  // The Windows packager copies the entire server directory; exercise that layout.
  fs.cpSync(path.join(root,'server'),path.join(temp,'server'),{recursive:true});
  const packed=require(path.join(temp,'server/assets'));
  const normal=require('../server/assets');
  for(const [url,asset] of normal.STATIC_ASSETS) assert.deepEqual(packed.STATIC_ASSETS.get(url).body,asset.body);
  const js=packed.STATIC_ASSETS.get('/assets/app.js').body.toString();
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.ok(js.includes('function createScoreSaveQueue'));
  assert.ok(js.includes('const scoreQueue = createScoreSaveQueue('));
  assert.ok(!fs.readFileSync(path.join(root,'server/assets.js'),'utf8').includes('.toString()'));
  const file=path.join(temp,'server/browser/app.js');
  fs.appendFileSync(file,'\n// changed source\n');
  delete require.cache[require.resolve(path.join(temp,'server/assets'))];
  const changed=require(path.join(temp,'server/assets'));
  assert.notEqual(changed.APP_CLIENT_SCRIPT_VERSION,packed.APP_CLIENT_SCRIPT_VERSION);
  assert.equal(changed.APP_CLIENT_SCRIPT_VERSION,crypto.createHash('sha256').update(changed.STATIC_ASSETS.get('/assets/app.js').body).digest('hex').slice(0,8));
});

test('demo configuration is HTML data while CSS and JavaScript are mode independent', async t => {
  const normal=await startApp(t);
  const demo=await startApp(t,{demoMode:true});
  const auth=await normal.login();
  assert.match(await (await normal.request('/',{headers:{Cookie:auth.cookie}})).text(),/data-demo-mode="false"/);
  assert.match(await (await demo.request('/')).text(),/data-demo-mode="true"/);
  for(const url of ['/assets/app.css','/assets/app.js']) {
    assert.equal(await (await normal.request(url)).text(),await (await demo.request(url)).text());
  }
});
