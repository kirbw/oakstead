function backupDue(frequency, lastAt, now = new Date()) {
  const days = { daily: 1, weekly: 7, monthly: 30 }[frequency];
  if (!days) return false;
  if (!lastAt) return true;
  const last = new Date(lastAt);
  return Number.isNaN(last.getTime()) || now - last >= days * 86400000;
}

function createBackupScheduler({ isDue, createBackup, onError = console.error,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let running = false;
  let stopped = false;
  async function check() {
    if (running || stopped) return false;
    running = true;
    try {
      if (!isDue()) return false;
      await createBackup();
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally { running = false; }
  }
  const timer = setIntervalFn(() => { void check(); }, 5 * 60 * 1000);
  timer.unref();
  return {
    check,
    stop() { stopped = true; clearIntervalFn(timer); }
  };
}

module.exports = { backupDue, createBackupScheduler };
