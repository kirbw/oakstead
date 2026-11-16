const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScoreSaveQueue } = require('../server/score-save-queue');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('navigation flush saves detached-independent edits serially and coalesces typing', async () => {
  const first = deferred();
  const calls = [];
  const queue = createScoreSaveQueue({ send: async (context, value) => {
    calls.push([context.studentId, value]);
    if (calls.length === 1) await first.promise;
    return { ok: true };
  } });
  queue.edit('1:101:101', '90', { studentId: '101' }, '');
  const navigation = queue.flush();
  await tick();
  queue.edit('1:101:102', '7', { studentId: '102' }, '');
  queue.edit('1:101:102', '75', { studentId: '102' }, '');
  assert.deepEqual(calls, [['101', '90']]);
  assert.equal(queue.isDirty(), true);
  first.resolve();
  assert.equal(await navigation, true);
  assert.deepEqual(calls, [['101', '90'], ['102', '75']]);
  assert.equal(queue.isDirty(), false);
});

test('an edit reverted while in flight is saved again, including clearing and zero', async () => {
  const first = deferred();
  const values = [];
  const queue = createScoreSaveQueue({ send: async (_, value) => {
    values.push(value);
    if (values.length === 1) await first.promise;
  } });
  queue.edit('cell', '90', {}, '80');
  const flushed = queue.flush();
  await tick();
  queue.edit('cell', '80', {}, '80');
  first.resolve();
  assert.equal(await flushed, true);
  assert.deepEqual(values, ['90', '80']);
  queue.edit('cell', '', {}, '80');
  await queue.flush();
  queue.edit('cell', '0', {}, '');
  await queue.flush();
  assert.deepEqual(values, ['90', '80', '', '0']);
});

test('failure blocks later writes and navigation until explicit retry of latest value', async () => {
  const calls = [];
  let fail = true;
  const queue = createScoreSaveQueue({ send: async (_, value) => {
    calls.push(value);
    if (fail) throw Error('Forbidden');
  } });
  queue.edit('one', '90', {}, '');
  queue.edit('two', '70', {}, '');
  assert.equal(await queue.flush(), false);
  assert.equal(queue.isDirty(), true);
  queue.edit('one', '95', {}, '');
  assert.equal(await queue.flush(), false);
  assert.deepEqual(calls, ['90']);
  fail = false;
  assert.equal(await queue.retry(), true);
  assert.deepEqual(calls, ['90', '95', '70']);
});

test('timeout aborts a stalled request and explicit discard releases unsaved work', async () => {
  let signal;
  const queue = createScoreSaveQueue({ timeoutMs: 10, send: async (_, value, requestSignal) => {
    signal = requestSignal;
    return new Promise(() => {});
  } });
  queue.edit('cell', '90', {}, '80');
  assert.equal(await queue.flush(), false);
  assert.equal(signal.aborted, true);
  assert.equal(queue.isDirty(), true);
  await queue.discard();
  assert.equal(queue.isDirty(), false);
  assert.equal(await queue.flush(), true);
});

test('debounce sends the final typed value without a change/blur event', async () => {
  const sent = deferred();
  const values = [];
  const queue = createScoreSaveQueue({ debounceMs: 10, send: async (_, value) => {
    values.push(value);
    sent.resolve();
  } });
  queue.edit('cell', '9', {}, '');
  queue.edit('cell', '90', {}, '');
  await sent.promise;
  await queue.flush();
  assert.deepEqual(values, ['90']);
});

test('failed ambiguous write still requires a retry when the user reverts to the original', async () => {
  let calls = 0;
  const queue = createScoreSaveQueue({ send: async () => { if (++calls === 1) throw Error('Lost response'); } });
  queue.edit('cell', '90', {}, '80');
  await queue.flush();
  queue.edit('cell', '80', {}, '80');
  assert.equal(queue.isDirty(), true);
  assert.equal(await queue.retry(), true);
  assert.equal(calls, 2);
});
