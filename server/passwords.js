const crypto = require('node:crypto');

// Bound both memory-heavy scrypt jobs and callers waiting for a slot.
function createPasswordVerifier({ concurrency = 4, maxPending = 64, scrypt = crypto.scrypt } = {}) {
  let active = 0;
  const pending = [];
  function pump() {
    while (active < concurrency && pending.length) {
      const { password, salt, expected, resolve, reject } = pending.shift();
      active++;
      const finish = (error, actual) => {
        active--;
        if (error) reject(error);
        else resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
        pump();
      };
      try { scrypt(String(password), salt, 64, finish); }
      catch (error) { finish(error); }
    }
  }
  return function verifyPassword(password, encoded) {
    const match = /^([^:]+):([a-f0-9]{128})$/i.exec(String(encoded || ''));
    if (!match) return Promise.resolve(false);
    if (active >= concurrency && pending.length >= maxPending) {
      return Promise.reject(Object.assign(new Error('Password verification capacity reached'), { code: 'AUTH_BUSY' }));
    }
    return new Promise((resolve, reject) => {
      pending.push({ password, salt: match[1], expected: Buffer.from(match[2], 'hex'), resolve, reject });
      pump();
    });
  };
}
module.exports = { createPasswordVerifier };
