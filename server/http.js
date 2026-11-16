const crypto = require('crypto');
const querystring = require('querystring');
const zlib = require('zlib');

function safeInternalPath(value, fallback = '/') {
  try {
    const pathname = new URL(String(value ?? ''), 'http://localhost').pathname;
    return pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : fallback;
  } catch {
    return fallback;
  }
}

function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req?.headers?.['accept-encoding'] || ''));
}

function parseMultipart(buffer, contentType) {
  const invalid = () => Object.assign(new Error('Malformed multipart form. Submit the form again.'), { statusCode: 400 });
  const match = contentType.match(/;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim();
  if (!boundary || boundary.length > 70 || !/^[\x20-\x7e]+$/.test(boundary)) throw invalid();
  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from(`\r\n--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const end = Buffer.from('--');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const body = Object.create(null);
  let position = 0;
  if (!buffer.subarray(0, marker.length).equals(marker)) throw invalid();
  position += marker.length;
  while (true) {
    if (buffer.subarray(position, position + 2).equals(end)) {
      const tail = buffer.subarray(position + 2);
      if (tail.length && !tail.equals(crlf)) throw invalid();
      return body;
    }
    if (!buffer.subarray(position, position + 2).equals(crlf)) throw invalid();
    position += 2;
    const headersEnd = buffer.indexOf('\r\n\r\n', position);
    if (headersEnd < 0) throw invalid();
    let headers;
    try { headers = decoder.decode(buffer.subarray(position, headersEnd)); }
    catch { throw invalid(); }
    const disposition = headers.match(/^Content-Disposition:\s*form-data\s*;([^\r\n]*)/im)?.[1];
    const name = disposition?.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = disposition?.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (!name) throw invalid();
    const valueStart = headersEnd + 4;
    let next = buffer.indexOf(separator, valueStart);
    // Boundary-like bytes inside a file are data unless followed by CRLF or --.
    while (next >= 0) {
      const suffix = buffer.subarray(next + separator.length, next + separator.length + 2);
      if (suffix.equals(crlf) || suffix.equals(end)) break;
      next = buffer.indexOf(separator, next + separator.length);
    }
    if (next < 0) throw invalid();
    const value = buffer.subarray(valueStart, next);
    if (filename !== undefined) {
      body[name] = { filename, contentType: headers.match(/^Content-Type:\s*([^\r\n]+)/im)?.[1] || 'application/octet-stream', data: value };
    } else {
      try { body[name] = decoder.decode(value); }
      catch { throw invalid(); }
    }
    position = next + separator.length;
  }
}

function createHttpHelpers({ escapeHtml, maxBodySize }) {
  function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
      const [key, ...rest] = part.trim().split('=');
      if (key) {
        try { cookies[key] = decodeURIComponent(rest.join('=')); }
        catch { /* Ignore this cookie; other cookies may still be valid. */ }
      }
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
        try {
          if (/^multipart\/form-data(?:;|$)/i.test(contentType)) return resolve(parseMultipart(buffer, contentType));
          resolve(querystring.parse(buffer.toString('utf8')));
        } catch (error) { reject(error); }
      });
      req.on('error', reject);
    });
  }

  function securityHeaders() {
    return {
      // style-src keeps 'unsafe-inline' as an accepted trade-off: the app uses inline style attributes and style-injection is far lower risk than script-injection.
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
  }

  function sendHtml(req, res, html, headers = {}) {
    const baseHeaders = { ...securityHeaders(), ...headers, 'Content-Type': 'text/html; charset=utf-8' };
    if (acceptsGzip(req)) {
      res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      res.end(zlib.gzipSync(Buffer.from(html)));
      return;
    }
    res.writeHead(200, baseHeaders);
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

module.exports = { acceptsGzip, createHttpHelpers, parseMultipart, safeInternalPath };
