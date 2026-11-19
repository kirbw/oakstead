const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function retentionCount(value) {
  const text = String(value ?? '0');
  const count = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(count) || (count !== 0 && count < 3)) {
    throw Object.assign(new Error('Keep all backups, or retain at least three scheduled backups.'), { statusCode: 400 });
  }
  return count;
}

function scheduledTimestamp(name) {
  const match = /^oakstead-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-scheduled(?:-[a-f0-9]{12})?\.db$/.exec(name);
  if (!match) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const time = new Date(iso);
  return Number.isFinite(time.getTime()) && time.toISOString() === iso ? time.getTime() : null;
}

function createBackupStorage({ backupDir, dbFile, checkpoint, withDatabaseClosed, validate,
  files = fs, now = () => new Date(), nonce = () => crypto.randomBytes(6).toString('hex') }) {
  const directory = path.resolve(backupDir);
  function checkDirectory() {
    const stat = files.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Backup location must be a regular directory.');
    return files.realpathSync(directory);
  }
  function regularFile(name) {
    if (path.basename(name) !== name || name === '.' || name === '..') return null;
    const target = path.resolve(directory, name);
    if (path.dirname(target) !== directory) return null;
    const stat = files.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink() ? { fileName: name, path: target, stat } : null;
  }
  function scheduled() {
    if (!files.existsSync(directory)) return [];
    checkDirectory();
    return files.readdirSync(directory).flatMap(name => {
      const timestamp = scheduledTimestamp(name);
      if (timestamp === null) return [];
      const file = regularFile(name);
      return file ? [{ ...file, timestamp }] : [];
    }).sort((a, b) => b.timestamp - a.timestamp || b.fileName.localeCompare(a.fileName));
  }
  function preview(count, afterNextBackup = false) {
    count = retentionCount(count);
    if (!count) return [];
    return scheduled().slice(Math.max(0, count - (afterNextBackup ? 1 : 0))).map(file => file.fileName);
  }
  function cleanup(count) {
    const result = { deleted: [], failed: [], error: false };
    try {
      if (!retentionCount(count)) return result;
      const root = checkDirectory();
      for (const name of preview(count)) {
        try {
          if (checkDirectory() !== root) throw new Error('Backup directory changed.');
          const file = regularFile(name);
          if (!file || scheduledTimestamp(name) === null) throw new Error('Backup file changed.');
          files.unlinkSync(file.path);
          result.deleted.push(name);
        } catch { result.failed.push(name); }
      }
    } catch { result.error = true; }
    return result;
  }
  function publish(reason) {
    files.mkdirSync(directory, { recursive: true });
    checkDirectory();
    const safeReason = String(reason).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual';
    const token = nonce();
    if (!/^[a-f0-9]{12}$/.test(token)) throw new Error('Invalid backup identifier.');
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const fileName = `oakstead-backup-${stamp}-${safeReason}-${token}.db`;
    const target = path.join(directory, fileName);
    const temporary = path.join(directory, `.oakstead-pending-${token}.db`);
    if (files.existsSync(target) || files.existsSync(temporary)) throw new Error('Backup filename collision; retry the backup.');
    let created = false;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 3 && !ready; attempt++) ready = !checkpoint().busy;
      const copy = () => {
        const handle = files.openSync(temporary, 'wx', 0o600);
        created = true;
        files.closeSync(handle);
        files.copyFileSync(dbFile, temporary);
      };
      if (ready) copy(); else withDatabaseClosed(copy);
      validate(temporary);
      const size = files.statSync(temporary).size;
      if (!size) throw new Error('Backup validation failed: empty file.');
      files.renameSync(temporary, target);
      created = false;
      return { fileName, path: target, size };
    } finally {
      if (created) { try { files.unlinkSync(temporary); } catch { /* Never publish a failed candidate. */ } }
    }
  }
  return { publish, preview, cleanup };
}
module.exports = { retentionCount, scheduledTimestamp, createBackupStorage };
