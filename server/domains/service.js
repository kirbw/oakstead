const { formRecord } = require('./validation');

function createTransactionalService(paths, perform, repository) {
  const supported = new Set(paths);
  function execute(path, body, user) {
    if (!supported.has(path)) return null;
    formRecord(body);
    let rejected;
    try {
      return repository.transaction(() => {
        const result = perform(path, body, user, {});
        if (result.status >= 400) { rejected = result; throw result; }
        return result;
      });
    } catch (error) {
      if (error === rejected) return rejected;
      throw error;
    }
  }
  return { paths: supported, execute };
}
module.exports = { createTransactionalService };
