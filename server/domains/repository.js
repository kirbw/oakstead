function createRepository(db) {
  return Object.freeze({ querySql: db.querySql, runSql: db.runSql, executeSql: db.executeSql,
    insertReturningId: db.insertReturningId, transaction: db.transaction });
}
module.exports = { createRepository };
