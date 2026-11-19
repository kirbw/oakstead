const { formRecord } = require('./validation');

function createTransactionalService(paths, perform, repository, history) {
  const supported = new Set(paths);
  function execute(path, body, user, req) {
    if (!supported.has(path)) return null;
    formRecord(body);
    let rejected;
    try {
      return repository.transaction(() => {
        const before = history?.capture(path, body);
        const result = perform(path, body, user, {});
        if (result.status >= 400) { rejected = result; throw result; }
        if (before) history.record(before, user, req?.requestId || '');
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
