// Also embedded in the browser bundle: keep this factory dependency-free.
function createScoreSaveQueue({ send, onChange = () => {}, debounceMs = 550, timeoutMs = 30000 }) {
  const entries = new Map();
  let timer;
  let running;
  let halted = false;

  function dirty(entry) { return entry.value !== entry.saved || entry.sending || entry.error; }
  function notify(entry, result) { onChange(entry, result, { halted, dirty: isDirty() }); }
  function isDirty() { return [...entries.values()].some(dirty); }
  function edit(key, value, context, original) {
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, value: original, saved: original, context, sending: false, error: false };
      entries.set(key, entry);
    }
    entry.value = value;
    entry.context = context;
    notify(entry);
    clearTimeout(timer);
    timer = setTimeout(() => { void drain(); }, debounceMs);
  }
  async function drain() {
    clearTimeout(timer);
    if (running) return running;
    if (halted) return false;
    // Defer to a microtask so `running` is assigned even when there is no work.
    running = Promise.resolve().then(async () => {
      let entry;
      while (!halted && (entry = [...entries.values()].find(dirty))) {
        const value = entry.value;
        const controller = new AbortController();
        let timeout;
        entry.sending = true;
        notify(entry);
        try {
          const result = await Promise.race([
            Promise.resolve().then(() => send(entry.context, value, controller.signal)),
            new Promise((_, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(new Error('Save timed out'));
              }, timeoutMs);
            })
          ]);
          entry.saved = value;
          entry.sending = false;
          entry.error = false;
          entry.failure = undefined;
          notify(entry, result);
        } catch (error) {
          entry.sending = false;
          entry.error = true;
          entry.failure = { message: error.message, requestId: error.requestId, status: error.status };
          halted = true;
          notify(entry);
        } finally {
          clearTimeout(timeout);
        }
      }
      return !halted && !isDirty();
    }).finally(() => { running = undefined; });
    return running;
  }
  async function retry() {
    if (running) await running;
    halted = false;
    return drain();
  }
  async function discard() {
    clearTimeout(timer);
    if (running) await running;
    halted = false;
    for (const entry of entries.values()) {
      entry.value = entry.saved;
      entry.error = false;
      entry.failure = undefined;
      notify(entry);
    }
  }
  function forgetClean() {
    for (const [key, entry] of entries) if (!dirty(entry) && !entry.error) entries.delete(key);
  }
  return { edit, flush: drain, retry, discard, isDirty, forgetClean };
}

module.exports = { createScoreSaveQueue };
