const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const querystring = require('querystring');
const { execFileSync } = require('child_process');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'school.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DEFAULT_LOGO_FILE = path.join(PUBLIC_DIR, 'oakstead-logo.svg');
const DEFAULT_SCHOOL_NAME = 'Oakstead';
const MAX_BODY_SIZE = 4_000_000;
const SESSION_HOURS = 12;

const ROLE_ADMIN = 'admin';
const ROLE_TEACHER = 'teacher';
const ROLES = [ROLE_ADMIN, ROLE_TEACHER];
const CATEGORIES = ['Lesson', 'Quiz', 'Test'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function cleanText(value, max = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanDate(value) {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanGrade(value) {
  return cleanText(value, 24);
}

function asScore(value) {
  if (String(value ?? '').trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1000, parsed));
}

function runSql(sql) {
  return execFileSync('sqlite3', [DB_FILE, sql], { encoding: 'utf8' });
}

function querySql(sql) {
  const out = execFileSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

function insertReturningId(sql) {
  const row = querySql(`${sql} RETURNING id;`)[0];
  return asInt(row?.id);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  if (!encoded || !String(encoded).includes(':')) return false;
  const [salt, expected] = String(encoded).split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

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
  return `<input type="hidden" name="csrfToken" value="${esc(token)}" />`;
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
      if (size > MAX_BODY_SIZE) {
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
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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

function redirect(res, location, headers = {}) {
  res.writeHead(302, { ...securityHeaders(), ...headers, Location: location });
  res.end();
}

function ensureDb() {
  runSql(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS os_school_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES os_families(id)
);
CREATE TABLE IF NOT EXISTS os_teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  teacher_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id),
  FOREIGN KEY (teacher_id) REFERENCES os_teachers(id)
);
CREATE TABLE IF NOT EXISTS os_classroom_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL,
  grade_level TEXT NOT NULL,
  UNIQUE (classroom_id, grade_level),
  FOREIGN KEY (classroom_id) REFERENCES os_classrooms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS os_student_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  school_year_id INTEGER NOT NULL,
  grade_level TEXT NOT NULL,
  classroom_id INTEGER,
  status TEXT NOT NULL DEFAULT 'enrolled',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, school_year_id),
  FOREIGN KEY (student_id) REFERENCES os_students(id),
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id),
  FOREIGN KEY (classroom_id) REFERENCES os_classrooms(id)
);
CREATE TABLE IF NOT EXISTS os_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_grade_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  grade_level TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  UNIQUE (school_year_id, grade_level, subject_id),
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id),
  FOREIGN KEY (subject_id) REFERENCES os_subjects(id)
);
CREATE TABLE IF NOT EXISTS os_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  grade_level TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  classroom_id INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  assignment_date TEXT,
  max_score REAL NOT NULL DEFAULT 100,
  teacher_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id),
  FOREIGN KEY (subject_id) REFERENCES os_subjects(id),
  FOREIGN KEY (classroom_id) REFERENCES os_classrooms(id),
  FOREIGN KEY (teacher_id) REFERENCES os_teachers(id)
);
CREATE TABLE IF NOT EXISTS os_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  score REAL,
  note TEXT,
  UNIQUE (assignment_id, student_id),
  FOREIGN KEY (assignment_id) REFERENCES os_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES os_students(id)
);
CREATE TABLE IF NOT EXISTS os_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  teacher_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES os_teachers(id)
);
CREATE TABLE IF NOT EXISTS os_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES os_users(id)
);
CREATE TABLE IF NOT EXISTS os_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_os_sessions_token ON os_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_os_student_years_year_grade ON os_student_years(school_year_id, grade_level);
CREATE INDEX IF NOT EXISTS idx_os_assignments_year_grade_subject ON os_assignments(school_year_id, grade_level, subject_id);
`);

  runSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('school_name', ${sqlValue(DEFAULT_SCHOOL_NAME)});`);

  const yearCount = querySql('SELECT COUNT(*) AS count FROM os_school_years')[0]?.count || 0;
  if (!yearCount) {
    runSql(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
      VALUES ('2025-2026', '2025-08-15', '2026-05-31', 1);`);
  }

  const userCount = querySql('SELECT COUNT(*) AS count FROM os_users')[0]?.count || 0;
  if (!userCount) {
    runSql(`INSERT INTO os_users (name, username, role, password_hash)
      VALUES ('System Administrator', 'admin', '${ROLE_ADMIN}', ${sqlValue(hashPassword('ChangeMeNow!'))});`);
  }

  runSql("DELETE FROM os_sessions WHERE expires_at <= datetime('now');");
}

function createSession(userId, headers) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  runSql(`INSERT INTO os_sessions (session_token, user_id, expires_at)
    VALUES (${sqlValue(token)}, ${asInt(userId)}, ${sqlValue(expiresAt)});`);
  appendSetCookie(headers, `sessionToken=${cookieValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`);
}

function clearSession(req, headers) {
  const token = parseCookies(req).sessionToken;
  if (token) runSql(`DELETE FROM os_sessions WHERE session_token=${sqlValue(token)};`);
  appendSetCookie(headers, 'sessionToken=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function currentUser(req) {
  const token = parseCookies(req).sessionToken;
  if (!token) return null;
  const rows = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id
    FROM os_sessions s
    JOIN os_users u ON u.id = s.user_id
    WHERE s.session_token=${sqlValue(token)} AND s.expires_at > datetime('now')
    LIMIT 1;`);
  return rows[0] || null;
}

function isAdmin(user) {
  return user?.role === ROLE_ADMIN;
}

function roleLabel(role) {
  return role === ROLE_ADMIN ? 'Admin' : 'Teacher';
}

function getSchoolYears() {
  return querySql('SELECT * FROM os_school_years ORDER BY start_date DESC, id DESC;');
}

function getSelectedYear(req, url) {
  const years = getSchoolYears();
  const requested = asInt(url.searchParams.get('yearId')) || asInt(parseCookies(req).selectedYearId);
  const selected = years.find((year) => year.id === requested)
    || years.find((year) => year.is_active)
    || years[0]
    || null;
  return { years, selected };
}

function getSetting(key, fallback = '') {
  const row = querySql(`SELECT value FROM os_settings WHERE key=${sqlValue(key)} LIMIT 1;`)[0];
  return row?.value || fallback;
}

function setSetting(key, value) {
  runSql(`INSERT INTO os_settings (key, value, updated_at)
    VALUES (${sqlValue(key)}, ${sqlValue(value)}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;`);
}

function appSettings() {
  const rows = querySql('SELECT key, value, updated_at FROM os_settings;');
  const byKey = rows.reduce((settings, row) => {
    settings[row.key] = row;
    return settings;
  }, {});
  const schoolName = byKey.school_name?.value || DEFAULT_SCHOOL_NAME;
  const logoPath = byKey.logo_path?.value || '';
  const faviconPath = byKey.favicon_path?.value || '';
  const logoVersion = encodeURIComponent(byKey.logo_path?.updated_at || 'default');
  const faviconVersion = encodeURIComponent(byKey.favicon_path?.updated_at || logoVersion);
  return {
    schoolName,
    logoPath,
    faviconPath,
    logoUrl: `/assets/logo?v=${logoVersion}`,
    faviconUrl: `/assets/favicon?v=${faviconVersion}`,
    hasCustomLogo: Boolean(logoPath),
    hasCustomFavicon: Boolean(faviconPath)
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function uploadExtension(file) {
  const type = String(file?.contentType || '').toLowerCase();
  const nameExt = path.extname(String(file?.filename || '')).toLowerCase();
  const allowedExts = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico']);
  if (allowedExts.has(nameExt)) return nameExt;
  if (type.includes('svg')) return '.svg';
  if (type.includes('png')) return '.png';
  if (type.includes('jpeg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  if (type.includes('icon') || type.includes('ico')) return '.ico';
  return '';
}

function saveUploadedImage(file, basename) {
  if (!file?.data?.length) return '';
  const ext = uploadExtension(file);
  if (!ext) return '';
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${basename}${ext}`;
  const target = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(target, file.data);
  return path.join('uploads', fileName);
}

function sortGrades(grades) {
  const rank = (grade) => {
    const text = String(grade);
    if (/^pre-?k$/i.test(text)) return -2;
    if (/^k(indergarten)?$/i.test(text)) return -1;
    const number = Number(text);
    return Number.isFinite(number) ? number : 100 + text.toLowerCase().charCodeAt(0);
  };
  return [...new Set(grades.filter(Boolean))].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

function promoteGrade(grade) {
  const text = String(grade || '').trim();
  if (/^pre-?k$/i.test(text)) return 'K';
  if (/^k(indergarten)?$/i.test(text)) return '1';
  const number = Number(text);
  if (Number.isFinite(number)) return number >= 12 ? 'Graduated' : String(number + 1);
  return text;
}

function average(values) {
  const numeric = values.map(Number).filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function formatPercent(value) {
  return value === null || value === undefined ? '&mdash;' : `${Number(value).toFixed(1)}%`;
}

function gradeTone(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 'quiet';
  if (score >= 90) return 'good';
  if (score >= 75) return 'watch';
  return 'low';
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function scoreBand(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 'No score';
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  return 'Below 70';
}

function gradeOptions(selected = '') {
  const common = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Graduated'];
  return common.map((grade) => `<option value="${esc(grade)}" ${grade === selected ? 'selected' : ''}>${esc(grade)}</option>`).join('');
}

function categoryOptions(selected = 'Lesson') {
  return CATEGORIES.map((category) => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('');
}

function teacherAllowedForSelection(user, yearId, grade, classroomId = 0) {
  if (!user || user.role !== ROLE_TEACHER) return true;
  if (!user.teacher_id) return false;
  const roomClause = classroomId ? `AND c.id=${asInt(classroomId)}` : '';
  const rows = querySql(`SELECT c.id
    FROM os_classrooms c
    JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${asInt(yearId)}
      AND c.teacher_id=${asInt(user.teacher_id)}
      AND cg.grade_level=${sqlValue(grade)}
      ${roomClause}
    LIMIT 1;`);
  return Boolean(rows.length);
}

const NAV_ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-11h6V4h-6v5Z"></path></svg>',
  families: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0H3Zm8.5 0a6.5 6.5 0 0 0-1.3-3.9A5 5 0 0 1 21 20h-9.5Z"></path></svg>',
  setup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v3H4V5Zm0 6h10v3H4v-3Zm0 6h16v3H4v-3Zm13.5-6 2.5 1.5-2.5 1.5V11Z"></path></svg>',
  gradebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5V3Zm2 2v14h10V7h-3V5H7Zm2 5h6v2H9v-2Zm0 4h6v2H9v-2Z"></path></svg>',
  reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14v2H5v-2Zm1-8h3v6H6v-6Zm5-6h3v12h-3V5Zm5 3h3v9h-3V8Z"></path></svg>'
};

function navLink(pathname, currentPath, label, iconKey) {
  const active = currentPath === pathname || (pathname !== '/' && currentPath.startsWith(pathname));
  return `<a class="nav-link ${active ? 'active' : ''}" href="${pathname}">${NAV_ICONS[iconKey] || ''}<span>${esc(label)}</span></a>`;
}

function actionPanel(title, body, meta = '') {
  return `<section class="panel">
    <div class="panel-title"><h2>${esc(title)}</h2>${meta ? `<p>${meta}</p>` : ''}</div>
    ${body}
  </section>`;
}

function emptyState(text) {
  return `<p class="empty">${esc(text)}</p>`;
}

function pageTemplate({ title, currentPath, content, csrfToken, user, years = [], selectedYear = null }) {
  const settings = appSettings();
  const yearSwitcher = user && selectedYear ? `<form class="year-form" method="post" action="/switch-year">
      ${csrfInput(csrfToken)}
      <select name="yearId" aria-label="School year">
        ${years.map((year) => `<option value="${year.id}" ${year.id === selectedYear.id ? 'selected' : ''}>${esc(year.name)}</option>`).join('')}
      </select>
      <button class="sr-only" type="submit">Switch school year</button>
    </form>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} &middot; ${esc(settings.schoolName)}</title>
<link rel="icon" href="${settings.faviconUrl}" />
<style>
:root {
  color-scheme: light;
  --bg: #f7f8fb;
  --paper: #ffffff;
  --paper-strong: #ffffff;
  --ink: #101828;
  --muted: #667085;
  --line: #e4e7ec;
  --line-strong: #cfd4dc;
  --accent: #2563eb;
  --accent-dark: #1d4ed8;
  --accent-soft: #eff6ff;
  --gold: #b54708;
  --red: #b42318;
  --blue: #2563eb;
  --shadow: 0 18px 48px rgba(16, 24, 40, .07);
  --radius: 4px;
}
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f172a;
  --paper: #111827;
  --paper-strong: #172033;
  --ink: #f8fafc;
  --muted: #a8b3c7;
  --line: #253047;
  --line-strong: #35415c;
  --accent: #60a5fa;
  --accent-dark: #93c5fd;
  --accent-soft: #172b4f;
  --gold: #f6b95f;
  --red: #fb7185;
  --blue: #93c5fd;
  --shadow: 0 18px 60px rgba(0, 0, 0, .34);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100svh;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}
a { color: inherit; }
button, input, select, textarea { font: inherit; }
button, select, input { min-height: 42px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.app {
  width: min(1440px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 76px;
  padding: .75rem max(1rem, env(safe-area-inset-left)) .75rem max(1rem, env(safe-area-inset-right));
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  backdrop-filter: blur(16px);
}
.brand-row, .top-actions, .year-form, .user-chip { display: flex; align-items: center; gap: .6rem; }
.brand-row { justify-content: space-between; min-width: 0; }
.brand { display: flex; align-items: center; gap: .65rem; min-width: 0; text-decoration: none; }
.brand img { width: 50px; height: 38px; object-fit: contain; }
.brand-text strong { display: block; font-size: 1.05rem; letter-spacing: 0; }
.brand-text span { display: block; color: var(--muted); font-size: .78rem; margin-top: .05rem; }
.top-actions { justify-content: flex-end; flex-wrap: nowrap; margin-left: auto; }
.year-form { flex: 0 0 auto; }
.year-form select { width: 190px; border-color: var(--line); background: var(--paper); }
.year-form button, .icon-btn, .logout-btn {
  border: 1px solid var(--line);
  background: var(--paper-strong);
  color: var(--ink);
  border-radius: var(--radius);
  padding: .48rem .68rem;
  cursor: pointer;
}
.logout-form { margin: 0; }
.user-chip { color: var(--muted); font-size: .84rem; white-space: nowrap; }
.sidebar {
  position: sticky;
  top: 117px;
  z-index: 10;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: .45rem;
  overflow-x: auto;
  padding: .55rem .85rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  scrollbar-width: none;
}
.sidebar::-webkit-scrollbar { display: none; }
.nav-link {
  display: flex;
  align-items: center;
  gap: .65rem;
  text-decoration: none;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: 0;
  padding: .68rem .75rem;
  font-weight: 700;
  font-size: .88rem;
  white-space: nowrap;
  transition: color .18s ease, border-color .18s ease, background .18s ease;
}
.nav-link svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: currentColor;
  opacity: .88;
}
.nav-link.active { color: var(--accent-dark); background: var(--accent-soft); border-left-color: var(--accent); }
.nav-link:hover { color: var(--accent-dark); background: var(--accent-soft); }
.nav-link.active:hover { color: var(--accent-dark); }
.sidebar-utility {
  display: block;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.theme-icon-btn {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.theme-icon-btn:hover { color: var(--accent-dark); background: var(--accent-soft); }
.theme-icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
.main {
  padding: 1rem .85rem 3.5rem;
}
.workspace {
  display: grid;
  gap: 1rem;
}
.page-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  padding: .35rem 0 .1rem;
}
.page-head-copy { display: grid; gap: .35rem; min-width: 0; }
.page-head h1 {
  margin: 0;
  font-size: clamp(1.45rem, 4.5vw, 2.35rem);
  line-height: 1.05;
  letter-spacing: 0;
}
.page-head p { margin: 0; color: var(--muted); max-width: 760px; line-height: 1.45; }
.ledger {
  background: var(--paper);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  border-radius: 12px;
  overflow: hidden;
}
.ledger-head {
  display: grid;
  gap: .3rem;
  padding: .95rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
}
.ledger-head h2, .panel-title h2 { margin: 0; font-size: 1rem; letter-spacing: 0; }
.ledger-head p, .panel-title p { margin: 0; color: var(--muted); font-size: .86rem; line-height: 1.4; }
.panel {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .9rem;
  box-shadow: var(--shadow);
}
.panel-title { display: grid; gap: .25rem; margin-bottom: .85rem; }
.grid-2, .grid-3, .grid-4 { display: grid; gap: .7rem; grid-template-columns: 1fr; }
.form-grid { display: grid; gap: .7rem; grid-template-columns: 1fr; }
label { display: grid; gap: .32rem; color: var(--muted); font-size: .84rem; font-weight: 700; }
input, select, textarea {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  padding: .62rem .68rem;
}
textarea { min-height: 82px; resize: vertical; }
input:focus, select:focus, textarea:focus {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: var(--accent);
}
.primary-btn, .main button[type="submit"], .login button[type="submit"] {
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  padding: .62rem .85rem;
  cursor: pointer;
}
.secondary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  font-weight: 800;
  padding: .62rem .85rem;
}
.text-action {
  color: var(--accent-dark);
  font-weight: 800;
  text-decoration: none;
}
.text-action:hover { text-decoration: underline; }
.compact-action {
  min-height: 34px;
  padding: .38rem .58rem;
  font-size: .82rem;
}
.inline-actions { display: flex; align-items: center; flex-wrap: wrap; gap: .55rem; }
.kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
}
.kpi {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .85rem;
}
.kpi span { display: block; color: var(--muted); font-size: .78rem; font-weight: 800; }
.kpi strong { display: block; margin-top: .18rem; font-size: 1.55rem; line-height: 1; }
.table-wrap { width: 100%; overflow-x: visible; }
table { width: 100%; min-width: 0; border-collapse: collapse; table-layout: fixed; }
th, td { padding: .68rem .75rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: .9rem; }
th { color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .04em; background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg)); }
td { overflow-wrap: anywhere; }
tr:last-child td { border-bottom: 0; }
.compact-table table { min-width: 0; }
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 25px;
  padding: .18rem .5rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--muted);
  background: var(--paper-strong);
  font-size: .78rem;
  font-weight: 800;
  margin: .05rem .18rem .05rem 0;
}
.badge.good { color: var(--accent-dark); border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.badge.watch { color: var(--gold); border-color: color-mix(in srgb, var(--gold) 50%, var(--line)); }
.badge.low { color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
.split {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.filters {
  display: grid;
  gap: .7rem;
  grid-template-columns: 1fr;
}
.score-sheet {
  display: grid;
  gap: .45rem;
}
.score-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 96px;
  gap: .55rem;
  align-items: center;
  padding: .55rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.score-row b { font-size: .92rem; }
.score-row small { display: block; color: var(--muted); margin-top: .12rem; }
.score-row input { text-align: center; font-weight: 800; }
.quick-scores {
  position: sticky;
  bottom: 0;
  z-index: 9;
  display: flex;
  gap: .38rem;
  overflow-x: auto;
  padding: .55rem 0 .2rem;
  background: linear-gradient(180deg, transparent, var(--paper) 24%);
  scrollbar-width: none;
}
.quick-scores::-webkit-scrollbar { display: none; }
.quick-scores button {
  flex: 0 0 auto;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  font-weight: 900;
  min-width: 54px;
  cursor: pointer;
}
.empty {
  margin: 0;
  color: var(--muted);
  padding: .8rem;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--paper-strong) 65%, transparent);
}
.page-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  padding: .6rem .85rem;
  text-decoration: none;
  white-space: nowrap;
}
.family-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.family-module-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.module-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: .5rem;
}
.setup-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.setup-nav {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.setup-nav-head {
  padding: .9rem;
  border-bottom: 1px solid var(--line);
}
.setup-nav-head h2 { margin: 0; font-size: 1rem; }
.setup-link {
  display: grid;
  gap: .2rem;
  padding: .82rem .9rem;
  text-decoration: none;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--line);
}
.setup-link:last-child { border-bottom: 0; }
.setup-link strong { font-size: .92rem; }
.setup-link span { color: var(--muted); font-size: .8rem; line-height: 1.35; }
.setup-link.active { background: var(--accent-soft); border-left-color: var(--accent); color: var(--accent-dark); }
.setup-link:hover { background: var(--accent-soft); color: var(--accent-dark); }
.family-list {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.family-list-head, .family-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .9rem;
  border-bottom: 1px solid var(--line);
}
.family-list-head h2, .family-detail-head h2 { margin: 0; font-size: 1rem; }
.family-count { color: var(--muted); font-size: .8rem; font-weight: 800; }
.family-link {
  display: grid;
  gap: .22rem;
  padding: .8rem .9rem;
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  transition: background .16s ease, color .16s ease;
}
.family-link:last-child { border-bottom: 0; }
.family-link strong { font-size: .95rem; }
.family-link span { color: var(--muted); font-size: .82rem; }
.family-link small { color: var(--muted); font-size: .78rem; line-height: 1.35; }
.family-link.active { background: var(--accent-soft); color: var(--accent-dark); }
.family-link:hover { background: color-mix(in srgb, var(--accent-soft) 60%, var(--paper)); }
.family-detail {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.family-detail-body {
  display: grid;
  gap: 1rem;
  padding: .95rem;
}
.detail-grid {
  display: grid;
  gap: .7rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.detail-item {
  display: grid;
  gap: .15rem;
  padding-bottom: .65rem;
  border-bottom: 1px solid var(--line);
}
.detail-item span { color: var(--muted); font-size: .76rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.detail-item strong { font-size: .95rem; font-weight: 700; }
.asset-preview-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .75rem;
}
.asset-preview {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: .8rem;
  padding: .75rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.asset-preview img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.asset-preview strong { display: block; font-size: .9rem; }
.asset-preview span { color: var(--muted); font-size: .8rem; }
.child-list {
  display: grid;
  gap: .55rem;
}
.child-row {
  display: grid;
  gap: .25rem;
  padding: .75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.child-row b { font-size: .95rem; }
.child-row span { color: var(--muted); font-size: .84rem; }
.subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  margin-top: .2rem;
}
.subhead h3 { margin: 0; font-size: .95rem; }
.login {
  min-height: 100svh;
  display: grid;
  align-items: center;
  padding: 1rem;
}
.login-panel {
  width: min(440px, 100%);
  margin: 0 auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
  padding: 1rem;
}
.login-logo { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
.login-logo img { width: 56px; height: 56px; object-fit: contain; }
.login-logo h1 { margin: 0; font-size: 1.55rem; }
.login-logo p { margin: .1rem 0 0; color: var(--muted); }
.notice { color: var(--muted); font-size: .86rem; line-height: 1.4; }
.danger { color: var(--red); font-weight: 800; }
.report-summary {
  display: grid;
  grid-template-columns: 1fr;
  gap: .75rem;
}
.chart-panel {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: .95rem;
  box-shadow: var(--shadow);
}
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .75rem;
  margin-bottom: .8rem;
}
.chart-head h2 { margin: 0; font-size: 1rem; }
.chart-head span { color: var(--muted); font-size: .8rem; font-weight: 800; }
.bar-list { display: grid; gap: .7rem; }
.bar-row {
  display: grid;
  grid-template-columns: minmax(92px, .45fr) minmax(0, 1fr) 58px;
  align-items: center;
  gap: .65rem;
}
.bar-row b { font-size: .84rem; overflow-wrap: anywhere; }
.bar-track {
  height: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.bar-fill {
  height: 100%;
  width: var(--bar-value);
  background: var(--accent);
}
.bar-fill.good { background: var(--accent); }
.bar-fill.watch { background: var(--gold); }
.bar-fill.low { background: var(--red); }
.bar-row span { color: var(--muted); font-size: .78rem; font-weight: 800; text-align: right; }
.distribution {
  display: grid;
  gap: .65rem;
}
.distribution-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 38px;
  gap: .65rem;
  align-items: center;
}
.distribution-row b { font-size: .84rem; }
.distribution-row span { color: var(--muted); font-size: .78rem; font-weight: 800; text-align: right; }
@media (min-width: 720px) {
  .topbar { top: 0; }
  .top-actions { justify-content: end; }
  .sidebar { top: 70px; padding-inline: 1rem; }
  .main { padding: 1.2rem 1rem 4rem; }
  .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .filters { grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: end; }
  .score-row { grid-template-columns: minmax(220px, 1fr) 120px; }
  .asset-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1040px) {
  .app { grid-template-columns: 168px 1fr; max-width: none; }
  .topbar { grid-column: 1 / -1; }
  .sidebar {
    position: sticky;
    top: 70px;
    height: calc(100svh - 70px);
    align-self: start;
    grid-auto-flow: row;
    grid-auto-columns: auto;
    align-content: start;
    border-right: 1px solid var(--line);
    border-bottom: 0;
    padding: .8rem .65rem;
  }
  .nav-link { border-radius: var(--radius); }
  .main { padding: 1.35rem 1.35rem 4rem; }
  .split { grid-template-columns: minmax(0, 1.2fr) minmax(330px, .8fr); align-items: start; }
  .kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .family-layout { grid-template-columns: 320px minmax(0, 1fr); align-items: start; }
  .family-module-grid { grid-template-columns: 300px minmax(0, 1fr); align-items: start; }
  .setup-layout { grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
  .sidebar-utility { margin-top: auto; padding-top: .75rem; border-top: 1px solid var(--line); }
}
@media (max-width: 820px) {
  .topbar { align-items: stretch; flex-direction: column; }
  .top-actions { justify-content: stretch; flex-wrap: wrap; margin-left: 0; }
  .year-form { flex: 1 1 100%; }
  .year-form select { width: 100%; max-width: none; }
  .user-chip { white-space: normal; }
  .page-head { align-items: stretch; flex-direction: column; }
  .detail-grid { grid-template-columns: 1fr; }
}
@media print {
  body { background: #fff; color: #111; }
  .topbar, .sidebar, .filters, .inline-actions, .quick-scores { display: none !important; }
  .app { display: block; width: 100%; }
  .main { padding: 0; }
  .panel, .ledger, .kpi { box-shadow: none; break-inside: avoid; }
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand-row">
      <a class="brand" href="/">
        <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
        <span class="brand-text"><strong>${esc(settings.schoolName)}</strong><span>Rooted Records for Growing Minds</span></span>
      </a>
    </div>
    <div class="top-actions">
      ${yearSwitcher}
      ${user ? `<span class="user-chip">${esc(user.name)} &middot; ${roleLabel(user.role)}</span>
        <form class="logout-form" method="post" action="/logout">${csrfInput(csrfToken)}<button class="logout-btn" type="submit">Log out</button></form>` : ''}
    </div>
  </header>
  ${user ? `<nav class="sidebar" aria-label="Primary">
    ${navLink('/', currentPath, 'Dashboard', 'dashboard')}
    ${navLink('/gradebook', currentPath, 'Gradebook', 'gradebook')}
    ${navLink('/reports', currentPath, 'Reports', 'reports')}
    ${navLink('/setup', currentPath, 'School Setup', 'setup')}
    <div class="sidebar-utility">
      <button id="themeToggle" class="theme-icon-btn" type="button" title="Toggle theme" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"></path></svg>
      </button>
    </div>
  </nav>` : ''}
  <main class="main">${content}</main>
</div>
<script>
(function(){
  const root = document.documentElement;
  const saved = localStorage.getItem('oakstead-theme');
  if (saved === 'dark') root.setAttribute('data-theme', 'dark');
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function(){
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
      localStorage.setItem('oakstead-theme', next);
    });
  }
  document.querySelectorAll('.year-form select').forEach(function(select) {
    select.addEventListener('change', function() {
      select.form.submit();
    });
  });

  let activeScoreInput = null;
  document.addEventListener('focusin', function(event) {
    if (event.target.matches('[data-score-input]')) activeScoreInput = event.target;
  });
  document.querySelectorAll('[data-score-chip]').forEach(function(button) {
    button.addEventListener('click', function() {
      const target = activeScoreInput || document.querySelector('[data-score-input]');
      if (!target) return;
      target.value = button.dataset.scoreChip;
      const next = target.closest('.score-row')?.nextElementSibling?.querySelector('[data-score-input]');
      if (next) {
        next.focus();
        next.select();
      }
    });
  });
})();
</script>
</body>
</html>`;
}

function loginPage(csrfToken, hasError) {
  const settings = appSettings();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in &middot; ${esc(settings.schoolName)}</title>
<link rel="icon" href="${settings.faviconUrl}" />
<style>${pageTemplate({ title: 'x', currentPath: '', content: '', csrfToken, user: null }).match(/<style>([\s\S]*?)<\/style>/)[1]}</style>
</head>
<body>
<main class="login">
  <section class="login-panel">
    <div class="login-logo">
      <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
      <div><h1>${esc(settings.schoolName)}</h1><p>Rooted Records for Growing Minds</p></div>
    </div>
    <form method="post" action="/login" class="form-grid">
      ${csrfInput(csrfToken)}
      <label>Username<input name="username" autocomplete="username" required maxlength="80" /></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="120" /></label>
      <button type="submit">Sign in</button>
    </form>
    ${hasError ? '<p class="notice danger">That username or password did not match.</p>' : '<p class="notice">Default administrator: admin / ChangeMeNow!</p>'}
  </section>
</main>
</body>
</html>`;
}

function schoolYearHead(title, description, selectedYear, action = '') {
  return `<header class="page-head">
    <div class="page-head-copy">
      <h1>${esc(title)}</h1>
      <p>${esc(description)} ${selectedYear ? `Current view: ${selectedYear.name}.` : ''}</p>
    </div>
    ${action}
  </header>`;
}

function logoAsset() {
  const custom = getSetting('logo_path', '');
  if (custom) {
    const customPath = path.join(PUBLIC_DIR, custom);
    if (fs.existsSync(customPath)) return customPath;
  }
  return fs.existsSync(DEFAULT_LOGO_FILE) ? DEFAULT_LOGO_FILE : path.join(__dirname, 'assets', 'oakstead-logo.svg');
}

function faviconAsset() {
  const custom = getSetting('favicon_path', '');
  if (custom) {
    const customPath = path.join(PUBLIC_DIR, custom);
    if (fs.existsSync(customPath)) return customPath;
  }
  return logoAsset();
}

function dashboardPage(selectedYear) {
  const yearId = asInt(selectedYear.id);
  const kpis = {
    families: querySql('SELECT COUNT(*) AS c FROM os_families;')[0]?.c || 0,
    students: querySql(`SELECT COUNT(*) AS c FROM os_student_years WHERE school_year_id=${yearId} AND status='enrolled';`)[0]?.c || 0,
    teachers: querySql('SELECT COUNT(*) AS c FROM os_teachers;')[0]?.c || 0,
    classrooms: querySql(`SELECT COUNT(*) AS c FROM os_classrooms WHERE school_year_id=${yearId};`)[0]?.c || 0,
    assignments: querySql(`SELECT COUNT(*) AS c FROM os_assignments WHERE school_year_id=${yearId};`)[0]?.c || 0
  };
  const recent = querySql(`SELECT a.title, a.category, a.grade_level, s.name AS subject_name,
      COUNT(sc.id) AS scores, ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / a.max_score) * 100 END), 1) AS avg_score
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC
    LIMIT 8;`);
  const roster = querySql(`SELECT sy.grade_level, COUNT(*) AS count
    FROM os_student_years sy
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
    GROUP BY sy.grade_level;`);
  const gradeBadges = sortGrades(roster.map((row) => row.grade_level))
    .map((grade) => {
      const row = roster.find((entry) => entry.grade_level === grade);
      return `<span class="badge">Grade ${esc(grade)} &middot; ${row?.count || 0}</span>`;
    }).join('') || '<span class="badge">No students enrolled</span>';

  return `<div class="workspace">
    ${schoolYearHead('Dashboard', 'A compact working view for enrollment, classrooms, and grades.', selectedYear)}
    <section class="kpis">
      <article class="kpi"><span>Families</span><strong>${kpis.families}</strong></article>
      <article class="kpi"><span>Students</span><strong>${kpis.students}</strong></article>
      <article class="kpi"><span>Teachers</span><strong>${kpis.teachers}</strong></article>
      <article class="kpi"><span>Classrooms</span><strong>${kpis.classrooms}</strong></article>
      <article class="kpi"><span>Assignments</span><strong>${kpis.assignments}</strong></article>
    </section>
    <div class="split">
      ${actionPanel('Roster by Grade', gradeBadges)}
      <section class="ledger">
        <div class="ledger-head"><h2>Recent Gradebook Entries</h2><p>Newest lessons, quizzes, and tests in this school year.</p></div>
        <div class="table-wrap compact-table"><table>
          <tr><th>Assignment</th><th>Type</th><th>Grade</th><th>Subject</th><th>Class Avg</th></tr>
          ${recent.map((row) => `<tr><td>${esc(row.title)}</td><td>${esc(row.category)}</td><td>${esc(row.grade_level)}</td><td>${esc(row.subject_name)}</td><td><span class="badge ${gradeTone(row.avg_score)}">${formatPercent(row.avg_score)}</span></td></tr>`).join('') || `<tr><td colspan="5">${emptyState('No grades have been entered for this year yet.')}</td></tr>`}
        </table></div>
      </section>
    </div>
  </div>`;
}

function familiesPage(selectedYear, csrfToken, url) {
  const yearId = asInt(selectedYear.id);
  const families = querySql(`SELECT f.*,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`);
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`);
  const classrooms = querySql(`SELECT id, name FROM os_classrooms WHERE school_year_id=${yearId} ORDER BY name;`);
  const classroomOptions = classrooms.map((room) => `<option value="${room.id}">${esc(room.name)}</option>`).join('');
  const showAddFamily = url.searchParams.get('action') === 'add-family' || families.length === 0;
  const requestedFamilyId = asInt(url.searchParams.get('familyId'));
  const selectedFamily = !showAddFamily
    ? (families.find((family) => family.id === requestedFamilyId) || families[0] || null)
    : null;
  const selectedChildren = selectedFamily ? students.filter((student) => student.family_id === selectedFamily.id) : [];
  const addFamilyAction = `<a class="page-action" href="/families?action=add-family">Add Family</a>`;

  const familyList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Families</h2>
      <div class="module-actions"><span class="family-count">${families.length}</span><a class="page-action compact-action" href="/setup?section=families&action=add-family">Add Family</a></div>
    </div>
    ${families.map((family) => {
      const active = selectedFamily?.id === family.id ? 'active' : '';
      const childText = `${family.child_count || 0} ${Number(family.child_count) === 1 ? 'child' : 'children'}`;
      const contact = [family.phone, family.email].filter(Boolean).join(' - ');
      return `<a class="family-link ${active}" href="/families?familyId=${family.id}">
        <strong>${esc(family.family_name)}</strong>
        <span>${esc(childText)}${contact ? ` / ${esc(contact)}` : ''}</span>
      </a>`;
    }).join('') || `<div style="padding:.9rem">${emptyState('No families have been entered yet.')}</div>`}
  </section>`;

  const addFamilyPanel = `<section class="family-detail">
    <div class="family-detail-head"><h2>Add Family</h2><a class="secondary-btn" href="/families">Cancel</a></div>
    <div class="family-detail-body">
      <form method="post" action="/families" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Family Name<input name="familyName" required maxlength="120" /></label>
        <label>Phone<input name="phone" inputmode="tel" maxlength="40" /></label>
        <label>Father<input name="fatherName" maxlength="120" /></label>
        <label>Mother<input name="motherName" maxlength="120" /></label>
        <label>Email<input name="email" type="email" maxlength="160" /></label>
        <label>Address<input name="address" maxlength="220" /></label>
        <button type="submit">Save Family</button>
      </form>
    </div>
  </section>`;

  const detailPanel = selectedFamily ? `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${esc(selectedFamily.family_name)}</h2>
      <span class="family-count">${selectedChildren.length} ${selectedChildren.length === 1 ? 'child' : 'children'}</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Parents</span><strong>${esc([selectedFamily.father_name, selectedFamily.mother_name].filter(Boolean).join(' / ')) || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Phone</span><strong>${esc(selectedFamily.phone || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
      </div>
      <div class="subhead"><h3>Children</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
      <div class="child-list">
        ${selectedChildren.map((student) => `<div class="child-row">
          <b>${esc(student.first_name)} ${esc(student.last_name)}</b>
          <span>${student.birth_date ? `Birthday ${esc(student.birth_date)} / ` : ''}Grade ${esc(student.grade_level || 'not enrolled')}${student.classroom_name ? ` / ${esc(student.classroom_name)}` : ''}</span>
        </div>`).join('') || emptyState('No children are listed for this family yet.')}
      </div>
      <div class="subhead"><h3>Add Child</h3></div>
      <form method="post" action="/students" class="form-grid two">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <input type="hidden" name="familyId" value="${selectedFamily.id}" />
        <label>First Name<input name="firstName" required maxlength="80" /></label>
        <label>Last Name<input name="lastName" required maxlength="80" /></label>
        <label>Birthday<input type="date" name="birthDate" /></label>
        <label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>
        <label>Classroom<select name="classroomId"><option value="">Not assigned yet</option>${classroomOptions}</select></label>
        <button type="submit">Save Child</button>
      </form>
    </div>
  </section>` : addFamilyPanel;

  return `<div class="workspace">
    ${schoolYearHead('Families', 'Select a household to manage its children and yearly placement.', selectedYear, addFamilyAction)}
    <div class="family-layout">
      ${familyList}
      ${showAddFamily ? addFamilyPanel : detailPanel}
    </div>
  </div>`;
}

function selectedAttr(value, selected) {
  return String(value || '') === String(selected || '') ? 'selected' : '';
}

function setupPage(selectedYear, csrfToken, url) {
  const yearId = asInt(selectedYear.id);
  const validSections = ['families', 'teachers', 'classrooms', 'subjects', 'years', 'users', 'settings'];
  const section = validSections.includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'families';
  const action = cleanText(url.searchParams.get('action'), 40);
  const settings = appSettings();
  const teachers = querySql('SELECT * FROM os_teachers ORDER BY name;');
  const subjects = querySql('SELECT * FROM os_subjects ORDER BY name;');
  const schoolYears = querySql('SELECT * FROM os_school_years ORDER BY is_active DESC, name DESC;');
  const classrooms = querySql(`SELECT c.*, t.name AS teacher_name,
      GROUP_CONCAT(cg.grade_level, ', ') AS grades
    FROM os_classrooms c
    LEFT JOIN os_teachers t ON t.id = c.teacher_id
    LEFT JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${yearId}
    GROUP BY c.id
    ORDER BY c.name;`);
  const gradeSubjects = querySql(`SELECT gs.grade_level, s.name AS subject_name
    FROM os_grade_subjects gs
    JOIN os_subjects s ON s.id = gs.subject_id
    WHERE gs.school_year_id=${yearId}
    ORDER BY gs.grade_level, s.name;`);
  const families = querySql(`SELECT f.*,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`);
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`);
  const users = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, t.name AS teacher_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    ORDER BY u.name;`);
  const teacherOptions = (selected = '') => teachers.map((teacher) => `<option value="${teacher.id}" ${selectedAttr(teacher.id, selected)}>${esc(teacher.name)}</option>`).join('');
  const subjectOptions = (selected = '') => subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(subject.id, selected)}>${esc(subject.name)}</option>`).join('');
  const classroomOptions = (selected = '') => classrooms.map((room) => `<option value="${room.id}" ${selectedAttr(room.id, selected)}>${esc(room.name)}</option>`).join('');
  const setupLinks = [
    ['families', 'Families', `${families.length} households`],
    ['teachers', 'Teachers', `${teachers.length} records`],
    ['classrooms', 'Classrooms', `${classrooms.length} rooms in ${selectedYear.name}`],
    ['subjects', 'Subjects', `${subjects.length} subjects`],
    ['years', 'School Years', `${schoolYears.length} years`],
    ['users', 'Users', `${users.length} sign-ins`],
    ['settings', 'System Settings', settings.schoolName]
  ];
  const setupNav = `<aside class="setup-nav" aria-label="School setup modules">
    <div class="setup-nav-head"><h2>Setup</h2></div>
    ${setupLinks.map(([key, label, meta]) => `<a class="setup-link ${section === key ? 'active' : ''}" href="/setup?section=${key}">
      <strong>${esc(label)}</strong>
      <span>${esc(meta)}</span>
    </a>`).join('')}
  </aside>`;

  const requestedFamilyId = asInt(url.searchParams.get('familyId'));
  const selectedFamily = families.find((family) => family.id === requestedFamilyId) || families[0] || null;
  const showFamilyForm = action === 'add-family' || action === 'edit-family' || families.length === 0;
  const familyForForm = action === 'edit-family' ? selectedFamily : null;
  const selectedChildren = selectedFamily ? students.filter((student) => student.family_id === selectedFamily.id) : [];
  const familyList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Families</h2>
      <div class="module-actions"><span class="family-count">${families.length}</span><a class="page-action compact-action" href="/setup?section=families&action=add-family">Add Family</a></div>
    </div>
    ${families.map((family) => {
      const active = selectedFamily?.id === family.id && !showFamilyForm ? 'active' : '';
      const childText = `${family.child_count || 0} ${Number(family.child_count) === 1 ? 'child' : 'children'}`;
      return `<a class="family-link ${active}" href="/setup?section=families&familyId=${family.id}">
        <strong>${esc(family.family_name)}</strong>
        <small>Dad: ${esc(family.father_name || 'not listed')}</small>
        <small>Mom: ${esc(family.mother_name || 'not listed')}</small>
        <span>${esc(childText)}</span>
      </a>`;
    }).join('') || `<div style="padding:.9rem">${emptyState('No families have been entered yet.')}</div>`}
  </section>`;
  const familyForm = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${familyForForm ? 'Edit Family' : 'Add Family'}</h2>
      <a class="secondary-btn compact-action" href="/setup?section=families${selectedFamily ? `&familyId=${selectedFamily.id}` : ''}">Cancel</a>
    </div>
    <div class="family-detail-body">
      <form method="post" action="/families" class="form-grid two">
        ${csrfInput(csrfToken)}
        ${familyForForm ? `<input type="hidden" name="familyId" value="${familyForForm.id}" />` : ''}
        <label>Last Name<input name="familyName" required maxlength="120" value="${esc(familyForForm?.family_name || '')}" /></label>
        <label>Phone<input name="phone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.phone || '')}" /></label>
        <label>Father<input name="fatherName" maxlength="120" value="${esc(familyForForm?.father_name || '')}" /></label>
        <label>Mother<input name="motherName" maxlength="120" value="${esc(familyForForm?.mother_name || '')}" /></label>
        <label>Email<input name="email" type="email" maxlength="160" value="${esc(familyForForm?.email || '')}" /></label>
        <label>Address<input name="address" maxlength="220" value="${esc(familyForForm?.address || '')}" /></label>
        <button type="submit">${familyForForm ? 'Save Changes' : 'Save Family'}</button>
      </form>
    </div>
  </section>`;
  const childForm = selectedFamily ? `<form method="post" action="/students" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    <input type="hidden" name="familyId" value="${selectedFamily.id}" />
    <label>First Name<input name="firstName" required maxlength="80" /></label>
    <label>Last Name<input name="lastName" required maxlength="80" value="${esc(selectedFamily.family_name)}" /></label>
    <label>Birthday<input type="date" name="birthDate" /></label>
    <label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>
    <label>Classroom<select name="classroomId"><option value="">Not assigned yet</option>${classroomOptions()}</select></label>
    <button type="submit">Save Child</button>
  </form>` : '';
  const familyDetail = selectedFamily ? `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${esc(selectedFamily.family_name)}</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=edit-family">Edit</a>
        <a class="page-action compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-child">Add Child</a>
      </div>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Father</span><strong>${esc(selectedFamily.father_name || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Mother</span><strong>${esc(selectedFamily.mother_name || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Phone</span><strong>${esc(selectedFamily.phone || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
      </div>
      <div class="subhead"><h3>Children</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
      <div class="child-list">
        ${selectedChildren.map((student) => `<div class="child-row">
          <b>${esc(student.first_name)} ${esc(student.last_name)}</b>
          <span>${student.birth_date ? `Birthday ${esc(student.birth_date)} / ` : ''}Grade ${esc(student.grade_level || 'not enrolled')}${student.classroom_name ? ` / ${esc(student.classroom_name)}` : ''}</span>
        </div>`).join('') || emptyState('No children are listed for this family yet.')}
      </div>
      ${action === 'add-child' ? `<div class="subhead"><h3>Add Child</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${childForm}` : ''}
    </div>
  </section>` : familyForm;
  const familiesModule = `<div class="family-module-grid">
    ${familyList}
    ${showFamilyForm ? familyForm : familyDetail}
  </div>`;

  const teacherEdit = teachers.find((teacher) => teacher.id === asInt(url.searchParams.get('teacherId')));
  const teacherForm = `<form method="post" action="/teachers" class="form-grid three">
    ${csrfInput(csrfToken)}
    ${teacherEdit ? `<input type="hidden" name="teacherId" value="${teacherEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(teacherEdit?.name || '')}" /></label>
    <label>Email<input name="email" type="email" maxlength="160" value="${esc(teacherEdit?.email || '')}" /></label>
    <label>Phone<input name="phone" inputmode="tel" maxlength="40" value="${esc(teacherEdit?.phone || '')}" /></label>
    <button type="submit">${teacherEdit ? 'Save Changes' : 'Save Teacher'}</button>
  </form>`;
  const teachersModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Teachers</h2>
      <div class="module-actions"><span class="family-count">${teachers.length}</span><a class="page-action compact-action" href="/setup?section=teachers&action=add-teacher">Add Teacher</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-teacher' || teacherEdit) ? `<div class="subhead"><h3>${teacherEdit ? 'Edit Teacher' : 'Add Teacher'}</h3><a class="secondary-btn compact-action" href="/setup?section=teachers">Cancel</a></div>${teacherForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr>
        ${teachers.map((teacher) => `<tr><td>${esc(teacher.name)}</td><td>${esc(teacher.email || '') || '&mdash;'}</td><td>${esc(teacher.phone || '') || '&mdash;'}</td><td><a class="text-action" href="/setup?section=teachers&teacherId=${teacher.id}">Edit</a></td></tr>`).join('') || `<tr><td colspan="4">${emptyState('No teachers yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const classroomEdit = classrooms.find((room) => room.id === asInt(url.searchParams.get('classroomId')));
  const classroomForm = `<form method="post" action="/classrooms" class="form-grid three">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${classroomEdit ? `<input type="hidden" name="classroomId" value="${classroomEdit.id}" />` : ''}
    <label>Room Name<input name="name" required maxlength="120" value="${esc(classroomEdit?.name || '')}" /></label>
    <label>Teacher<select name="teacherId"><option value="">Unassigned</option>${teacherOptions(classroomEdit?.teacher_id || '')}</select></label>
    <label>Grades in Room<input name="grades" placeholder="3, 4" required maxlength="120" value="${esc(classroomEdit?.grades || '')}" /></label>
    <button type="submit">${classroomEdit ? 'Save Changes' : 'Save Classroom'}</button>
  </form>`;
  const classroomsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Classrooms</h2>
      <div class="module-actions"><span class="family-count">${esc(selectedYear.name)}</span><a class="page-action compact-action" href="/setup?section=classrooms&action=add-classroom">Add Classroom</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-classroom' || classroomEdit) ? `<div class="subhead"><h3>${classroomEdit ? 'Edit Classroom' : 'Add Classroom'}</h3><a class="secondary-btn compact-action" href="/setup?section=classrooms">Cancel</a></div>${classroomForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Classroom</th><th>Teacher</th><th>Grades</th><th></th></tr>
        ${classrooms.map((room) => `<tr><td>${esc(room.name)}</td><td>${esc(room.teacher_name || 'Unassigned')}</td><td>${String(room.grades || '').split(',').filter(Boolean).map((grade) => `<span class="badge">${esc(grade.trim())}</span>`).join('')}</td><td><a class="text-action" href="/setup?section=classrooms&classroomId=${room.id}">Edit</a></td></tr>`).join('') || `<tr><td colspan="4">${emptyState('No classrooms for this year yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const subjectEdit = subjects.find((subject) => subject.id === asInt(url.searchParams.get('subjectId')));
  const subjectForm = `<form method="post" action="/subjects" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${subjectEdit ? `<input type="hidden" name="subjectId" value="${subjectEdit.id}" />` : ''}
    <label>Subject Name<input name="name" required maxlength="120" value="${esc(subjectEdit?.name || '')}" /></label>
    <button type="submit">${subjectEdit ? 'Save Changes' : 'Save Subject'}</button>
  </form>`;
  const assignSubjectForm = `<form method="post" action="/grade-subjects" class="form-grid three">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    <label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>
    <label>Subject<select name="subjectId" required><option value="">Choose subject</option>${subjectOptions()}</select></label>
    <button type="submit">Assign Subject</button>
  </form>`;
  const subjectsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Subjects</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=subjects&action=assign-subject">Assign to Grade</a>
        <a class="page-action compact-action" href="/setup?section=subjects&action=add-subject">Add Subject</a>
      </div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-subject' || subjectEdit) ? `<div class="subhead"><h3>${subjectEdit ? 'Edit Subject' : 'Add Subject'}</h3><a class="secondary-btn compact-action" href="/setup?section=subjects">Cancel</a></div>${subjectForm}` : ''}
      ${action === 'assign-subject' ? `<div class="subhead"><h3>Assign Subject to Grade</h3><a class="secondary-btn compact-action" href="/setup?section=subjects">Cancel</a></div>${assignSubjectForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Subject</th><th></th></tr>
        ${subjects.map((subject) => `<tr><td>${esc(subject.name)}</td><td><a class="text-action" href="/setup?section=subjects&subjectId=${subject.id}">Edit</a></td></tr>`).join('') || `<tr><td colspan="2">${emptyState('No subjects yet.')}</td></tr>`}
      </table></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Grade</th><th>Subjects</th></tr>
        ${sortGrades(gradeSubjects.map((row) => row.grade_level)).map((grade) => `<tr><td>${esc(grade)}</td><td>${gradeSubjects.filter((row) => row.grade_level === grade).map((row) => `<span class="badge">${esc(row.subject_name)}</span>`).join('')}</td></tr>`).join('') || `<tr><td colspan="2">${emptyState('No subjects have been assigned to grades yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const yearEdit = schoolYears.find((schoolYear) => schoolYear.id === asInt(url.searchParams.get('yearId')));
  const yearForm = `<form method="post" action="/school-years" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${yearEdit ? `<input type="hidden" name="yearId" value="${yearEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="40" value="${esc(yearEdit?.name || '')}" /></label>
    <label>Start Date<input type="date" name="startDate" value="${esc(yearEdit?.start_date || '')}" /></label>
    <label>End Date<input type="date" name="endDate" value="${esc(yearEdit?.end_date || '')}" /></label>
    <label>Make Active<select name="makeActive"><option value="1" ${selectedAttr(yearEdit?.is_active ? '1' : '', '1')}>Yes</option><option value="0" ${selectedAttr(yearEdit && !yearEdit.is_active ? '0' : '', '0')}>No</option></select></label>
    <button type="submit">${yearEdit ? 'Save Changes' : 'Create Year'}</button>
  </form>`;
  const promoteForm = `<form method="post" action="/promote-year" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="fromYearId" value="${yearId}" />
    <label>Next Year Name<input name="name" placeholder="2026-2027" required maxlength="40" /></label>
    <label>Start Date<input type="date" name="startDate" /></label>
    <label>End Date<input type="date" name="endDate" /></label>
    <label>Make Active<select name="makeActive"><option value="1">Yes</option><option value="0">No</option></select></label>
    <button type="submit">Promote Students</button>
  </form>`;
  const yearsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>School Years</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=years&action=promote-year">Promote Year</a>
        <a class="page-action compact-action" href="/setup?section=years&action=add-year">Create Year</a>
      </div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-year' || yearEdit) ? `<div class="subhead"><h3>${yearEdit ? 'Edit School Year' : 'Create School Year'}</h3><a class="secondary-btn compact-action" href="/setup?section=years">Cancel</a></div>${yearForm}` : ''}
      ${action === 'promote-year' ? `<div class="subhead"><h3>Promote Current Year</h3><a class="secondary-btn compact-action" href="/setup?section=years">Cancel</a></div><p class="notice">Promotion creates new year-specific enrollment records and leaves prior grades untouched.</p>${promoteForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>School Year</th><th>Dates</th><th>Status</th><th></th></tr>
        ${schoolYears.map((schoolYear) => `<tr><td>${esc(schoolYear.name)}</td><td>${esc([schoolYear.start_date, schoolYear.end_date].filter(Boolean).join(' to ')) || '&mdash;'}</td><td>${schoolYear.is_active ? '<span class="badge good">Active</span>' : '<span class="badge">Inactive</span>'}</td><td><a class="text-action" href="/setup?section=years&yearId=${schoolYear.id}">Edit</a></td></tr>`).join('')}
      </table></div>
    </div>
  </section>`;

  const userEdit = users.find((setupUser) => setupUser.id === asInt(url.searchParams.get('userId')));
  const roleValue = userEdit?.role || ROLE_ADMIN;
  const userForm = `<form method="post" action="/users" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${userEdit ? `<input type="hidden" name="userId" value="${userEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(userEdit?.name || '')}" /></label>
    <label>Username<input name="username" required maxlength="80" value="${esc(userEdit?.username || '')}" /></label>
    <label>Role<select name="role"><option value="${ROLE_ADMIN}" ${selectedAttr(roleValue, ROLE_ADMIN)}>Admin</option><option value="${ROLE_TEACHER}" ${selectedAttr(roleValue, ROLE_TEACHER)}>Teacher</option></select></label>
    <label>Teacher Link<select name="teacherId"><option value="">None</option>${teacherOptions(userEdit?.teacher_id || '')}</select></label>
    <label>Password<input type="password" name="password" ${userEdit ? '' : 'required'} maxlength="120" autocomplete="new-password" /></label>
    <button type="submit">${userEdit ? 'Save Changes' : 'Create User'}</button>
  </form>`;
  const usersModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Users</h2>
      <div class="module-actions"><span class="family-count">${users.length}</span><a class="page-action compact-action" href="/setup?section=users&action=add-user">Add User</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-user' || userEdit) ? `<div class="subhead"><h3>${userEdit ? 'Edit User' : 'Add User'}</h3><a class="secondary-btn compact-action" href="/setup?section=users">Cancel</a></div>${userForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Name</th><th>Username</th><th>Role</th><th>Teacher</th><th></th></tr>
        ${users.map((setupUser) => `<tr><td>${esc(setupUser.name)}</td><td>${esc(setupUser.username)}</td><td>${roleLabel(setupUser.role)}</td><td>${esc(setupUser.teacher_name || '') || '&mdash;'}</td><td><a class="text-action" href="/setup?section=users&userId=${setupUser.id}">Edit</a></td></tr>`).join('') || `<tr><td colspan="5">${emptyState('No users yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const settingsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>System Settings</h2>
      <span class="family-count">${esc(settings.schoolName)}</span>
    </div>
    <div class="family-detail-body">
      <div class="asset-preview-grid">
        <div class="asset-preview">
          <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)} logo" />
          <div><strong>Software Logo</strong><span>${settings.hasCustomLogo ? 'Custom logo loaded' : 'Default logo'}</span></div>
        </div>
        <div class="asset-preview">
          <img src="${settings.faviconUrl}" alt="${esc(settings.schoolName)} favicon" />
          <div><strong>Favicon</strong><span>${settings.hasCustomFavicon ? 'Custom favicon loaded' : 'Using logo as favicon'}</span></div>
        </div>
      </div>
      <form method="post" action="/system-settings" enctype="multipart/form-data" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>School Name<input name="schoolName" required maxlength="120" value="${esc(settings.schoolName)}" /></label>
        <label>Logo<input type="file" name="logo" accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp" /></label>
        <label>Favicon<input type="file" name="favicon" accept=".ico,.svg,.png,.jpg,.jpeg,.webp,image/x-icon,image/svg+xml,image/png,image/jpeg,image/webp" /></label>
        <button type="submit">Save Settings</button>
      </form>
    </div>
  </section>`;

  const modules = {
    families: familiesModule,
    teachers: teachersModule,
    classrooms: classroomsModule,
    subjects: subjectsModule,
    years: yearsModule,
    users: usersModule,
    settings: settingsModule
  };

  return `<div class="workspace">
    ${schoolYearHead('School Setup', 'Manage the records that define the school year.', selectedYear)}
    <div class="setup-layout">
      ${setupNav}
      ${modules[section]}
    </div>
  </div>`;
}

function gradebookPage(req, url, user, selectedYear, csrfToken) {
  const yearId = asInt(selectedYear.id);
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
  const selectedClassroomId = asInt(url.searchParams.get('classroomId'));
  const allGrades = sortGrades([
    ...querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=${yearId};`).map((row) => row.grade_level),
    ...querySql(`SELECT grade_level FROM os_grade_subjects WHERE school_year_id=${yearId};`).map((row) => row.grade_level)
  ]);
  const teacherRoomFilter = user.role === ROLE_TEACHER ? `AND c.teacher_id=${asInt(user.teacher_id)}` : '';
  const classrooms = querySql(`SELECT c.id, c.name, GROUP_CONCAT(cg.grade_level, ', ') AS grades
    FROM os_classrooms c
    LEFT JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${yearId} ${teacherRoomFilter}
    GROUP BY c.id
    ORDER BY c.name;`);
  const subjects = selectedGrade
    ? querySql(`SELECT s.id, s.name
        FROM os_grade_subjects gs
        JOIN os_subjects s ON s.id = gs.subject_id
        WHERE gs.school_year_id=${yearId} AND gs.grade_level=${sqlValue(selectedGrade)}
        ORDER BY s.name;`)
    : querySql('SELECT id, name FROM os_subjects ORDER BY name;');
  const subject = subjects.find((row) => row.id === selectedSubjectId);
  const allowed = !selectedGrade || teacherAllowedForSelection(user, yearId, selectedGrade, selectedClassroomId);
  const classroomClause = selectedClassroomId ? `AND sy.classroom_id=${selectedClassroomId}` : '';
  const teacherStudentClause = user.role === ROLE_TEACHER ? `AND sy.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${asInt(user.teacher_id)} AND school_year_id=${yearId})` : '';
  const students = selectedGrade && allowed ? querySql(`SELECT st.id, st.first_name, st.last_name, st.birth_date, c.name AS classroom_name
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
      WHERE sy.school_year_id=${yearId}
        AND sy.grade_level=${sqlValue(selectedGrade)}
        AND sy.status='enrolled'
        ${classroomClause}
        ${teacherStudentClause}
      ORDER BY st.last_name, st.first_name;`) : [];
  const assignments = selectedGrade && selectedSubjectId ? querySql(`SELECT a.*, s.name AS subject_name,
      COUNT(sc.id) AS score_count,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / a.max_score) * 100 END), 1) AS avg_score
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(selectedGrade)}
      AND a.subject_id=${selectedSubjectId}
      ${selectedClassroomId ? `AND COALESCE(a.classroom_id, 0)=${selectedClassroomId}` : ''}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC
    LIMIT 18;`) : [];

  const gradeSelect = `<select name="grade" required><option value="">Grade</option>${allGrades.map((grade) => `<option value="${esc(grade)}" ${grade === selectedGrade ? 'selected' : ''}>${esc(grade)}</option>`).join('')}</select>`;
  const subjectSelect = `<select name="subjectId" required><option value="">Subject</option>${subjects.map((subj) => `<option value="${subj.id}" ${subj.id === selectedSubjectId ? 'selected' : ''}>${esc(subj.name)}</option>`).join('')}</select>`;
  const classroomSelect = `<select name="classroomId"><option value="">All classrooms</option>${classrooms.map((room) => `<option value="${room.id}" ${room.id === selectedClassroomId ? 'selected' : ''}>${esc(room.name)}${room.grades ? ` - ${esc(room.grades)}` : ''}</option>`).join('')}</select>`;

  return `<div class="workspace">
    ${schoolYearHead('Gradebook', 'Choose a year, grade, subject, and lesson; then enter the whole class at once.', selectedYear)}
    <section class="panel">
      <form method="get" action="/gradebook" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <label>Grade${gradeSelect}</label>
        <label>Subject${subjectSelect}</label>
        <label>Classroom${classroomSelect}</label>
        <button type="submit">Load Class</button>
      </form>
    </section>
    <div class="split">
      ${actionPanel('Enter Scores', !allowed ? emptyState('This grade is not assigned to your teacher account.')
        : (!selectedGrade || !selectedSubjectId ? emptyState('Select a grade and subject to begin.')
          : `<form method="post" action="/gradebook" class="form-grid">
            ${csrfInput(csrfToken)}
            <input type="hidden" name="schoolYearId" value="${yearId}" />
            <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
            <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
            <input type="hidden" name="classroomId" value="${selectedClassroomId || ''}" />
            <div class="form-grid three">
              <label>Lesson / Assignment<input name="title" placeholder="Lesson 24" required maxlength="140" /></label>
              <label>Type<select name="category">${categoryOptions()}</select></label>
              <label>Date<input type="date" name="assignmentDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
              <label>Max Score<input type="number" name="maxScore" value="100" min="1" max="1000" step="0.01" required /></label>
            </div>
            <div class="quick-scores" aria-label="Quick scores">
              ${[100, 95, 90, 85, 80, 75, 70, 65, 60, 0].map((score) => `<button type="button" data-score-chip="${score}">${score}</button>`).join('')}
            </div>
            <div class="score-sheet">
              ${students.map((student) => `<div class="score-row">
                <div><b>${esc(`${student.last_name}, ${student.first_name}`)}</b><small>${esc(student.classroom_name || 'No classroom')}</small></div>
                <input data-score-input name="score_${student.id}" type="number" inputmode="decimal" min="0" max="1000" step="0.01" autocomplete="off" />
              </div>`).join('') || emptyState('No enrolled students match this selection.')}
            </div>
            <button type="submit">Save Scores</button>
          </form>`), subject ? `Grade ${esc(selectedGrade)} &middot; ${esc(subject.name)}` : '')}
      <section class="ledger">
        <div class="ledger-head"><h2>Assignment History</h2><p>Recent entries for the loaded grade and subject.</p></div>
        <div class="table-wrap compact-table"><table>
          <tr><th>Date</th><th>Assignment</th><th>Type</th><th>Scores</th><th>Average</th></tr>
          ${assignments.map((assignment) => `<tr><td>${esc(assignment.assignment_date || '') || '&mdash;'}</td><td>${esc(assignment.title)}</td><td>${esc(assignment.category)}</td><td>${assignment.score_count}</td><td><span class="badge ${gradeTone(assignment.avg_score)}">${formatPercent(assignment.avg_score)}</span></td></tr>`).join('') || `<tr><td colspan="5">${emptyState('No assignment history for this selection yet.')}</td></tr>`}
        </table></div>
      </section>
    </div>
  </div>`;
}

function reportsPage(url, selectedYear) {
  const yearId = asInt(selectedYear.id);
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const gradeClause = selectedGrade ? `AND a.grade_level=${sqlValue(selectedGrade)}` : '';
  const grades = sortGrades(querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=${yearId};`).map((row) => row.grade_level));
  const classRows = querySql(`SELECT a.grade_level, s.name AS subject_name,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / a.max_score) * 100 END), 1) AS avg_score,
      COUNT(sc.id) AS score_count
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId} ${gradeClause}
    GROUP BY a.grade_level, a.subject_id
    ORDER BY a.grade_level, s.name;`);
  const studentRows = querySql(`SELECT st.id, st.last_name, st.first_name, sy.grade_level, s.name AS subject_name,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / a.max_score) * 100 END), 1) AS avg_score
    FROM os_scores sc
    JOIN os_assignments a ON a.id = sc.assignment_id
    JOIN os_subjects s ON s.id = a.subject_id
    JOIN os_students st ON st.id = sc.student_id
    JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id = a.school_year_id
    WHERE a.school_year_id=${yearId} ${gradeClause}
    GROUP BY st.id, a.subject_id
    ORDER BY sy.grade_level, st.last_name, st.first_name, s.name;`);
  const studentIds = [...new Set(studentRows.map((row) => row.id))];
  const scoredClassRows = classRows.filter((row) => Number.isFinite(Number(row.avg_score)));
  const schoolAverage = average(scoredClassRows.map((row) => Number(row.avg_score)));
  const totalScores = classRows.reduce((sum, row) => sum + Number(row.score_count || 0), 0);
  const topSubjects = [...scoredClassRows]
    .sort((a, b) => Number(b.avg_score) - Number(a.avg_score))
    .slice(0, 8);
  const bands = ['90-100', '80-89', '70-79', 'Below 70', 'No score'].map((label) => ({
    label,
    count: studentRows.filter((row) => scoreBand(row.avg_score) === label).length
  }));
  const largestBand = Math.max(1, ...bands.map((band) => band.count));
  const chartSummary = `<div class="report-summary">
    <section class="chart-panel">
      <div class="chart-head"><h2>Subject Averages</h2><span>${formatPercent(schoolAverage)} overall</span></div>
      <div class="bar-list">
        ${topSubjects.map((row) => `<div class="bar-row">
          <b>${esc(row.grade_level)} ${esc(row.subject_name)}</b>
          <div class="bar-track"><div class="bar-fill ${gradeTone(row.avg_score)}" style="--bar-value:${clampPercent(row.avg_score)}%"></div></div>
          <span>${formatPercent(row.avg_score)}</span>
        </div>`).join('') || emptyState('Enter scores to build subject charts.')}
      </div>
    </section>
    <section class="chart-panel">
      <div class="chart-head"><h2>Student Average Bands</h2><span>${totalScores} scores</span></div>
      <div class="distribution">
        ${bands.map((band) => `<div class="distribution-row">
          <b>${esc(band.label)}</b>
          <div class="bar-track"><div class="bar-fill" style="--bar-value:${Math.round((band.count / largestBand) * 100)}%"></div></div>
          <span>${band.count}</span>
        </div>`).join('')}
      </div>
    </section>
  </div>`;

  return `<div class="workspace">
    ${schoolYearHead('Reports', 'Review averages by subject, student, class, and school year.', selectedYear)}
    <section class="panel">
      <form method="get" action="/reports" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <label>Grade<select name="grade"><option value="">All grades</option>${grades.map((grade) => `<option value="${esc(grade)}" ${grade === selectedGrade ? 'selected' : ''}>${esc(grade)}</option>`).join('')}</select></label>
        <button type="submit">Load Report</button>
        <button class="secondary-btn" type="button" onclick="window.print()">Print</button>
      </form>
    </section>
    ${chartSummary}
    <div class="split">
      <section class="ledger">
        <div class="ledger-head"><h2>Class Averages</h2><p>Subject averages across the selected grade scope.</p></div>
        <div class="table-wrap compact-table"><table>
          <tr><th>Grade</th><th>Subject</th><th>Scores</th><th>Average</th></tr>
          ${classRows.map((row) => `<tr><td>${esc(row.grade_level)}</td><td>${esc(row.subject_name)}</td><td>${row.score_count}</td><td><span class="badge ${gradeTone(row.avg_score)}">${formatPercent(row.avg_score)}</span></td></tr>`).join('') || `<tr><td colspan="4">${emptyState('No class averages available yet.')}</td></tr>`}
        </table></div>
      </section>
      <section class="ledger">
        <div class="ledger-head"><h2>Student Subject Averages</h2><p>Each student's current average per subject.</p></div>
        <div class="table-wrap"><table>
          <tr><th>Student</th><th>Grade</th><th>Subjects</th></tr>
          ${studentIds.map((id) => {
            const rows = studentRows.filter((row) => row.id === id);
            const first = rows[0];
            return `<tr><td>${esc(`${first.last_name}, ${first.first_name}`)}</td><td>${esc(first.grade_level)}</td><td>${rows.map((row) => `<span class="badge ${gradeTone(row.avg_score)}">${esc(row.subject_name)} &middot; ${formatPercent(row.avg_score)}</span>`).join('')}</td></tr>`;
          }).join('') || `<tr><td colspan="3">${emptyState('No student averages available yet.')}</td></tr>`}
        </table></div>
      </section>
    </div>
  </div>`;
}

function usersPage(csrfToken) {
  const users = querySql(`SELECT u.id, u.name, u.username, u.role, t.name AS teacher_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    ORDER BY u.name;`);
  const teachers = querySql('SELECT id, name FROM os_teachers ORDER BY name;');
  const teacherOptions = teachers.map((teacher) => `<option value="${teacher.id}">${esc(teacher.name)}</option>`).join('');
  return `<div class="workspace">
    <header class="page-head"><div class="page-head-copy"><h1>Users</h1><p>Create administrator and teacher sign-ins.</p></div></header>
    <div class="split">
      ${actionPanel('Create User', `<form method="post" action="/users" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Name<input name="name" required maxlength="120" /></label>
        <label>Username<input name="username" required maxlength="80" /></label>
        <label>Role<select name="role"><option value="${ROLE_ADMIN}">Admin</option><option value="${ROLE_TEACHER}">Teacher</option></select></label>
        <label>Teacher Link<select name="teacherId"><option value="">None</option>${teacherOptions}</select></label>
        <label>Password<input type="password" name="password" required maxlength="120" /></label>
        <button type="submit">Create User</button>
      </form>`)}
      <section class="ledger">
        <div class="ledger-head"><h2>Current Users</h2><p>Teacher users can enter grades for classrooms linked to their teacher record.</p></div>
        <div class="table-wrap compact-table"><table>
          <tr><th>Name</th><th>Username</th><th>Role</th><th>Teacher</th></tr>
          ${users.map((user) => `<tr><td>${esc(user.name)}</td><td>${esc(user.username)}</td><td>${roleLabel(user.role)}</td><td>${esc(user.teacher_name || '') || '&mdash;'}</td></tr>`).join('')}
        </table></div>
      </section>
    </div>
  </div>`;
}

function parseGrades(value) {
  return sortGrades(String(value || '').split(',').map((grade) => cleanGrade(grade)).filter(Boolean));
}

function handlePost(req, res, p, body, user, headers) {
  if (p === '/login') {
    if (!requireCsrf(req, body)) return sendText(res, 403, 'Invalid CSRF token');
    const username = cleanText(body.username, 80).toLowerCase();
    const password = String(body.password || '').slice(0, 120);
    const row = querySql(`SELECT * FROM os_users WHERE username=${sqlValue(username)} LIMIT 1;`)[0];
    if (!row || !verifyPassword(password, row.password_hash)) return redirect(res, '/login?error=1', headers);
    clearSession(req, headers);
    createSession(row.id, headers);
    return redirect(res, '/', headers);
  }

  if (!user) return redirect(res, '/login', headers);
  if (!requireCsrf(req, body)) return sendText(res, 403, 'Invalid CSRF token');

  if (p === '/logout') {
    clearSession(req, headers);
    return redirect(res, '/login', headers);
  }

  if (p === '/switch-year') {
    const yearId = asInt(body.yearId);
    appendSetCookie(headers, `selectedYearId=${cookieValue(yearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    return redirect(res, req.headers.referer ? new URL(req.headers.referer).pathname : '/', headers);
  }

  if (p === '/families') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const familyId = asInt(body.familyId);
    if (familyId) {
      runSql(`UPDATE os_families
        SET family_name=${sqlValue(cleanText(body.familyName, 120))},
            father_name=${sqlValue(cleanText(body.fatherName, 120))},
            mother_name=${sqlValue(cleanText(body.motherName, 120))},
            phone=${sqlValue(cleanText(body.phone, 40))},
            email=${sqlValue(cleanText(body.email, 160))},
            address=${sqlValue(cleanText(body.address, 220))}
        WHERE id=${familyId};`);
      return redirect(res, `/setup?section=families&familyId=${familyId}`, headers);
    }
    const newFamilyId = insertReturningId(`INSERT INTO os_families (family_name, father_name, mother_name, phone, email, address)
      VALUES (${sqlValue(cleanText(body.familyName, 120))}, ${sqlValue(cleanText(body.fatherName, 120))}, ${sqlValue(cleanText(body.motherName, 120))}, ${sqlValue(cleanText(body.phone, 40))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.address, 220))})`);
    return redirect(res, `/setup?section=families&familyId=${newFamilyId}`, headers);
  }

  if (p === '/students') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const studentId = insertReturningId(`INSERT INTO os_students (family_id, first_name, last_name, birth_date)
      VALUES (${asInt(body.familyId)}, ${sqlValue(cleanText(body.firstName, 80))}, ${sqlValue(cleanText(body.lastName, 80))}, ${sqlValue(cleanDate(body.birthDate))})`);
    runSql(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id)
      VALUES (${studentId}, ${schoolYearId}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'});`);
    return redirect(res, `/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
  }

  if (p === '/enrollments') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    runSql(`INSERT OR REPLACE INTO os_student_years (student_id, school_year_id, grade_level, classroom_id, status)
      VALUES (${asInt(body.studentId)}, ${asInt(body.schoolYearId)}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'}, 'enrolled');`);
    const family = querySql(`SELECT family_id FROM os_students WHERE id=${asInt(body.studentId)} LIMIT 1;`)[0];
    return redirect(res, `/setup?section=families&familyId=${asInt(family?.family_id)}`, headers);
  }

  if (p === '/teachers') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const teacherId = asInt(body.teacherId);
    if (teacherId) {
      runSql(`UPDATE os_teachers
        SET name=${sqlValue(cleanText(body.name, 120))},
            email=${sqlValue(cleanText(body.email, 160))},
            phone=${sqlValue(cleanText(body.phone, 40))}
        WHERE id=${teacherId};`);
      return redirect(res, '/setup?section=teachers', headers);
    }
    runSql(`INSERT INTO os_teachers (name, email, phone)
      VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.phone, 40))});`);
    return redirect(res, '/setup?section=teachers', headers);
  }

  if (p === '/classrooms') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const classroomId = asInt(body.classroomId) || insertReturningId(`INSERT INTO os_classrooms (school_year_id, name, teacher_id)
      VALUES (${asInt(body.schoolYearId)}, ${sqlValue(cleanText(body.name, 120))}, ${asInt(body.teacherId) || 'NULL'})`);
    if (asInt(body.classroomId)) {
      runSql(`UPDATE os_classrooms
        SET school_year_id=${asInt(body.schoolYearId)},
            name=${sqlValue(cleanText(body.name, 120))},
            teacher_id=${asInt(body.teacherId) || 'NULL'}
        WHERE id=${classroomId};`);
      runSql(`DELETE FROM os_classroom_grades WHERE classroom_id=${classroomId};`);
    }
    parseGrades(body.grades).forEach((grade) => {
      runSql(`INSERT OR IGNORE INTO os_classroom_grades (classroom_id, grade_level)
        VALUES (${classroomId}, ${sqlValue(grade)});`);
    });
    return redirect(res, '/setup?section=classrooms', headers);
  }

  if (p === '/subjects') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const subjectId = asInt(body.subjectId);
    if (subjectId) {
      runSql(`UPDATE os_subjects SET name=${sqlValue(cleanText(body.name, 120))} WHERE id=${subjectId};`);
      return redirect(res, '/setup?section=subjects', headers);
    }
    runSql(`INSERT OR IGNORE INTO os_subjects (name) VALUES (${sqlValue(cleanText(body.name, 120))});`);
    return redirect(res, '/setup?section=subjects', headers);
  }

  if (p === '/grade-subjects') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    runSql(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id)
      VALUES (${asInt(body.schoolYearId)}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.subjectId)});`);
    return redirect(res, '/setup?section=subjects', headers);
  }

  if (p === '/school-years') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const existingYearId = asInt(body.yearId);
    if (String(body.makeActive) === '1') runSql('UPDATE os_school_years SET is_active=0;');
    if (existingYearId) {
      runSql(`UPDATE os_school_years
        SET name=${sqlValue(cleanText(body.name, 40))},
            start_date=${sqlValue(cleanDate(body.startDate))},
            end_date=${sqlValue(cleanDate(body.endDate))},
            is_active=${String(body.makeActive) === '1' ? 1 : 0}
        WHERE id=${existingYearId};`);
      if (String(body.makeActive) === '1') {
        appendSetCookie(headers, `selectedYearId=${cookieValue(existingYearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      }
      return redirect(res, '/setup?section=years', headers);
    }
    const yearId = insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
      VALUES (${sqlValue(cleanText(body.name, 40))}, ${sqlValue(cleanDate(body.startDate))}, ${sqlValue(cleanDate(body.endDate))}, ${String(body.makeActive) === '1' ? 1 : 0})`);
    appendSetCookie(headers, `selectedYearId=${cookieValue(yearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    return redirect(res, '/setup?section=years', headers);
  }

  if (p === '/promote-year') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const fromYearId = asInt(body.fromYearId);
    if (String(body.makeActive) === '1') runSql('UPDATE os_school_years SET is_active=0;');
    const newYearId = insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
      VALUES (${sqlValue(cleanText(body.name, 40))}, ${sqlValue(cleanDate(body.startDate))}, ${sqlValue(cleanDate(body.endDate))}, ${String(body.makeActive) === '1' ? 1 : 0})`);
    const enrollments = querySql(`SELECT student_id, grade_level FROM os_student_years WHERE school_year_id=${fromYearId} AND status='enrolled';`);
    enrollments.forEach((enrollment) => {
      runSql(`INSERT OR IGNORE INTO os_student_years (student_id, school_year_id, grade_level, status)
        VALUES (${asInt(enrollment.student_id)}, ${newYearId}, ${sqlValue(promoteGrade(enrollment.grade_level))}, 'enrolled');`);
    });
    appendSetCookie(headers, `selectedYearId=${cookieValue(newYearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    return redirect(res, '/setup?section=years', headers);
  }

  if (p === '/users') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const role = cleanText(body.role, 20).toLowerCase();
    if (!ROLES.includes(role)) return sendText(res, 400, 'Invalid role');
    const userId = asInt(body.userId);
    if (userId) {
      const password = String(body.password || '').slice(0, 120);
      const passwordSql = password ? `, password_hash=${sqlValue(hashPassword(password))}` : '';
      runSql(`UPDATE os_users
        SET name=${sqlValue(cleanText(body.name, 120))},
            username=${sqlValue(cleanText(body.username, 80).toLowerCase())},
            role=${sqlValue(role)},
            teacher_id=${role === ROLE_TEACHER ? (asInt(body.teacherId) || 'NULL') : 'NULL'}
            ${passwordSql}
        WHERE id=${userId};`);
      return redirect(res, '/setup?section=users', headers);
    }
    runSql(`INSERT INTO os_users (name, username, role, password_hash, teacher_id)
      VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.username, 80).toLowerCase())}, ${sqlValue(role)}, ${sqlValue(hashPassword(String(body.password || '').slice(0, 120)))}, ${role === ROLE_TEACHER ? (asInt(body.teacherId) || 'NULL') : 'NULL'});`);
    return redirect(res, '/setup?section=users', headers);
  }

  if (p === '/system-settings') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const schoolName = cleanText(body.schoolName, 120) || DEFAULT_SCHOOL_NAME;
    setSetting('school_name', schoolName);
    const logoPath = saveUploadedImage(body.logo, 'logo');
    if (logoPath) setSetting('logo_path', logoPath);
    const faviconPath = saveUploadedImage(body.favicon, 'favicon');
    if (faviconPath) setSetting('favicon_path', faviconPath);
    return redirect(res, '/setup?section=settings', headers);
  }

  if (p === '/gradebook') {
    const schoolYearId = asInt(body.schoolYearId);
    const gradeLevel = cleanGrade(body.gradeLevel);
    const subjectId = asInt(body.subjectId);
    const classroomId = asInt(body.classroomId);
    if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel, classroomId)) return sendText(res, 403, 'Forbidden');
    const maxScore = Math.max(1, asScore(body.maxScore) || 100);
    const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : 'NULL';
    const assignmentId = insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, classroom_id, title, category, assignment_date, max_score, teacher_id)
      VALUES (${schoolYearId}, ${sqlValue(gradeLevel)}, ${subjectId}, ${classroomId || 'NULL'}, ${sqlValue(cleanText(body.title, 140))}, ${sqlValue(cleanText(body.category, 24) || 'Lesson')}, ${sqlValue(cleanDate(body.assignmentDate))}, ${maxScore}, ${teacherId})`);
    Object.keys(body).forEach((key) => {
      if (!key.startsWith('score_')) return;
      const score = asScore(body[key]);
      if (score === null) return;
      runSql(`INSERT INTO os_scores (assignment_id, student_id, score)
        VALUES (${assignmentId}, ${asInt(key.replace('score_', ''))}, ${score});`);
    });
    return redirect(res, `/gradebook?yearId=${schoolYearId}&grade=${encodeURIComponent(gradeLevel)}&subjectId=${subjectId}&classroomId=${classroomId || ''}`, headers);
  }

  return sendText(res, 404, 'Not Found');
}

ensureDb();

const server = http.createServer(async (req, res) => {
  const headers = {};
  const csrfToken = getOrCreateCsrfToken(req, headers);

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const user = currentUser(req);

    if (req.method === 'GET' && p === '/assets/logo') {
      const logo = logoAsset();
      if (!fs.existsSync(logo)) return sendText(res, 404, 'Logo not found');
      res.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': contentTypeFor(logo),
        'Cache-Control': 'no-cache'
      });
      return res.end(fs.readFileSync(logo));
    }

    if (req.method === 'GET' && p === '/assets/favicon') {
      const favicon = faviconAsset();
      if (!fs.existsSync(favicon)) return sendText(res, 404, 'Favicon not found');
      res.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': contentTypeFor(favicon),
        'Cache-Control': 'no-cache'
      });
      return res.end(fs.readFileSync(favicon));
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      return handlePost(req, res, p, body, user, headers);
    }

    if (req.method !== 'GET') return sendText(res, 405, 'Method Not Allowed');

    if (p === '/login') {
      if (user) return redirect(res, '/', headers);
      return sendHtml(res, loginPage(csrfToken, url.searchParams.get('error') === '1'), headers);
    }

    if (!user) return redirect(res, '/login', headers);

    const { years, selected } = getSelectedYear(req, url);
    if (!selected) return sendText(res, 500, 'No school year configured');
    const pageArgs = { csrfToken, user, years, selectedYear: selected, currentPath: p };

    if (p === '/') return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Dashboard', content: dashboardPage(selected) }), headers);
    if (p === '/families') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return redirect(res, '/setup?section=families', headers);
    }
    if (p === '/setup') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return sendHtml(res, pageTemplate({ ...pageArgs, title: 'School Setup', content: setupPage(selected, csrfToken, url) }), headers);
    }
    if (p === '/gradebook') return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Gradebook', content: gradebookPage(req, url, user, selected, csrfToken) }), headers);
    if (p === '/reports') return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Reports', content: reportsPage(url, selected) }), headers);
    if (p === '/users') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return redirect(res, '/setup?section=users', headers);
    }

    return sendText(res, 404, 'Not Found');
  } catch (error) {
    if (error.message === 'Payload too large') return sendText(res, 413, 'Payload too large');
    console.error(error);
    return sendText(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Oakstead running on http://localhost:${PORT}`);
});
