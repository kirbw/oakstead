const fs = require('fs');
const path = require('path');
const { applyAdditiveMigrations, validateApplicationSchema, smokeCheck } = require('./schema');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`Oakstead requires Node.js 22.13 or newer for the built-in node:sqlite module. You are running ${process.version}.`);
  console.error('Node 22.5-22.12 exposes node:sqlite only behind the --experimental-sqlite flag, so upgrade to Node 22.13+ (or 24+) rather than adding a flag.');
  console.error('On Debian/Ubuntu: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs');
  process.exit(1);
}

function createDb({ dbFile, files = fs }) {
  let db = null;

  function open() {
    if (db) return db;
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    db = new DatabaseSync(dbFile);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    return db;
  }

  function close() {
    if (!db) return;
    try { db.close(); } catch {}
    db = null;
  }

  function runSql(sql) {
    open().exec(String(sql));
    return '';
  }

  function querySql(sql) {
    return open().prepare(String(sql)).all();
  }

  function insertReturningId(sql) {
    const row = querySql(`${sql} RETURNING id;`)[0];
    const id = Number(row?.id);
    return Number.isInteger(id) && id >= 0 ? id : 0;
  }

  function runSqlTransaction(transactionSql) {
    if (!transactionSql) return;
    const connection = open();
    try {
      connection.exec(transactionSql);
    } catch (error) {
      // The CLI backend rolled back automatically when the subprocess died; a
      // persistent connection would otherwise be left inside the failed
      // transaction, poisoning every later write.
      try { connection.exec('ROLLBACK;'); } catch {}
      throw error;
    }
  }

  function checkpoint() {
    return open().prepare('PRAGMA wal_checkpoint(TRUNCATE);').get() || {};
  }

  let transactionId = 0;
  function transaction(fn) {
    const connection = open();
    const savepoint = `oakstead_tx_${++transactionId}`;
    connection.exec(`SAVEPOINT ${savepoint};`);
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new Error('Database transactions require synchronous callbacks.');
      connection.exec(`RELEASE ${savepoint};`);
      return result;
    } catch (error) {
      try { connection.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint};`); } catch {}
      throw error;
    }
  }

  function withDatabaseClosed(fn) {
    close();
    try {
      fs.rmSync(`${dbFile}-wal`, { force: true });
      fs.rmSync(`${dbFile}-shm`, { force: true });
      return fn();
    } finally {
      open();
    }
  }

  function validateBackupDatabase(filePath) {
    let candidate = null;
    try {
      candidate = new DatabaseSync(filePath, { readOnly: true });
      const result = candidate.prepare('PRAGMA quick_check;').get();
      if (result?.quick_check !== 'ok') throw new Error('quick_check failed');
    } catch {
      throw new Error('Backup database did not pass integrity check.');
    } finally {
      try { candidate?.close(); } catch {}
    }
  }

  function applySchemaMigrations() {
    applyAdditiveMigrations(open());
  }

  function restoreDatabase(source, { beforeReplace = () => {}, verify = () => {} } = {}) {
    const stagingDir = files.mkdtempSync(path.join(path.dirname(dbFile), '.oakstead-restore-'));
    const candidateFile = path.join(stagingDir, 'candidate.db');
    const originalFile = path.join(stagingDir, 'original.db');
    let originalMoved = false;
    let retainRecovery = false;
    try {
      files.copyFileSync(source, candidateFile);
      let candidate;
      try {
        validateBackupDatabase(candidateFile);
        candidate = new DatabaseSync(candidateFile);
        validateApplicationSchema(candidate, { allowAdditive: true });
        applyAdditiveMigrations(candidate);
        smokeCheck(candidate);
      } catch (error) {
        throw Object.assign(new Error(`Cannot restore backup: ${error.message}`), { statusCode: 400 });
      } finally { candidate?.close(); }
      validateBackupDatabase(candidateFile);
      beforeReplace();
      if (checkpoint().busy) throw new Error('Database is busy. Close other database connections before restoring.');
      close();
      try {
        files.renameSync(dbFile, originalFile);
        originalMoved = true;
        files.renameSync(candidateFile, dbFile);
        smokeCheck(open());
        verify();
      } catch (error) {
        close();
        if (originalMoved) {
          try {
            files.rmSync(dbFile, { force: true });
            files.rmSync(`${dbFile}-wal`, { force: true });
            files.rmSync(`${dbFile}-shm`, { force: true });
            files.renameSync(originalFile, dbFile);
            originalMoved = false;
          } catch (recoveryError) {
            retainRecovery = true;
            console.error(`Restore recovery requires attention. Original database retained at ${originalFile}`, recoveryError);
            throw new Error('Restore failed and automatic recovery could not complete. The original database has been retained for recovery.');
          }
        }
        open();
        throw error;
      }
    } finally {
      if (!retainRecovery) files.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  process.on('exit', close);

  return {
    applySchemaMigrations,
    checkpoint,
    close,
    insertReturningId,
    querySql,
    runSql,
    runSqlTransaction,
    restoreDatabase,
    transaction,
    validateBackupDatabase,
    withDatabaseClosed
  };
}

module.exports = { createDb };
