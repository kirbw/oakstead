const crypto = require('crypto');
const querystring = require('querystring');

function safeInternalPath(value, fallback = '/') {
  try {
    const pathname = new URL(String(value ?? ''), 'http://localhost').pathname;
    return pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : fallback;
  } catch {
    return fallback;
  }
}

function createHttpHelpers({ escapeHtml, maxBodySize, scriptHash }) {
  const scriptSrc = scriptHash ? `'self' 'sha256-${scriptHash}'` : "'self' 'unsafe-inline'";
  function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
      const [key, ...rest] = part.trim().split('=');
      if (key) cookies[key] = decodeURIComponent(rest.join('='));
      return cookies;
    }, {});
  }

  function cookieValue(value) {
    return encodeURIComponent(String(value)).replace(/%20/g, '+');
  }

  function appendSetCookie(headers, cookie) {
    const existing = headers['Set-Cookie'];
    if (!existing) {
      headers['Set-Cookie'] = cookie;
      return;
    }
    headers['Set-Cookie'] = Array.isArray(existing) ? [...existing, cookie] : [existing, cookie];
  }

  function getOrCreateCsrfToken(req, headers) {
    const cookies = parseCookies(req);
    let token = cookies.csrfToken;
    if (!token || !/^[a-f0-9]{48}$/.test(token)) {
      token = crypto.randomBytes(24).toString('hex');
      appendSetCookie(headers, `csrfToken=${cookieValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    }
    return token;
  }

  function csrfInput(token) {
    return `<input type="hidden" name="csrfToken" value="${escapeHtml(token)}" />`;
  }

  function requireCsrf(req, body) {
    const cookies = parseCookies(req);
    return Boolean(body.csrfToken && cookies.csrfToken && body.csrfToken === cookies.csrfToken);
  }

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      const contentType = String(req.headers['content-type'] || '');
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > maxBodySize) {
          reject(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (contentType.includes('multipart/form-data')) return resolve(parseMultipart(buffer, contentType));
        return resolve(querystring.parse(buffer.toString()));
      });
      req.on('error', reject);
    });
  }

  function parseMultipart(buffer, contentType) {
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) return {};
    const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
    const parts = buffer.toString('latin1').split(boundary).slice(1, -1);
    return parts.reduce((body, rawPart) => {
      const part = rawPart.replace(/^\r\n/, '').replace(/\r\n$/, '');
      const splitAt = part.indexOf('\r\n\r\n');
      if (splitAt < 0) return body;
      const headerText = part.slice(0, splitAt);
      const valueText = part.slice(splitAt + 4);
      const name = headerText.match(/name="([^"]+)"/i)?.[1];
      if (!name) return body;
      const filename = headerText.match(/filename="([^"]*)"/i)?.[1];
      if (filename !== undefined) {
        body[name] = {
          filename,
          contentType: headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream',
          data: Buffer.from(valueText, 'latin1')
        };
        return body;
      }
      body[name] = valueText;
      return body;
    }, {});
  }

  function securityHeaders() {
    return {
      // style-src keeps 'unsafe-inline' as an accepted trade-off: the app uses inline style attributes and style-injection is far lower risk than script-injection. script-src is locked to a sha256 hash of the one static inline script.
      'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
  }

  function sendHtml(res, html, headers = {}) {
    res.writeHead(200, { ...securityHeaders(), ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  function sendText(res, status, text, headers = {}) {
    res.writeHead(status, { ...securityHeaders(), ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  function sendJson(res, status, data, headers = {}) {
    res.writeHead(status, { ...securityHeaders(), ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  function redirect(res, location, headers = {}) {
    res.writeHead(302, { ...securityHeaders(), ...headers, Location: location });
    res.end();
  }

  return {
    appendSetCookie,
    cookieValue,
    csrfInput,
    getOrCreateCsrfToken,
    parseBody,
    parseCookies,
    redirect,
    requireCsrf,
    securityHeaders,
    sendHtml,
    sendJson,
    sendText
  };
}

module.exports = { createHttpHelpers, safeInternalPath };
