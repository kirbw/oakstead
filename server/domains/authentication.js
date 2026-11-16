const { text, json, redirectTo } = require('./results');
const { formRecord } = require('./validation');
const { safeInternalPath } = require('../http');
function createService({
  appendSetCookie,
  asInt,
  cleanText,
  clearLoginFailures,
  clearSession,
  cookieValue,
  createSession,
  db,
  loginThrottleStatus,
  querySql,
  recordLoginFailure,
  requireCsrf,
  sqlValue,
  verifyPassword,
}) {
  return { paths: new Set(["/login","/logout","/switch-year"]), async execute(p, body, user, req) {
    formRecord(body);
    const headers = {};
    if (p === '/login') {
      if (!requireCsrf(req, body)) return text(403, 'Invalid CSRF token');
      const username = cleanText(body.username, 80).toLowerCase();
      const password = String(body.password || '').slice(0, 120);
      const throttle = loginThrottleStatus(req, username);
      if (throttle) return text(429, 'Too many sign-in attempts. Please try again later.', { 'Retry-After': String(throttle.retryAfter) });
      const row = querySql(`SELECT * FROM os_users WHERE username=${sqlValue(username)} LIMIT 1;`)[0];
      let valid = false;
      try { valid = Boolean(row) && await verifyPassword(password, row.password_hash); }
      catch (error) {
        if (error.code === 'AUTH_BUSY') return text(503, 'Sign-in is busy. Please try again shortly.', { 'Retry-After': '1' });
        throw error;
      }
      // Other attempts, password changes or deletion may finish while scrypt runs.
      const currentThrottle = loginThrottleStatus(req, username);
      if (currentThrottle) return text(429, 'Too many sign-in attempts. Please try again later.', { 'Retry-After': String(currentThrottle.retryAfter) });
      const current = row && querySql(`SELECT * FROM os_users WHERE id=${asInt(row.id)} LIMIT 1;`)[0];
      if (!valid || !current || current.password_hash !== row.password_hash) {
        recordLoginFailure(req, username);
        return redirectTo('/login?error=1', headers);
      }
      clearLoginFailures(req, username);
      db.transaction(() => {
        clearSession(req, headers);
        createSession(row.id, headers);
      });
      return redirectTo('/', headers);
    }

    if (p === '/logout') {
      clearSession(req, headers);
      return redirectTo('/login', headers);
    }

    if (p === '/switch-year') {
      const yearId = asInt(body.yearId);
      appendSetCookie(headers, `selectedYearId=${cookieValue(yearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      return redirectTo(safeInternalPath(req.headers.referer), headers);
    }

    return text(404, 'Not Found');
  } };
}
module.exports = { createService };
