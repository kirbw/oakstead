const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReleaseCommands } = require('../server/release-commands');
const { schoolFixture } = require('./helpers/school');
const path = require('node:path');

test('delayed release check permits health and grade writes, rejects conflicting operations', async t => {
  const app = await schoolFixture(t, { entryPoint: path.join(__dirname, 'helpers/release-app.js') });
  const checking = app.post('/system-update/check', { channel: 'stable' }, 'admin');
  for (let i = 0; !app.logs().includes('TEST_RELEASE_FETCH') && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(app.logs(), /TEST_RELEASE_FETCH/);
  assert.equal((await app.request('/health')).status, 200);
  assert.equal((await app.post('/gradebook', { action: 'grid-score', assignmentId: '101', studentId: '101', scoreValue: '90' })).status, 200);
  for (const route of ['/system-update/check', '/system-update']) {
    const busy = await app.post(route, {}, 'admin');
    assert.equal(busy.status, 409);
    assert.match(await busy.text(), /already in progress/);
  }
  const response = await checking;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).latestTag, 'v998.0.0');
  assert.equal(app.withDb(db => db.prepare('SELECT score FROM os_scores WHERE assignment_id=101 AND student_id=101').get()).score, 90);
});

test('release commands preserve arguments and keep the event loop responsive', async () => {
  const commands = createReleaseCommands();
  let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 20);
  const output = await commands.run(process.execPath, ['-e', 'setTimeout(()=>console.log(process.argv[1]),100)', 'literal; argument']);
  clearTimeout(timer);
  assert.equal(output, 'literal; argument');
  assert.equal(ticked, true);
  await commands.stop();
});

test('release commands reject missing programs, failed commands and excessive output', async () => {
  const commands = createReleaseCommands({ maxBytes: 100 });
  await assert.rejects(commands.run('oakstead-nonexistent-test-command', []), /ENOENT/);
  await assert.rejects(commands.run(process.execPath, ['-e', 'process.exit(2)']), /exit 2/);
  await assert.rejects(commands.run(process.execPath, ['-e', 'console.log("x".repeat(200));setInterval(()=>{},1000)']), /output exceeded/);
  await commands.stop();
});

test('deadline and shutdown terminate commands and reject further work', async () => {
  const commands = createReleaseCommands();
  await assert.rejects(commands.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { deadline: Date.now() + 200 }), /timed out/);
  const pending = commands.run(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  const rejected = assert.rejects(pending, /shutdown/);
  await commands.stop();
  await rejected;
  await assert.rejects(commands.run(process.execPath, []), /shutting down/);
});

test('timeout removes a real spawned descendant as well as its parent', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oakstead-release-tree-'));
  const pidFile = path.join(directory, 'child.pid');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const commands = createReleaseCommands();
  const script = `const cp=require('node:child_process'); const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(commands.run(process.execPath, ['-e', script, pidFile], { deadline: Date.now() + 1000 }), /timed out/);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid); } catch {} });
  for (let i=0;i<50;i++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Descendant survived process-tree termination');
});
