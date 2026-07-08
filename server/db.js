const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`Oakstead requires Node.js 22.5 or newer (node:sqlite). You are running ${process.version}.`);
  process.exit(1);
}

function createDb({ dbFile }) {
  let db = null;

  function open() {
    if (db) return db;
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    db = new DatabaseSync(dbFile);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA synchronous = NORMAL;');
    // Parity with the old sqlite3-CLI backend: each CLI spawn ran with foreign
    // keys OFF, so enforcement has never applied at runtime. Enabling it on a
    // persistent connection would make previously-working deletes throw.
    db.exec('PRAGMA foreign_keys = OFF;');
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

  process.on('exit', close);

  return {
    checkpoint,
    close,
    insertReturningId,
    querySql,
    runSql,
    runSqlTransaction,
    validateBackupDatabase,
    withDatabaseClosed
  };
}

module.exports = { createDb };
