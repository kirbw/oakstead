const { SCHEMA_SQL, applyAdditiveMigrations, validateApplicationSchema } = require('./schema');
const { HISTORY_SCHEMA_SQL } = require('./history-schema');

// Version 1 establishes the existing application schema; subsequent changes must
// append a numbered step rather than modifying an already released migration.
const MIGRATIONS = Object.freeze([{ version: 1, up: applyAdditiveMigrations },
  { version: 2, up: connection => connection.exec(HISTORY_SCHEMA_SQL) }]);
const CURRENT_SCHEMA_VERSION = 2;

function migrateDatabase(connection, { migrations = MIGRATIONS, allowEmpty = true } = {}) {
  const target = migrations.at(-1)?.version || 0;
  if (migrations.some((step, index) => step.version !== index + 1 || typeof step.up !== 'function')) {
    throw new Error('Database migrations must be consecutive numbered steps.');
  }
  const current = connection.prepare('PRAGMA user_version;').get().user_version;
  if (current > target) throw new Error(`Database schema version ${current} is newer than supported version ${target}. Use a compatible Oakstead version; downgrades are not supported.`);
  const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all();
  const fresh = tables.length === 0;
  if (fresh && (!allowEmpty || current !== 0)) throw new Error('Database is missing required Oakstead tables.');
  if (!fresh) validateApplicationSchema(connection, { allowAdditive: current === 0, schemaVersion: current });
  connection.exec('SAVEPOINT oakstead_migrations;');
  try {
    if (fresh) connection.exec(SCHEMA_SQL);
    for (const step of migrations) {
      if (step.version <= current) continue;
      step.up(connection);
      connection.exec(`PRAGMA user_version=${step.version};`);
    }
    validateApplicationSchema(connection, { schemaVersion: target });
    connection.exec('RELEASE oakstead_migrations;');
  } catch (error) {
    connection.exec('ROLLBACK TO oakstead_migrations; RELEASE oakstead_migrations;');
    throw error;
  }
  return target;
}

module.exports = { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateDatabase };
