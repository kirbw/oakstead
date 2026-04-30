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
const CATEGORIES = ['Lesson / Homework', 'Quiz', 'Test'];

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

function asPoints(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(10000, parsed));
}

function cleanScoreMode(value) {
  return value === 'wrong' ? 'wrong' : 'percent';
}

function compactNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  return parsed.toFixed(2).replace(/\.?0+$/, '');
}

function scoreInputToPoints(value, mode, maxScore) {
  if (String(value ?? '').trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const points = asPoints(maxScore);
  if (cleanScoreMode(mode) === 'percent') {
    const percent = Math.max(0, Math.min(100, parsed));
    return Number(((percent / 100) * points).toFixed(2));
  }
  const wrong = Math.max(0, Math.min(points, parsed));
  return Number((points - wrong).toFixed(2));
}

function scoreValueForMode(score, maxScore, mode) {
  if (score === null || score === undefined || score === '') return '';
  const earned = Number(score);
  const points = asPoints(maxScore);
  if (!Number.isFinite(earned)) return '';
  if (cleanScoreMode(mode) === 'percent') return compactNumber((earned / points) * 100);
  return compactNumber(Math.max(0, points - earned));
}

function scoreInputControl(studentId, value, maxScore, mode) {
  const points = compactNumber(asPoints(maxScore));
  const scoreMode = cleanScoreMode(mode);
  return `<div class="score-entry-cell">
    <input data-score-input data-score-points="${points}" data-score-mode="${scoreMode}" name="score_${studentId}" type="number" inputmode="decimal" min="0" max="${scoreMode === 'percent' ? '100' : points}" step="0.01" value="${esc(value)}" autocomplete="off" />
    <small class="score-preview" data-score-preview></small>
  </div>`;
}

function scoreModeToggle(percentUrl, wrongUrl, mode) {
  const scoreMode = cleanScoreMode(mode);
  return `<div class="score-mode" aria-label="Score entry mode">
    <span>Percent</span>
    <label class="score-switch">
      <input type="checkbox" data-score-mode-toggle data-percent-url="${esc(percentUrl)}" data-wrong-url="${esc(wrongUrl)}" ${scoreMode === 'wrong' ? 'checked' : ''} />
      <span class="score-switch-track" aria-hidden="true"><span class="score-switch-thumb"></span></span>
      <span class="sr-only">Use number wrong</span>
    </label>
    <span>Number wrong</span>
  </div>`;
}

function normalizeCategory(value) {
  const text = cleanText(value, 40).toLowerCase();
  if (text === 'lesson' || text === 'homework' || text === 'lesson / homework' || text === 'lesson/homework') return 'Lesson / Homework';
  if (text === 'quiz' || text === 'quizzes') return 'Quiz';
  if (text === 'test' || text === 'tests') return 'Test';
  return cleanText(value, 40) || 'Lesson / Homework';
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

function ensureColumn(table, column, definition) {
  const columns = querySql(`PRAGMA table_info(${table});`).map((row) => row.name);
  if (!columns.includes(column)) runSql(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end - start) / 86400000) + 1);
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
CREATE TABLE IF NOT EXISTS os_school_districts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL,
  school_district_id INTEGER,
  father_name TEXT,
  mother_name TEXT,
  father_phone TEXT,
  mother_phone TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_district_id) REFERENCES os_school_districts(id)
);
CREATE TABLE IF NOT EXISTS os_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  gender TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES os_families(id)
);
CREATE TABLE IF NOT EXISTS os_emergency_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  relationship TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES os_families(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS os_teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  mobile_phone TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_role_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_role_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (group_id, name),
  FOREIGN KEY (group_id) REFERENCES os_role_groups(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS os_person_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_type TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  role_type_id INTEGER NOT NULL,
  is_assistant INTEGER NOT NULL DEFAULT 0,
  term_start TEXT,
  term_end TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES os_role_groups(id),
  FOREIGN KEY (role_type_id) REFERENCES os_role_types(id)
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
CREATE TABLE IF NOT EXISTS os_absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  absence_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'days',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES os_students(id)
);
CREATE TABLE IF NOT EXISTS os_marking_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  period_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  UNIQUE (school_year_id, period_number),
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS os_grade_weight_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  min_grade TEXT NOT NULL,
  max_grade TEXT NOT NULL,
  subject_id INTEGER,
  rounding_mode TEXT NOT NULL DEFAULT 'nearest',
  calculation_mode TEXT NOT NULL DEFAULT 'weighted',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES os_subjects(id)
);
CREATE TABLE IF NOT EXISTS os_grade_weight_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  weight REAL NOT NULL,
  UNIQUE (group_id, category),
  FOREIGN KEY (group_id) REFERENCES os_grade_weight_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_os_sessions_token ON os_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_os_student_years_year_grade ON os_student_years(school_year_id, grade_level);
CREATE INDEX IF NOT EXISTS idx_os_assignments_year_grade_subject ON os_assignments(school_year_id, grade_level, subject_id);
`);

  ensureColumn('os_school_years', 'school_days', 'school_days INTEGER DEFAULT 180');
  ensureColumn('os_assignments', 'marking_period_id', 'marking_period_id INTEGER');
  ensureColumn('os_families', 'school_district_id', 'school_district_id INTEGER');
  ensureColumn('os_families', 'father_phone', 'father_phone TEXT');
  ensureColumn('os_families', 'mother_phone', 'mother_phone TEXT');
  ensureColumn('os_students', 'middle_name', 'middle_name TEXT');
  ensureColumn('os_students', 'gender', 'gender TEXT');
  ensureColumn('os_teachers', 'mobile_phone', 'mobile_phone TEXT');
  ensureColumn('os_teachers', 'address', 'address TEXT');

  runSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('school_name', ${sqlValue(DEFAULT_SCHOOL_NAME)});`);
  createDefaultRoleGroups();
  migrateLessonHomeworkWeights();

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

  querySql('SELECT id, name, start_date, end_date FROM os_school_years;').forEach((year) => {
    const periodCount = querySql(`SELECT COUNT(*) AS count FROM os_marking_periods WHERE school_year_id=${asInt(year.id)};`)[0]?.count || 0;
    if (!periodCount) createMarkingPeriods(asInt(year.id), 6, year.start_date, year.end_date);
    const weightCount = querySql(`SELECT COUNT(*) AS count FROM os_grade_weight_groups WHERE school_year_id=${asInt(year.id)};`)[0]?.count || 0;
    if (!weightCount) createDefaultWeightGroups(asInt(year.id));
  });

  runSql("DELETE FROM os_sessions WHERE expires_at <= datetime('now');");
}

function createMarkingPeriods(yearId, count, startDate = '', endDate = '') {
  const periods = Math.max(1, Math.min(12, asInt(count) || 6));
  const span = daysBetween(startDate, endDate);
  for (let index = 0; index < periods; index += 1) {
    const periodStart = span ? addDays(startDate, Math.floor((span * index) / periods)) : '';
    const periodEnd = span ? addDays(startDate, Math.floor((span * (index + 1)) / periods) - 1) : '';
    runSql(`INSERT OR REPLACE INTO os_marking_periods (school_year_id, period_number, name, start_date, end_date)
      VALUES (${yearId}, ${index + 1}, ${sqlValue(`Period ${index + 1}`)}, ${sqlValue(periodStart)}, ${sqlValue(periodEnd)});`);
  }
}

function createWeightGroup(yearId, name, minGrade, maxGrade, weights) {
  const groupId = insertReturningId(`INSERT INTO os_grade_weight_groups (school_year_id, name, min_grade, max_grade)
    VALUES (${yearId}, ${sqlValue(name)}, ${sqlValue(minGrade)}, ${sqlValue(maxGrade)})`);
  Object.entries(weights).forEach(([category, weight]) => {
    runSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
      VALUES (${groupId}, ${sqlValue(category)}, ${Number(weight) || 0});`);
  });
}

function createDefaultWeightGroups(yearId) {
  createWeightGroup(yearId, 'Grades 1-2', '1', '2', { 'Lesson / Homework': 50, Quiz: 25, Test: 25 });
  createWeightGroup(yearId, 'Grades 3-9', '3', '9', { 'Lesson / Homework': 25, Quiz: 25, Test: 50 });
}

function createDefaultRoleGroups() {
  const defaults = {
    'Board Members': ['Chairman', 'Secretary', 'Treasurer'],
    'Faculty Team': ['Teacher', 'Principal', 'Librarian', 'Nurse']
  };
  Object.entries(defaults).forEach(([groupName, roles]) => {
    const groupId = insertReturningId(`INSERT INTO os_role_groups (name) VALUES (${sqlValue(groupName)})
      ON CONFLICT(name) DO UPDATE SET name=excluded.name`);
    roles.forEach((roleName) => {
      runSql(`INSERT OR IGNORE INTO os_role_types (group_id, name) VALUES (${groupId}, ${sqlValue(roleName)});`);
    });
  });
}

function migrateLessonHomeworkWeights() {
  querySql('SELECT DISTINCT group_id FROM os_grade_weight_items;').forEach((row) => {
    const groupId = asInt(row.group_id);
    const legacyItems = querySql(`SELECT category, weight FROM os_grade_weight_items
      WHERE group_id=${groupId} AND category IN ('Lesson', 'Homework', 'Lesson / Homework');`);
    if (!legacyItems.length) return;
    const combinedWeight = Math.min(100, legacyItems.reduce((sum, item) => sum + Number(item.weight || 0), 0));
    runSql(`DELETE FROM os_grade_weight_items WHERE group_id=${groupId} AND category IN ('Lesson', 'Homework', 'Lesson / Homework');`);
    runSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
      VALUES (${groupId}, 'Lesson / Homework', ${combinedWeight});`);
  });
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

function gradeRank(grade) {
  const text = String(grade);
  if (/^pre-?k$/i.test(text)) return -2;
  if (/^k(indergarten)?$/i.test(text)) return -1;
  const number = Number(text);
  return Number.isFinite(number) ? number : 100 + text.toLowerCase().charCodeAt(0);
}

function sortGrades(grades) {
  return [...new Set(grades.filter(Boolean))].sort((a, b) => gradeRank(a) - gradeRank(b) || String(a).localeCompare(String(b)));
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
  return gradeChoices().map((grade) => `<option value="${esc(grade)}" ${grade === selected ? 'selected' : ''}>${esc(grade)}</option>`).join('');
}

function gradeChoices() {
  return ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Graduated'];
}

function cleanGender(value) {
  const gender = cleanText(value, 12).toLowerCase();
  return gender === 'female' || gender === 'male' ? gender : '';
}

function cleanPersonRoleType(value) {
  const type = cleanText(value, 20).toLowerCase();
  return ['teacher', 'father', 'mother'].includes(type) ? type : '';
}

function genderOptions(selected = '') {
  const gender = cleanGender(selected);
  return `<option value="">Not set</option><option value="female" ${selectedAttr(gender, 'female')}>Girl</option><option value="male" ${selectedAttr(gender, 'male')}>Boy</option>`;
}

function studentDisplayName(student) {
  return [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ');
}

function genderIcon(gender) {
  const clean = cleanGender(gender);
  const cls = clean === 'female' ? 'girl' : clean === 'male' ? 'boy' : 'neutral';
  return `<span class="student-icon ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></span>`;
}

function categoryOptions(selected = 'Lesson / Homework') {
  const selectedCategory = normalizeCategory(selected);
  return CATEGORIES.map((category) => `<option value="${esc(category)}" ${category === selectedCategory ? 'selected' : ''}>${esc(category)}</option>`).join('');
}

function displayCategory(category) {
  return esc(normalizeCategory(category));
}

function displayCategoryShort(category) {
  const cat = normalizeCategory(category);
  if (cat === 'Lesson / Homework') return 'Lesson';
  return esc(cat);
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

const KPI_ICONS = {
  families: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3ZM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 12.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5C23 14.17 18.33 13 16 13Z"/></svg>`,
  students: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82ZM12 3 1 9l11 6 9-4.91V17h2V9L12 3Z"/></svg>`,
  teachers: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm0 14H5.17L4 17.17V4h16v12ZM7 9h2v2H7V9Zm4 0h2v2h-2V9Zm4 0h2v2h-2V9Z"/></svg>`,
  classrooms: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 19V5c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v14H3v2h18v-2h-2Zm-8-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM16 18H8V5h8v13Z"/></svg>`,
  assignments: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1Zm2 14H7v-2h7v2Zm3-4H7v-2h10v2Zm0-4H7V7h10v2Z"/></svg>`
};

const NAV_ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-11h6V4h-6v5Z"></path></svg>',
  families: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0H3Zm8.5 0a6.5 6.5 0 0 0-1.3-3.9A5 5 0 0 1 21 20h-9.5Z"></path></svg>',
  setup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v3H4V5Zm0 6h10v3H4v-3Zm0 6h16v3H4v-3Zm13.5-6 2.5 1.5-2.5 1.5V11Z"></path></svg>',
  gradebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5V3Zm2 2v14h10V7h-3V5H7Zm2 5h6v2H9v-2Zm0 4h6v2H9v-2Z"></path></svg>',
  assignments: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1Zm-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8Z"/></svg>',
  reportcards: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6V3Zm2 2v14h8V5H8Zm1.5 3h5v2h-5V8Zm0 3h5v2h-5v-2Zm0 3h3v2h-3v-2Z"></path></svg>',
  absences: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v3h6V2h2v3h3v17H4V5h3V2Zm11 8H6v10h12V10Zm-9 3h2v2H9v-2Zm4 0h2v2h-2v-2Z"></path></svg>',
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
  font-family: Inter, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
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
.brand-text strong { display: block; font-size: 1.05rem; font-weight: 760; letter-spacing: 0; line-height: 1.2; }
.brand-text span { display: block; color: var(--muted); font-size: .82rem; margin-top: .05rem; line-height: 1.35; }
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
  font-weight: 650;
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
  line-height: 1.12;
  letter-spacing: 0;
  font-weight: 760;
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
.panel-title.inline-title {
  display: flex;
  align-items: baseline;
  gap: .25rem;
  flex-wrap: wrap;
}
.panel-title.inline-title span {
  color: var(--muted);
  font-size: .9rem;
}
.grid-2, .grid-3, .grid-4 { display: grid; gap: .7rem; grid-template-columns: 1fr; }
.form-grid { display: grid; gap: .7rem; grid-template-columns: 1fr; }
label { display: grid; gap: .32rem; color: var(--muted); font-size: .86rem; font-weight: 650; }
input, select, textarea {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  padding: .62rem .68rem;
}
input[type="checkbox"] { width: auto; min-height: auto; }
.check-row {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: .45rem;
  padding: .62rem .68rem;
  border: 1px solid var(--line-strong);
  background: var(--paper-strong);
  color: var(--ink);
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
  box-shadow: var(--shadow);
}
.kpi-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: .32rem; }
.kpi-icon svg { width: 20px; height: 20px; fill: var(--muted); display: block; opacity: .55; }
.kpi span { color: var(--muted); font-size: .82rem; font-weight: 650; }
.kpi strong { display: block; font-size: 1.55rem; line-height: 1; }
.week-svg { width: 100%; height: auto; display: block; overflow: visible; margin-top: .4rem; }
.week-svg .guide { stroke: var(--line); fill: none; }
.week-svg .y-label { fill: var(--muted); font-size: 9px; font-family: inherit; }
.week-svg .area { fill: var(--accent); opacity: .1; }
.week-svg .line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.week-svg .dot { fill: var(--accent); stroke: var(--paper); stroke-width: 2; }
.week-svg .x-label { fill: var(--muted); font-size: 9px; text-anchor: middle; font-family: inherit; }
.week-svg .empty-msg { fill: var(--muted); font-size: 11px; text-anchor: middle; font-family: inherit; }
.table-wrap { width: 100%; overflow-x: visible; }
table { width: 100%; min-width: 0; border-collapse: collapse; table-layout: fixed; }
th, td { padding: .68rem .75rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: .9rem; }
th { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .025em; font-weight: 700; background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg)); }
td { overflow-wrap: anywhere; }
tr:last-child td { border-bottom: 0; }
.compact-table table { min-width: 0; table-layout: auto; }
.assignment-history-table td { overflow-wrap: normal; }
.assignment-history-table th:nth-child(1),
.assignment-history-table td:nth-child(1) {
  width: 6.8rem;
  white-space: nowrap;
}
.assignment-history-table th:nth-child(3),
.assignment-history-table td:nth-child(3),
.assignment-history-table th:nth-child(4),
.assignment-history-table td:nth-child(4),
.assignment-history-table th:nth-child(5),
.assignment-history-table td:nth-child(5),
.assignment-history-table th:nth-child(6),
.assignment-history-table td:nth-child(6) {
  white-space: nowrap;
}
.assignment-history-table th:nth-child(2),
.assignment-history-table td:nth-child(2) {
  min-width: 6.5rem;
}
.assignment-history-table .badge {
  white-space: nowrap;
}
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
.type-chip { font-size: .78rem; font-weight: 700; color: var(--muted); }
.selected-row > td { background: var(--accent-soft); color: var(--accent-dark); }
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
.class-average-callout {
  align-self: end;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  min-height: 42px;
  padding: .55rem .7rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent-soft) 54%, var(--paper));
  color: var(--muted);
  font-size: .84rem;
  font-weight: 700;
}
.class-average-callout b {
  color: var(--ink);
  font-size: .95rem;
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
.score-student-label {
  display: flex;
  align-items: baseline;
  gap: .35rem;
  flex-wrap: wrap;
}
.student-period-avg {
  color: var(--muted);
  font-size: .82rem;
  font-weight: 800;
  white-space: nowrap;
}
.student-period-avg::before {
  content: "- ";
  color: var(--muted);
}
.score-row small { display: block; color: var(--muted); margin-top: .12rem; }
.score-row input { text-align: center; font-weight: 800; }
.score-entry-cell { display: grid; gap: .15rem; }
.score-entry-cell .score-preview {
  min-height: 1rem;
  margin: 0;
  color: var(--muted);
  text-align: center;
  font-size: .72rem;
  font-weight: 700;
}
.score-mode {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  min-height: 32px;
  color: var(--muted);
  font-size: .8rem;
  font-weight: 800;
}
.score-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  gap: 0;
  cursor: pointer;
}
.score-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.score-switch-track {
  position: relative;
  width: 42px;
  height: 24px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--paper-strong);
  transition: background .16s ease, border-color .16s ease;
}
.score-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--muted);
  transition: transform .16s ease, background .16s ease;
}
.score-switch input:checked + .score-switch-track {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 20%, var(--paper-strong));
}
.score-switch input:checked + .score-switch-track .score-switch-thumb {
  transform: translateX(18px);
  background: var(--accent);
}
.score-switch input:focus-visible + .score-switch-track {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.score-help {
  margin: -.2rem 0 .1rem;
  color: var(--muted);
  font-size: .84rem;
}
.assignment-picker {
  max-width: 420px;
}
.score-save-btn {
  justify-self: end;
  min-width: 128px;
}
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
  cursor: pointer;
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
.assignments-layout {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
}
.assignment-editor {
  align-self: start;
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
.setup-link strong { font-size: .94rem; font-weight: 700; }
.setup-link span { color: var(--muted); font-size: .84rem; line-height: 1.45; }
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
.family-count { color: var(--muted); font-size: .84rem; font-weight: 650; }
.family-link {
  display: grid;
  gap: .28rem;
  padding: .82rem .9rem;
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  transition: background .16s ease, color .16s ease;
}
.family-link:last-child { border-bottom: 0; }
.family-link strong { font-size: .98rem; font-weight: 720; line-height: 1.28; }
.family-link span { color: var(--muted); font-size: .84rem; line-height: 1.4; }
.family-link small { color: var(--muted); font-size: .84rem; line-height: 1.4; }
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
.detail-item span { color: var(--muted); font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .025em; }
.detail-item strong { font-size: .98rem; font-weight: 680; line-height: 1.35; }
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
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .65rem;
  align-items: center;
  padding: .75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.child-row b { font-size: .95rem; }
.child-row span { color: var(--muted); font-size: .84rem; }
.child-row-main { display: grid; gap: .25rem; min-width: 0; }
.child-name-line {
  display: flex;
  align-items: center;
  gap: .5rem;
  min-width: 0;
}
.student-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.student-icon svg { width: 100%; height: 100%; display: block; }
.student-icon.neutral svg { fill: var(--muted); }
.student-icon.girl svg { fill: #be185d; }
.student-icon.boy svg { fill: #1d4ed8; }
.family-detail-body button[type="submit"] { justify-self: start; }
.asgn-link { display: flex; align-items: center; gap: .5rem; }
.asgn-link .asgn-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 720; font-size: .9rem; }
.asgn-link .asgn-meta { color: var(--muted); font-size: .78rem; white-space: nowrap; flex-shrink: 0; }
.grade-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
  gap: .45rem;
}
.grade-checkbox {
  display: flex;
  align-items: center;
  gap: .45rem;
  padding: .48rem .55rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
  color: var(--ink);
  font-size: .84rem;
  font-weight: 700;
}
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
.report-card-actions { display: flex; justify-content: flex-end; gap: .55rem; }
.report-card-document {
  display: grid;
  gap: 1rem;
  color: #285f56;
}
.report-card-spread {
  width: min(1060px, 100%);
  min-height: 816px;
  box-sizing: border-box;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #6d7773;
  box-shadow: var(--shadow);
  font-family: "Trebuchet MS", Arial, sans-serif;
}
.cover-spread {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px minmax(0, 1fr);
}
.inside-spread {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2.4rem;
  padding: 40px 38px 32px;
}
.report-page { position: relative; padding: 66px 80px 32px; }
.report-spine {
  background: #9fb5ae;
  border-left: 4px double #275c53;
  border-right: 4px double #275c53;
}
.parent-page .parent-note {
  margin-top: 4px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.35;
}
.signature-line {
  width: 100%;
  border-top: 1px solid #285f56;
  text-align: center;
  margin-top: 50px;
  padding-top: 2px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
}
.generated-note {
  position: absolute;
  bottom: 28px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: Georgia, "Times New Roman", serif;
  font-style: italic;
  color: #164c43;
}
.cover-page {
  display: grid;
  align-content: start;
  justify-items: center;
  text-align: center;
}
.cover-leaf { width: 44px; height: 44px; object-fit: contain; margin-bottom: 6px; }
.cover-page h2 {
  margin: 0 0 10px;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 36px;
  color: #1e5048;
  line-height: 1.1;
}
.cover-of {
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
  margin-bottom: 24px;
}
.script-line {
  width: 330px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 22px;
  line-height: 1.1;
  padding-bottom: 2px;
}
.cover-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 20px 0 26px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
}
.blank-line {
  display: inline-block;
  min-width: 62px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 20px;
  line-height: 1;
}
.school-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 700;
}
.school-line .script-line {
  width: 200px;
  font-size: 21px;
}
.school-name-line {
  width: 330px;
  border-bottom: 1px solid #285f56;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 20px;
  line-height: 1.1;
  padding-bottom: 2px;
  white-space: nowrap;
}
.book-mark { width: 132px; height: 96px; margin: 2px 0 16px; }
.verse {
  max-width: 260px;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  font-style: italic;
  line-height: 1.2;
}
.parents-copy {
  max-width: 310px;
  margin-top: 66px;
  text-align: left;
  color: #164c43;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14px;
  line-height: 1.3;
}
.parents-copy em { display: block; margin-bottom: 8px; }
.board-signoff { text-align: right; font-style: italic; }
.period-grid-wrap {
  display: grid;
  grid-template-columns: minmax(155px, 1fr) 216px;
  gap: 16px;
  align-items: start;
}
.subject-list,
.conduct-list {
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.32;
}
.subject-list span { display: block; }
.subject-list .sub,
.conduct-list .sub {
  display: block;
  padding-left: 14px;
  font-size: 12px;
}
.period-table,
.conduct-table,
.attendance-table {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
  border-bottom: 2px solid #2e675d;
}
.period-table th,
.period-table td,
.conduct-table th,
.conduct-table td,
.attendance-table th,
.attendance-table td {
  border: 2px solid #2e675d;
  height: 16px;
  padding: 0 3px;
  text-align: center;
  vertical-align: middle;
  color: #111827;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 13px;
  line-height: 1;
}
.period-table th,
.conduct-table th,
.attendance-table th {
  background: #638980;
  color: #fff;
  font-family: "Trebuchet MS", Arial, sans-serif;
  font-size: 11px;
  font-weight: 700;
}
.period-table .average-col {
  background: #eef5f2;
  color: #164c43;
  font-family: "Trebuchet MS", Arial, sans-serif;
  font-weight: 700;
}
.period-table th.average-col {
  background: #51786f;
  color: #fff;
  font-size: 10px;
}
.key-subject {
  margin-top: 24px;
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.55;
}
.key-subject h3,
.conduct-panel h3,
.attendance h3 {
  margin: 0 0 4px;
  color: #285f56;
  font-size: 15px;
}
.key-row {
  display: grid;
  grid-template-columns: 28px 92px 1fr;
  gap: 12px;
}
.conduct-panel {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) 186px;
  gap: 22px;
  color: #2b6b61;
  font-size: 12px;
  line-height: 1.36;
}
.conduct-panel h3 { text-transform: uppercase; letter-spacing: .02em; }
.conduct-section strong {
  display: block;
  color: #2b6b61;
  font-size: 14px;
  line-height: 1.15;
  margin: 1px 0;
  padding-left: 5px;
  background: linear-gradient(90deg, rgba(99, 137, 128, .22), rgba(99, 137, 128, 0));
}
.conduct-section span { display: block; padding-left: 15px; }
.conduct-table td {
  height: 17px;
  font-size: 12px;
  background: #fff;
}
.conduct-table tr.conduct-section-row td {
  background: linear-gradient(90deg, #dcebe6, #f7fbf9);
}
.conduct-table th,
.conduct-table td {
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.conduct-keys {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 14px;
  color: #164c43;
  font-size: 12px;
  line-height: 1.45;
}
.attendance {
  margin-top: 20px;
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 284px;
  gap: 18px;
  align-items: start;
  color: #164c43;
}
.attendance-labels {
  display: grid;
  grid-template-rows: 20px 20px 20px;
  align-items: center;
}
.attendance-labels h3 {
  align-self: center;
  margin: 0;
}
.attendance-labels div,
.attendance-labels strong {
  min-height: 20px;
  display: flex;
  align-items: center;
}
.attendance-table th,
.attendance-table td {
  height: 20px;
  line-height: 1;
  vertical-align: middle;
}
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
  .form-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.five { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .filters { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }
  .compact-filters { grid-template-columns: repeat(auto-fill, minmax(130px, 180px)); }
  .class-average-callout { min-width: 190px; }
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
  .gradebook-split { grid-template-columns: minmax(0, 1fr) minmax(500px, .92fr); }
  .kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .family-layout { grid-template-columns: 320px minmax(0, 1fr); align-items: start; }
  .assignments-layout { grid-template-columns: minmax(460px, 1fr) minmax(300px, 420px); align-items: start; }
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
  @page { size: letter landscape; margin: 0; }
  html, body { width: 11in; margin: 0; background: #fff; color: #111; }
  .topbar, .sidebar, .filters, .inline-actions, .quick-scores, .report-card-actions, .panel, .page-head { display: none !important; }
  .app { display: block; width: 100%; }
  .main { padding: 0; }
  .panel, .ledger, .kpi { box-shadow: none; break-inside: avoid; }
  body.report-card-printing .workspace > :not(.report-card-document) { display: none !important; }
  body.report-card-printing .report-card-document { display: block; gap: 0; width: 11in; }
  body.report-card-printing .report-card-spread {
    width: 11in;
    height: 8.5in;
    min-height: 8.5in;
    margin: 0;
    border: 0;
    box-shadow: none;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  body.report-card-printing .report-card-spread:last-child { page-break-after: auto; break-after: auto; }
  body.report-card-printing .period-table,
  body.report-card-printing .conduct-table,
  body.report-card-printing .attendance-table { border-bottom-width: .75px; }
  body.report-card-printing .period-table th,
  body.report-card-printing .period-table td,
  body.report-card-printing .conduct-table th,
  body.report-card-printing .conduct-table td,
  body.report-card-printing .attendance-table th,
  body.report-card-printing .attendance-table td { border-width: .75px; }
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
    ${navLink('/assignments', currentPath, 'Assignments', 'assignments')}
    ${navLink('/gradebook', currentPath, 'Gradebook', 'gradebook')}
    ${navLink('/absences', currentPath, 'Absences', 'absences')}
    ${navLink('/reports', currentPath, 'Reports', 'reports')}
    ${navLink('/report-cards', currentPath, 'Report Card', 'reportcards')}
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
function generateReportCardPdf(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;
  function restore() {
    btn.textContent = orig; btn.disabled = false;
    document.body.classList.remove('report-card-printing');
  }
  document.body.classList.add('report-card-printing');
  setTimeout(function() {
    window.print();
    setTimeout(restore, 700);
  }, 50);
}
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
  document.querySelectorAll('[data-auto-submit]').forEach(function(control) {
    control.addEventListener('change', function() {
      control.form.submit();
    });
  });

  let activeScoreInput = null;
  document.addEventListener('focusin', function(event) {
    if (event.target.matches('[data-score-input]')) activeScoreInput = event.target;
  });
  document.querySelectorAll('[data-assignment-select]').forEach(function(select) {
    select.addEventListener('change', function() {
      if (this.dataset.baseUrl) {
        var nextUrl = new URL(this.dataset.baseUrl, window.location.origin);
        if (this.value) nextUrl.searchParams.set('assignmentId', this.value);
        window.location.href = nextUrl.toString();
        return;
      }
      if (this.value) {
        this.form.submit();
      } else {
        var url = new URL(window.location.href);
        url.searchParams.delete('assignmentId');
        window.location.href = url.toString();
      }
    });
  });

  function formatScorePreviewNumber(value) {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(1).replace(/\\.0$/, '');
  }

  function updateScorePreview(input) {
    const preview = input.closest('.score-entry-cell')?.querySelector('[data-score-preview]');
    if (!preview) return;
    const formPoints = Number(input.form?.querySelector('input[name="maxScore"]')?.value);
    const points = Number.isFinite(formPoints) && formPoints > 0 ? formPoints : Number(input.dataset.scorePoints || 100);
    const raw = Number(input.value);
    const mode = input.dataset.scoreMode || input.form?.querySelector('input[name="scoreMode"]')?.value || 'wrong';
    input.max = mode === 'percent' ? '100' : String(points);
    if (!Number.isFinite(raw)) {
      preview.textContent = mode === 'percent' ? formatScorePreviewNumber(points) + ' pts possible' : 'out of ' + formatScorePreviewNumber(points);
      return;
    }
    if (mode === 'percent') {
      const earned = Math.max(0, Math.min(points, (Math.max(0, Math.min(100, raw)) / 100) * points));
      preview.textContent = formatScorePreviewNumber(earned) + ' / ' + formatScorePreviewNumber(points) + ' pts';
      return;
    }
    const wrong = Math.max(0, Math.min(points, raw));
    const percent = points > 0 ? ((points - wrong) / points) * 100 : 0;
    preview.textContent = formatScorePreviewNumber(percent) + '%';
  }

  document.querySelectorAll('[data-score-input]').forEach(function(input) {
    updateScorePreview(input);
    input.addEventListener('input', function() {
      updateScorePreview(input);
    });
  });
  document.querySelectorAll('[data-score-mode-toggle]').forEach(function(toggle) {
    toggle.addEventListener('change', function() {
      window.location.href = toggle.checked ? toggle.dataset.wrongUrl : toggle.dataset.percentUrl;
    });
  });
  document.querySelectorAll('input[name="maxScore"]').forEach(function(pointsInput) {
    pointsInput.addEventListener('input', function() {
      pointsInput.form?.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    });
  });

  document.querySelectorAll('form[action="/person-roles"]').forEach(function(form) {
    const groupSelect = form.querySelector('select[name="groupId"]');
    const roleSelect = form.querySelector('select[name="roleTypeId"]');
    if (!groupSelect || !roleSelect) return;
    function syncRoleOptions() {
      const groupId = groupSelect.value;
      Array.from(roleSelect.options).forEach(function(option) {
        if (!option.value) return;
        const matches = !groupId || option.dataset.roleGroup === groupId;
        option.disabled = !matches;
        option.hidden = !matches;
      });
      if (roleSelect.selectedOptions[0] && roleSelect.selectedOptions[0].disabled) roleSelect.value = '';
    }
    groupSelect.addEventListener('change', syncRoleOptions);
    syncRoleOptions();
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
      ${description ? `<p>${esc(description)}</p>` : ''}
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

function weeklyAverageChart(weekData) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const row = weekData.find(r => r.day === key);
    days.push({ label, avg: row ? Number(row.avg_score) : null });
  }

  const W = 400, H = 130;
  const padL = 32, padR = 10, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const toX = (i) => (padL + (i / 6) * chartW).toFixed(1);
  const toY = (v) => (padT + chartH - (v / 100) * chartH).toFixed(1);

  const guides = [25, 50, 75, 100].map(v => {
    const y = toY(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="guide" stroke-dasharray="3 3" /><text x="${padL - 4}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" class="y-label">${v}%</text>`;
  }).join('');

  const pts = days.map((d, i) => ({ ...d, i })).filter(p => p.avg !== null);
  let linePath = '', areaPath = '';
  if (pts.length >= 1) {
    linePath = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${toX(p.i)} ${toY(p.avg)}`).join(' ');
    const first = pts[0], last = pts[pts.length - 1];
    const bottom = (padT + chartH).toFixed(1);
    areaPath = `${linePath} L${toX(last.i)} ${bottom} L${toX(first.i)} ${bottom} Z`;
  }

  const dots = pts.map(p => `<circle cx="${toX(p.i)}" cy="${toY(p.avg)}" r="3.5" class="dot" />`).join('');
  const xLabels = days.map((d, i) => `<text x="${toX(i)}" y="${H - 4}" class="x-label">${d.label}</text>`).join('');
  const emptyMsg = pts.length === 0
    ? `<text x="${(W / 2).toFixed(0)}" y="${(padT + chartH / 2 + 4).toFixed(0)}" class="empty-msg">No scores recorded this week</text>`
    : '';

  const scored = days.filter(d => d.avg !== null);
  const overallAvg = scored.length ? scored.reduce((s, d) => s + d.avg, 0) / scored.length : null;

  return {
    overallAvg,
    svg: `<svg class="week-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${guides}
      ${areaPath ? `<path d="${areaPath}" class="area" />` : ''}
      ${linePath ? `<path d="${linePath}" class="line" />` : ''}
      ${dots}
      ${xLabels}
      ${emptyMsg}
    </svg>`
  };
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
      COUNT(sc.id) AS scores, ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC
    LIMIT 8;`);
  const weekData = querySql(`SELECT DATE(a.assignment_date) AS day,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
    FROM os_assignments a
    JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
      AND DATE(a.assignment_date) >= DATE('now', '-6 days')
    GROUP BY DATE(a.assignment_date)
    ORDER BY day ASC;`);
  const chart = weeklyAverageChart(weekData);
  const overallLabel = chart.overallAvg !== null ? `${Number(chart.overallAvg).toFixed(1)}% this week` : 'No data this week';

  return `<div class="workspace">
    ${schoolYearHead('Dashboard', 'A compact working view for enrollment, classrooms, and grades.', selectedYear)}
    <section class="kpis">
      <article class="kpi"><div class="kpi-head"><span>Families</span><div class="kpi-icon">${KPI_ICONS.families}</div></div><strong>${kpis.families}</strong></article>
      <article class="kpi"><div class="kpi-head"><span>Students</span><div class="kpi-icon">${KPI_ICONS.students}</div></div><strong>${kpis.students}</strong></article>
      <article class="kpi"><div class="kpi-head"><span>Teachers</span><div class="kpi-icon">${KPI_ICONS.teachers}</div></div><strong>${kpis.teachers}</strong></article>
      <article class="kpi"><div class="kpi-head"><span>Classrooms</span><div class="kpi-icon">${KPI_ICONS.classrooms}</div></div><strong>${kpis.classrooms}</strong></article>
      <article class="kpi"><div class="kpi-head"><span>Assignments</span><div class="kpi-icon">${KPI_ICONS.assignments}</div></div><strong>${kpis.assignments}</strong></article>
    </section>
    <div class="split">
      <section class="chart-panel">
        <div class="chart-head"><h2>School Average &mdash; Past 7 Days</h2><span>${overallLabel}</span></div>
        ${chart.svg}
      </section>
      <section class="ledger">
        <div class="ledger-head"><h2>Recent Gradebook Entries</h2><p>Newest lessons, quizzes, and tests in this school year.</p></div>
        <div class="table-wrap compact-table"><table>
          <tr><th>Assignment</th><th>Type</th><th>Gr.</th><th>Subject</th><th>Avg</th></tr>
          ${recent.map((row) => `<tr>
            <td>${esc(row.title)}</td>
            <td><span class="type-chip">${displayCategoryShort(row.category)}</span></td>
            <td>${esc(row.grade_level)}</td>
            <td>${esc(row.subject_name)}</td>
            <td><span class="badge ${gradeTone(row.avg_score)}">${formatPercent(row.avg_score)}</span></td>
          </tr>`).join('') || `<tr><td colspan="5">${emptyState('No grades have been entered for this year yet.')}</td></tr>`}
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
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
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
      const parents = [family.father_name, family.mother_name].filter(Boolean).join(' & ');
      const householdLine = parents ? `${family.family_name}, ${parents}` : family.family_name;
      return `<a class="family-link ${active}" href="/families?familyId=${family.id}">
        <strong>${esc(householdLine)}</strong>
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
      <div class="subhead"><h3>Parent Groups and Roles</h3></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Parent</th><th>Group</th><th>Role</th><th>Term Starts</th><th>Term Ends</th><th></th></tr>
        ${['father', 'mother'].map((parentType) => {
          const label = parentType === 'father' ? (selectedFamily.father_name || 'Father') : (selectedFamily.mother_name || 'Mother');
          const rows = personRoles.filter((role) => role.person_type === parentType && asInt(role.person_id) === asInt(selectedFamily.id));
          return rows.map((role) => `<tr>
            <td>${esc(label)}</td>
            <td>${esc(role.group_name)}</td>
            <td>${role.is_assistant ? 'Assistant ' : ''}${esc(role.role_name)}</td>
            <td>${esc(role.term_start || '') || '&mdash;'}</td>
            <td>${esc(role.term_end || '') || '&mdash;'}</td>
            <td>
              <form method="post" action="/person-roles" style="margin:0">
                ${csrfInput(csrfToken)}
                <input type="hidden" name="action" value="delete" />
                <input type="hidden" name="roleAssignmentId" value="${role.id}" />
                <input type="hidden" name="redirectTo" value="${esc(`/setup?section=families&familyId=${selectedFamily.id}`)}" />
                <button class="secondary-btn compact-action" type="submit">Remove</button>
              </form>
            </td>
          </tr>`).join('');
        }).join('') || `<tr><td colspan="6">${emptyState('No parent roles assigned yet.')}</td></tr>`}
      </table></div>
      <div class="inline-actions">
        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-father-role">Add Father Role</a>
        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-mother-role">Add Mother Role</a>
      </div>
      ${(action === 'add-father-role' || action === 'add-mother-role') ? `<div class="subhead"><h3>${action === 'add-father-role' ? 'Add Father Role' : 'Add Mother Role'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${roleAssignmentForm({ csrfToken, redirectTo: `/setup?section=families&familyId=${selectedFamily.id}`, personType: action === 'add-father-role' ? 'father' : 'mother', personId: selectedFamily.id, roleGroups, roleTypes })}` : ''}
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
  const validSections = ['families', 'districts', 'teachers', 'classrooms', 'subjects', 'years', 'weights', 'users', 'settings'];
  const section = validSections.includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'families';
  const action = cleanText(url.searchParams.get('action'), 40);
  const settings = appSettings();
  const teachers = querySql('SELECT * FROM os_teachers ORDER BY name;');
  const subjects = querySql('SELECT * FROM os_subjects ORDER BY name;');
  const districts = querySql('SELECT * FROM os_school_districts ORDER BY name;');
  const roleGroups = querySql('SELECT * FROM os_role_groups ORDER BY name;');
  const roleTypes = querySql('SELECT rt.*, rg.name AS group_name FROM os_role_types rt JOIN os_role_groups rg ON rg.id = rt.group_id ORDER BY rg.name, rt.name;');
  const personRoles = querySql(`SELECT pr.*, rg.name AS group_name, rt.name AS role_name
    FROM os_person_roles pr
    JOIN os_role_groups rg ON rg.id = pr.group_id
    JOIN os_role_types rt ON rt.id = pr.role_type_id
    ORDER BY pr.term_start DESC, rg.name, rt.name;`);
  const schoolYears = querySql('SELECT * FROM os_school_years ORDER BY is_active DESC, name DESC;');
  const markingPeriods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const classrooms = querySql(`SELECT c.*, t.name AS teacher_name,
      GROUP_CONCAT(cg.grade_level, ', ') AS grades
    FROM os_classrooms c
    LEFT JOIN os_teachers t ON t.id = c.teacher_id
    LEFT JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${yearId}
    GROUP BY c.id
    ORDER BY c.name;`);
  const gradeSubjects = querySql(`SELECT gs.grade_level, gs.subject_id, s.name AS subject_name
    FROM os_grade_subjects gs
    JOIN os_subjects s ON s.id = gs.subject_id
    WHERE gs.school_year_id=${yearId}
    ORDER BY gs.grade_level, s.name;`);
  const families = querySql(`SELECT f.*, sd.name AS school_district_name,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_school_districts sd ON sd.id = f.school_district_id
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`);
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`);
  const users = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, t.name AS teacher_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    ORDER BY u.name;`);
  const weightGroups = querySql(`SELECT wg.*, s.name AS subject_name
    FROM os_grade_weight_groups wg
    LEFT JOIN os_subjects s ON s.id = wg.subject_id
    WHERE wg.school_year_id=${yearId}
    ORDER BY CAST(wg.min_grade AS INTEGER), wg.name;`);
  const weightItems = querySql(`SELECT * FROM os_grade_weight_items
    WHERE group_id IN (SELECT id FROM os_grade_weight_groups WHERE school_year_id=${yearId})
    ORDER BY category;`);
  const teacherOptions = (selected = '') => teachers.map((teacher) => `<option value="${teacher.id}" ${selectedAttr(teacher.id, selected)}>${esc(teacher.name)}</option>`).join('');
  const subjectOptions = (selected = '') => subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(subject.id, selected)}>${esc(subject.name)}</option>`).join('');
  const classroomOptions = (selected = '') => classrooms.map((room) => `<option value="${room.id}" ${selectedAttr(room.id, selected)}>${esc(room.name)}</option>`).join('');
  const districtOptions = (selected = '') => districts.map((district) => `<option value="${district.id}" ${selectedAttr(district.id, selected)}>${esc(district.name)}</option>`).join('');
  const setupLinks = [
    ['families', 'Families', `${families.length} households`],
    ['districts', 'School Districts', `${districts.length} districts`],
    ['teachers', 'Teachers', `${teachers.length} records`],
    ['classrooms', 'Classrooms', `${classrooms.length} rooms in ${selectedYear.name}`],
    ['subjects', 'Subjects', `${subjects.length} subjects`],
    ['years', 'School Years', `${schoolYears.length} years`],
    ['weights', 'Grade Weights', `${weightGroups.length} groups`],
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
  const childEdit = selectedChildren.find((student) => student.id === asInt(url.searchParams.get('studentId')));
  const emergencyContacts = selectedFamily ? querySql(`SELECT * FROM os_emergency_contacts WHERE family_id=${selectedFamily.id} ORDER BY priority, name;`) : [];
  const emergencyEdit = emergencyContacts.find((contact) => contact.id === asInt(url.searchParams.get('contactId')));
  const familyList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Families</h2>
      <div class="module-actions"><span class="family-count">${families.length}</span><a class="page-action compact-action" href="/setup?section=families&action=add-family">Add Family</a></div>
    </div>
    ${families.map((family) => {
      const active = selectedFamily?.id === family.id && !showFamilyForm ? 'active' : '';
      const childText = `${family.child_count || 0} ${Number(family.child_count) === 1 ? 'child' : 'children'}`;
      const parents = [family.father_name, family.mother_name].filter(Boolean).join(' & ');
      const householdLine = parents ? `${family.family_name}, ${parents}` : family.family_name;
      const contact = [family.father_phone || family.phone, family.mother_phone].filter(Boolean).join(' / ');
      return `<a class="family-link ${active}" href="/setup?section=families&familyId=${family.id}">
        <strong>${esc(householdLine)}</strong>
        <span>${esc(childText)}${family.school_district_name ? ` / ${esc(family.school_district_name)}` : ''}${contact ? ` / ${esc(contact)}` : ''}</span>
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
        <label>School District<select name="schoolDistrictId"><option value="">Not selected</option>${districtOptions(familyForForm?.school_district_id || '')}</select></label>
        <label>Father<input name="fatherName" maxlength="120" value="${esc(familyForForm?.father_name || '')}" /></label>
        <label>Father Phone<input name="fatherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.father_phone || familyForForm?.phone || '')}" /></label>
        <label>Mother<input name="motherName" maxlength="120" value="${esc(familyForForm?.mother_name || '')}" /></label>
        <label>Mother Phone<input name="motherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.mother_phone || '')}" /></label>
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
    ${childEdit ? `<input type="hidden" name="studentId" value="${childEdit.id}" />` : ''}
    <label>First Name<input name="firstName" required maxlength="80" value="${esc(childEdit?.first_name || '')}" /></label>
    <label>Middle Name<input name="middleName" maxlength="80" value="${esc(childEdit?.middle_name || '')}" /></label>
    <label>Last Name<input name="lastName" required maxlength="80" value="${esc(childEdit?.last_name || selectedFamily.family_name)}" /></label>
    <label>Gender<select name="gender">${genderOptions(childEdit?.gender || '')}</select></label>
    <label>Birthday<input type="date" name="birthDate" value="${esc(childEdit?.birth_date || '')}" /></label>
    ${childEdit ? `<label>Grade<input value="${esc(childEdit.grade_level || 'Not enrolled')}" disabled /></label>` : `<label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>`}
    <label>Classroom<select name="classroomId"><option value="">Not assigned yet</option>${classroomOptions(childEdit?.classroom_id || '')}</select></label>
    <button type="submit">${childEdit ? 'Save Child' : 'Add Child'}</button>
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
	        <div class="detail-item"><span>Father Phone</span><strong>${esc(selectedFamily.father_phone || selectedFamily.phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother</span><strong>${esc(selectedFamily.mother_name || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother Phone</span><strong>${esc(selectedFamily.mother_phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>School District</span><strong>${esc(selectedFamily.school_district_name || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Parent Groups and Roles</h3></div>
	      <div class="table-wrap compact-table"><table>
	        <tr><th>Parent</th><th>Group</th><th>Role</th><th>Term Starts</th><th>Term Ends</th><th></th></tr>
	        ${['father', 'mother'].map((parentType) => {
	          const label = parentType === 'father' ? (selectedFamily.father_name || 'Father') : (selectedFamily.mother_name || 'Mother');
	          const rows = personRoles.filter((role) => role.person_type === parentType && asInt(role.person_id) === asInt(selectedFamily.id));
	          return rows.map((role) => `<tr>
	            <td>${esc(label)}</td>
	            <td>${esc(role.group_name)}</td>
	            <td>${role.is_assistant ? 'Assistant ' : ''}${esc(role.role_name)}</td>
	            <td>${esc(role.term_start || '') || '&mdash;'}</td>
	            <td>${esc(role.term_end || '') || '&mdash;'}</td>
	            <td>
	              <form method="post" action="/person-roles" style="margin:0">
	                ${csrfInput(csrfToken)}
	                <input type="hidden" name="action" value="delete" />
	                <input type="hidden" name="roleAssignmentId" value="${role.id}" />
	                <input type="hidden" name="redirectTo" value="${esc(`/setup?section=families&familyId=${selectedFamily.id}`)}" />
	                <button class="secondary-btn compact-action" type="submit">Remove</button>
	              </form>
	            </td>
	          </tr>`).join('');
	        }).join('') || `<tr><td colspan="6">${emptyState('No parent roles assigned yet.')}</td></tr>`}
	      </table></div>
	      <div class="inline-actions">
	        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-father-role">Add Father Role</a>
	        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-mother-role">Add Mother Role</a>
	      </div>
	      ${(action === 'add-father-role' || action === 'add-mother-role') ? `<div class="subhead"><h3>${action === 'add-father-role' ? 'Add Father Role' : 'Add Mother Role'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${roleAssignmentForm({ csrfToken, redirectTo: `/setup?section=families&familyId=${selectedFamily.id}`, personType: action === 'add-father-role' ? 'father' : 'mother', personId: selectedFamily.id, roleGroups, roleTypes })}` : ''}
	      <div class="subhead"><h3>Children</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
      <div class="child-list">
        ${selectedChildren.map((student) => `<div class="child-row">
          <div class="child-row-main">
            <div class="child-name-line">${genderIcon(student.gender)}<b>${esc(studentDisplayName(student))}</b></div>
            <span>${student.birth_date ? `Birthday ${esc(student.birth_date)} / ` : ''}Grade ${esc(student.grade_level || 'not enrolled')}${student.classroom_name ? ` / ${esc(student.classroom_name)}` : ''}</span>
          </div>
          <a class="text-action" href="/setup?section=families&familyId=${selectedFamily.id}&studentId=${student.id}&action=edit-child">Edit</a>
        </div>`).join('') || emptyState('No children are listed for this family yet.')}
      </div>
      ${(action === 'add-child' || childEdit) ? `<div class="subhead"><h3>${childEdit ? 'Edit Child' : 'Add Child'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${childForm}` : ''}
      <div class="subhead"><h3>Emergency Contacts</h3><a class="page-action compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-emergency">Add Contact</a></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Priority</th><th>Name</th><th>Relationship</th><th>Number</th><th>Notes</th><th></th></tr>
        ${emergencyContacts.map((contact) => `<tr>
          <td>${esc(contact.priority)}</td>
          <td>${esc(contact.name)}</td>
          <td>${esc(contact.relationship || '') || '&mdash;'}</td>
          <td>${esc(contact.phone || '') || '&mdash;'}</td>
          <td>${esc(contact.notes || '') || '&mdash;'}</td>
          <td><a class="text-action" href="/setup?section=families&familyId=${selectedFamily.id}&contactId=${contact.id}&action=edit-emergency">Edit</a></td>
        </tr>`).join('') || `<tr><td colspan="6">${emptyState('No emergency contacts listed yet.')}</td></tr>`}
      </table></div>
      ${(action === 'add-emergency' || emergencyEdit) ? `<div class="subhead"><h3>${emergencyEdit ? 'Edit Emergency Contact' : 'Add Emergency Contact'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>
        <form method="post" action="/emergency-contacts" class="form-grid two">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="familyId" value="${selectedFamily.id}" />
          ${emergencyEdit ? `<input type="hidden" name="contactId" value="${emergencyEdit.id}" />` : ''}
          <label>Priority<input type="number" name="priority" min="1" max="20" value="${esc(emergencyEdit?.priority || emergencyContacts.length + 1 || 1)}" required /></label>
          <label>Name<input name="name" required maxlength="120" value="${esc(emergencyEdit?.name || '')}" /></label>
          <label>Relationship<input name="relationship" maxlength="80" value="${esc(emergencyEdit?.relationship || '')}" /></label>
          <label>Number<input name="phone" inputmode="tel" maxlength="40" value="${esc(emergencyEdit?.phone || '')}" /></label>
          <label>Notes<textarea name="notes" maxlength="400">${esc(emergencyEdit?.notes || '')}</textarea></label>
          <button type="submit">${emergencyEdit ? 'Save Contact' : 'Add Contact'}</button>
        </form>` : ''}
    </div>
  </section>` : familyForm;
  const familiesModule = `<div class="family-module-grid">
    ${familyList}
    ${showFamilyForm ? familyForm : familyDetail}
  </div>`;

  const districtEdit = districts.find((district) => district.id === asInt(url.searchParams.get('districtId')));
  const districtForm = `<form method="post" action="/school-districts" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${districtEdit ? `<input type="hidden" name="districtId" value="${districtEdit.id}" />` : ''}
    <label>District Name<input name="name" required maxlength="140" value="${esc(districtEdit?.name || '')}" /></label>
    <button type="submit">${districtEdit ? 'Save District' : 'Add District'}</button>
  </form>`;
  const districtsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>School Districts</h2>
      <div class="module-actions"><span class="family-count">${districts.length}</span><a class="page-action compact-action" href="/setup?section=districts&action=add-district">Add District</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-district' || districtEdit) ? `<div class="subhead"><h3>${districtEdit ? 'Edit District' : 'Add District'}</h3><a class="secondary-btn compact-action" href="/setup?section=districts">Cancel</a></div>${districtForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>District</th><th>Families</th><th></th></tr>
        ${districts.map((district) => {
          const count = families.filter((family) => asInt(family.school_district_id) === asInt(district.id)).length;
          return `<tr><td>${esc(district.name)}</td><td>${count}</td><td><a class="text-action" href="/setup?section=districts&districtId=${district.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No school districts yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const selectedTeacherId = asInt(url.searchParams.get('teacherId'));
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId) || teachers[0] || null;
  const teacherEdit = action === 'edit-teacher' ? selectedTeacher : null;
  const showTeacherForm = action === 'add-teacher' || action === 'edit-teacher' || teachers.length === 0;
  const teacherForm = `<form method="post" action="/teachers" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${teacherEdit ? `<input type="hidden" name="teacherId" value="${teacherEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(teacherEdit?.name || '')}" /></label>
    <label>Email Address<input name="email" type="email" maxlength="160" value="${esc(teacherEdit?.email || '')}" /></label>
    <label>Mobile Number<input name="mobilePhone" inputmode="tel" maxlength="40" value="${esc(teacherEdit?.mobile_phone || teacherEdit?.phone || '')}" /></label>
    <label>Address<input name="address" maxlength="220" value="${esc(teacherEdit?.address || '')}" /></label>
    <button type="submit">${teacherEdit ? 'Save Changes' : 'Save Teacher'}</button>
  </form>`;
  const teacherList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Teachers</h2>
      <div class="module-actions"><span class="family-count">${teachers.length}</span><a class="page-action compact-action" href="/setup?section=teachers&action=add-teacher">Add Teacher</a></div>
    </div>
    ${teachers.map((teacher) => `<a class="family-link ${selectedTeacher?.id === teacher.id && !showTeacherForm ? 'active' : ''}" href="/setup?section=teachers&teacherId=${teacher.id}">
      <strong>${esc(teacher.name)}</strong>
      <span>${esc([teacher.mobile_phone || teacher.phone, teacher.email].filter(Boolean).join(' / ')) || 'No contact details'}</span>
    </a>`).join('') || `<div style="padding:.9rem">${emptyState('No teachers yet.')}</div>`}
  </section>`;
  const teacherDetail = selectedTeacher ? `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${esc(selectedTeacher.name)}</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}&action=edit-teacher">Edit</a>
        <a class="page-action compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}&action=add-role">Add Role</a>
      </div>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Mobile Number</span><strong>${esc(selectedTeacher.mobile_phone || selectedTeacher.phone || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Email Address</span><strong>${esc(selectedTeacher.email || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Address</span><strong>${esc(selectedTeacher.address || '') || '&mdash;'}</strong></div>
      </div>
      <div class="subhead"><h3>Groups and Roles</h3><span class="family-count">${roleAssignmentRows(personRoles, 'teacher', selectedTeacher.id, csrfToken, `/setup?section=teachers&teacherId=${selectedTeacher.id}`).split('<tr>').length - 1}</span></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Group</th><th>Role</th><th>Term Starts</th><th>Term Ends</th><th></th></tr>
        ${roleAssignmentRows(personRoles, 'teacher', selectedTeacher.id, csrfToken, `/setup?section=teachers&teacherId=${selectedTeacher.id}`) || `<tr><td colspan="5">${emptyState('No roles assigned yet.')}</td></tr>`}
      </table></div>
      ${action === 'add-role' ? `<div class="subhead"><h3>Add Role</h3><a class="secondary-btn compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}">Cancel</a></div>${roleAssignmentForm({ csrfToken, redirectTo: `/setup?section=teachers&teacherId=${selectedTeacher.id}`, personType: 'teacher', personId: selectedTeacher.id, roleGroups, roleTypes })}` : ''}
    </div>
  </section>` : `<section class="family-detail"><div class="family-detail-body">${emptyState('Add a teacher to begin.')}</div></section>`;
  const teachersModule = `<div class="family-module-grid">
    ${teacherList}
    ${showTeacherForm ? `<section class="family-detail"><div class="family-detail-head"><h2>${teacherEdit ? 'Edit Teacher' : 'Add Teacher'}</h2><a class="secondary-btn compact-action" href="/setup?section=teachers${selectedTeacher ? `&teacherId=${selectedTeacher.id}` : ''}">Cancel</a></div><div class="family-detail-body">${teacherForm}</div></section>` : teacherDetail}
  </div>`;

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
  const subjectAssignedGrades = subjectEdit ? gradeSubjects.filter((row) => row.subject_id === subjectEdit.id).map((row) => row.grade_level) : [];
  const subjectGradeChecks = `<div class="grade-checkbox-grid">
    ${gradeChoices().filter((grade) => grade !== 'Graduated').map((grade) => `<label class="grade-checkbox"><input type="checkbox" name="grades" value="${esc(grade)}" ${subjectAssignedGrades.includes(grade) ? 'checked' : ''} /> ${esc(grade)}</label>`).join('')}
  </div>`;
  const subjectForm = `<form method="post" action="/subjects" class="form-grid">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${subjectEdit ? `<input type="hidden" name="subjectId" value="${subjectEdit.id}" />` : ''}
    <label>Subject Name<input name="name" required maxlength="120" value="${esc(subjectEdit?.name || '')}" /></label>
    <label>Grades using this subject${subjectGradeChecks}</label>
    <button type="submit">${subjectEdit ? 'Save Changes' : 'Save Subject'}</button>
  </form>`;
  const subjectsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Subjects</h2>
      <div class="module-actions">
        <a class="page-action compact-action" href="/setup?section=subjects&action=add-subject">Add Subject</a>
      </div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-subject' || subjectEdit) ? `<div class="subhead"><h3>${subjectEdit ? 'Edit Subject' : 'Add Subject'}</h3><a class="secondary-btn compact-action" href="/setup?section=subjects">Cancel</a></div>${subjectForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Subject</th><th>Grades</th><th></th></tr>
        ${subjects.map((subject) => {
          const assigned = sortGrades(gradeSubjects.filter((row) => row.subject_id === subject.id).map((row) => row.grade_level));
          return `<tr><td>${esc(subject.name)}</td><td>${assigned.map((grade) => `<span class="badge">${esc(grade)}</span>`).join('') || '&mdash;'}</td><td><a class="text-action" href="/setup?section=subjects&subjectId=${subject.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No subjects yet.')}</td></tr>`}
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
  const periodForm = `<form method="post" action="/marking-periods" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    <label>School Days<input type="number" name="schoolDays" min="1" max="260" value="${asInt(selectedYear.school_days) || 180}" /></label>
    <label>Marking Periods<input type="number" name="periodCount" min="1" max="12" value="${markingPeriods.length || 6}" /></label>
    <label>Term Starts<input type="date" name="startDate" value="${esc(selectedYear.start_date || '')}" /></label>
    <label>Term Ends<input type="date" name="endDate" value="${esc(selectedYear.end_date || '')}" /></label>
    <label><input type="checkbox" name="autoCalculate" value="1" checked /> Auto Calculate Marking Period Dates</label>
    <button type="submit">Save Marking Periods</button>
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
      <div class="subhead"><h3>Marking Periods</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
      ${periodForm}
      <div class="table-wrap compact-table"><table>
        <tr><th>Period</th><th>Start</th><th>End</th></tr>
        ${markingPeriods.map((period) => `<tr><td>${esc(period.name)}</td><td>${esc(period.start_date || '') || '&mdash;'}</td><td>${esc(period.end_date || '') || '&mdash;'}</td></tr>`).join('') || `<tr><td colspan="3">${emptyState('No marking periods set yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const weightEdit = weightGroups.find((group) => group.id === asInt(url.searchParams.get('weightGroupId')));
  const weightsForForm = Object.fromEntries(weightItems.filter((item) => item.group_id === weightEdit?.id).map((item) => [normalizeCategory(item.category), item.weight]));
  const weightForm = `<form method="post" action="/grade-weights" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${weightEdit ? `<input type="hidden" name="weightGroupId" value="${weightEdit.id}" />` : ''}
    <label>Group Name<input name="name" required maxlength="120" value="${esc(weightEdit?.name || '')}" placeholder="Grades 1-2" /></label>
    <label>Subject<select name="subjectId"><option value="">Any subject</option>${subjectOptions(weightEdit?.subject_id || '')}</select></label>
    <label>Minimum Grade<select name="minGrade">${gradeOptions(weightEdit?.min_grade || '1')}</select></label>
    <label>Maximum Grade<select name="maxGrade">${gradeOptions(weightEdit?.max_grade || '2')}</select></label>
    <label>Rounding Mode<select name="roundingMode"><option value="nearest" ${selectedAttr(weightEdit?.rounding_mode || 'nearest', 'nearest')}>Nearest whole percent</option><option value="round-up" ${selectedAttr(weightEdit?.rounding_mode, 'round-up')}>.5 Round Up</option></select></label>
    <label>Calculation Mode<select name="calculationMode"><option value="weighted" ${selectedAttr(weightEdit?.calculation_mode || 'weighted', 'weighted')}>Weighted</option><option value="straight" ${selectedAttr(weightEdit?.calculation_mode, 'straight')}>Straight Average</option></select></label>
    ${CATEGORIES.map((category) => `<label>${esc(category)} Weight<input type="number" name="weight_${esc(category)}" min="0" max="100" step="1" value="${esc(weightsForForm[category] ?? '')}" /></label>`).join('')}
    <button type="submit">${weightEdit ? 'Save Weight Group' : 'Create Weight Group'}</button>
  </form>`;
  const weightsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Grade Weights</h2>
      <div class="module-actions"><span class="family-count">${weightGroups.length}</span><a class="page-action compact-action" href="/setup?section=weights&action=add-weight">Add Weight Group</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-weight' || weightEdit) ? `<div class="subhead"><h3>${weightEdit ? 'Edit Weight Group' : 'Add Weight Group'}</h3><a class="secondary-btn compact-action" href="/setup?section=weights">Cancel</a></div>${weightForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Group</th><th>Grades</th><th>Subject</th><th>Weights</th><th></th></tr>
        ${weightGroups.map((group) => {
          const items = weightItems.filter((item) => item.group_id === group.id);
          return `<tr><td>${esc(group.name)}</td><td>${esc(group.min_grade)}-${esc(group.max_grade)}</td><td>${esc(group.subject_name || 'Any')}</td><td>${items.map((item) => `<span class="badge">${displayCategory(item.category)} ${Number(item.weight)}%</span>`).join('')}</td><td><a class="text-action" href="/setup?section=weights&weightGroupId=${group.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="5">${emptyState('No grade weights yet.')}</td></tr>`}
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
    districts: districtsModule,
    teachers: teachersModule,
    classrooms: classroomsModule,
    subjects: subjectsModule,
    years: yearsModule,
    weights: weightsModule,
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
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const selectedPeriod = selectedPeriodFromRequest(req, url, periods);
  const selectedPeriodId = asInt(selectedPeriod?.id);
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
  const selectedAssignmentId = asInt(url.searchParams.get('assignmentId'));
  const scoreMode = cleanScoreMode(url.searchParams.get('mode'));
  const allGrades = sortGrades([
    ...querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=${yearId};`).map((row) => row.grade_level),
    ...querySql(`SELECT grade_level FROM os_grade_subjects WHERE school_year_id=${yearId};`).map((row) => row.grade_level)
  ]);
  const subjects = selectedGrade
    ? querySql(`SELECT s.id, s.name FROM os_grade_subjects gs JOIN os_subjects s ON s.id=gs.subject_id WHERE gs.school_year_id=${yearId} AND gs.grade_level=${sqlValue(selectedGrade)} ORDER BY s.name;`)
    : querySql('SELECT id, name FROM os_subjects ORDER BY name;');
  const subject = subjects.find((row) => row.id === selectedSubjectId);
  const allowed = !selectedGrade || teacherAllowedForSelection(user, yearId, selectedGrade, 0);
  const teacherStudentClause = user.role === ROLE_TEACHER ? `AND sy.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${asInt(user.teacher_id)} AND school_year_id=${yearId})` : '';
  const students = selectedGrade && allowed ? querySql(`SELECT st.id, st.first_name, st.last_name
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=${yearId}
        AND sy.grade_level=${sqlValue(selectedGrade)}
        AND sy.status='enrolled'
        ${teacherStudentClause}
      ORDER BY st.last_name, st.first_name;`) : [];
  const assignments = selectedGrade && selectedSubjectId ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
      COUNT(sc.id) AS score_count,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
    FROM os_assignments a
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(selectedGrade)}
      AND a.subject_id=${selectedSubjectId}
      ${assignmentPeriodClause(selectedPeriod)}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC
    LIMIT 24;`) : [];
  const selectedAssignment = selectedAssignmentId
    ? (assignments.find((a) => a.id === selectedAssignmentId) || querySql(`SELECT id, title, category, assignment_date, max_score FROM os_assignments WHERE id=${selectedAssignmentId} AND school_year_id=${yearId} LIMIT 1;`)[0])
    : null;
  const existingScores = selectedAssignment ? Object.fromEntries(
    querySql(`SELECT student_id, score FROM os_scores WHERE assignment_id=${selectedAssignment.id};`).map((r) => [r.student_id, r.score])
  ) : {};

  const periodParam = selectedPeriodId ? `&markingPeriodId=${selectedPeriodId}` : '';
  const baseParams = `yearId=${yearId}${periodParam}${selectedGrade ? `&grade=${encodeURIComponent(selectedGrade)}` : ''}${selectedSubjectId ? `&subjectId=${selectedSubjectId}` : ''}&mode=${scoreMode}`;
  const periodSelect = `<select name="markingPeriodId" required data-auto-submit>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.period_number)}</option>`).join('')}</select>`;
  const gradeSelect = `<select name="grade" required data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
  const subjectSelect = `<select name="subjectId" required data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const percentUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=percent')}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}`;
  const wrongUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=wrong')}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}`;
  const scoreModeControl = scoreModeToggle(percentUrl, wrongUrl, scoreMode);
  const averageData = selectedGrade && selectedSubjectId && selectedPeriod
    ? periodAverageRows(yearId, selectedGrade, selectedSubjectId, students.map((student) => student.id), selectedPeriod)
    : { classAverage: null, studentAverages: new Map() };
  const classAverageBlock = selectedGrade && selectedSubjectId && selectedPeriod
    ? `<div class="class-average-callout"><span>Class average</span><b>${formatPercent(averageData.classAverage)}</b></div>`
    : '';

  // Score entry panel
  let scoreContent = '';
  if (!allowed) {
    scoreContent = emptyState('This grade is not assigned to your teacher account.');
  } else if (!selectedGrade || !selectedSubjectId) {
    scoreContent = emptyState('Select a grade and subject to begin.');
  } else {
    const assignmentPicker = `<label class="assignment-picker">Assignment<select name="assignmentId" data-assignment-select data-base-url="/gradebook?${baseParams}">
      <option value="">— New assignment —</option>
      ${assignments.map((a) => `<option value="${a.id}" ${a.id === selectedAssignmentId ? 'selected' : ''}>${esc(a.title)} · ${compactNumber(a.max_score)} pts${a.assignment_date ? ` · ${esc(a.assignment_date)}` : ''}</option>`).join('')}
    </select></label>`;

    const today = new Date().toISOString().slice(0, 10);
    const defaultAssignmentDate = selectedPeriod?.start_date && selectedPeriod.start_date > today ? selectedPeriod.start_date : today;
    const newFields = !selectedAssignment ? `<div class="form-grid four">
      <label>Title<input name="title" placeholder="Lesson 24" required maxlength="140" /></label>
      <label>Type<select name="category">${categoryOptions()}</select></label>
      <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
      <label>Date<input type="date" name="assignmentDate" value="${defaultAssignmentDate}" /></label>
    </div>` : '';

    const maxScore = asPoints(selectedAssignment?.max_score);
    const scoreRows = students.map((st) => {
      const existing = existingScores[st.id];
      const val = scoreValueForMode(existing, maxScore, scoreMode);
      const studentAverage = averageData.studentAverages.get(st.id);
      return `<div class="score-row">
        <div class="score-student-label"><b>${esc(`${st.last_name}, ${st.first_name}`)}</b><span class="student-period-avg">${formatPercent(studentAverage)}</span></div>
        ${scoreInputControl(st.id, val, maxScore, scoreMode)}
      </div>`;
    }).join('') || emptyState('No enrolled students found for this grade.');

    scoreContent = `<form method="post" action="/gradebook" class="form-grid">
      ${csrfInput(csrfToken)}
      <input type="hidden" name="schoolYearId" value="${yearId}" />
      <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
      <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
      <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
      <input type="hidden" name="scoreMode" value="${scoreMode}" />
      ${assignmentPicker}
      ${newFields}
      ${scoreModeControl}
      <p class="score-help">${scoreMode === 'percent' ? 'Enter each student score as a percentage.' : `Enter how many points were marked wrong${selectedAssignment ? ` out of ${compactNumber(maxScore)}` : ''}.`}</p>
      <div class="score-sheet">${scoreRows}</div>
      <button class="score-save-btn" type="submit">Save Scores</button>
    </form>`;
  }

  const panelMeta = subject ? `Grade ${esc(selectedGrade)} - ${esc(subject.name)}` : '';

  const historyRows = assignments.map((a) => {
    const active = a.id === selectedAssignmentId;
    return `<tr class="${active ? 'selected-row' : ''}">
      <td>${esc(a.assignment_date || '') || '&mdash;'}</td>
      <td>${esc(a.title)}</td>
      <td><span class="type-chip">${displayCategoryShort(a.category)}</span></td>
      <td>${compactNumber(a.max_score)}</td>
      <td>${a.score_count}</td>
      <td><span class="badge ${gradeTone(a.avg_score)}">${formatPercent(a.avg_score)}</span></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">${emptyState('No assignment history for this selection yet.')}</td></tr>`;

  return `<div class="workspace">
    ${schoolYearHead('Gradebook', 'Choose a grade and subject, pick or create an assignment, then enter scores.', selectedYear)}
    <section class="panel">
      <form method="get" action="/gradebook" class="filters compact-filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <input type="hidden" name="mode" value="${scoreMode}" />
        <label>Period${periodSelect}</label>
        <label>Grade${gradeSelect}</label>
        <label>Subject${subjectSelect}</label>
        ${classAverageBlock}
      </form>
    </section>
    <div class="split gradebook-split">
      <section class="panel">
        <div class="panel-title inline-title"><h2>Enter Scores</h2>${panelMeta ? `<span>- ${panelMeta}</span>` : ''}</div>
        ${scoreContent}
      </section>
      <section class="ledger">
        <div class="ledger-head"><h2>Assignment History</h2><p>Recent entries for the loaded grade and subject.</p></div>
        <div class="table-wrap compact-table"><table class="assignment-history-table">
          <tr><th>Date</th><th>Assignment</th><th>Type</th><th>Points</th><th>Scores</th><th>Avg</th></tr>
          ${historyRows}
        </table></div>
      </section>
    </div>
  </div>`;
}

function assignmentsPage(req, url, user, selectedYear, csrfToken) {
  const yearId = asInt(selectedYear.id);
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
  const selectedAssignmentId = asInt(url.searchParams.get('assignmentId'));
  const scoreMode = cleanScoreMode(url.searchParams.get('mode'));
  const showAdd = !selectedAssignmentId || url.searchParams.get('action') === 'add';

  const allGrades = sortGrades([
    ...querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=${yearId};`).map((r) => r.grade_level),
    ...querySql(`SELECT grade_level FROM os_grade_subjects WHERE school_year_id=${yearId};`).map((r) => r.grade_level)
  ]);
  const subjects = selectedGrade
    ? querySql(`SELECT s.id, s.name FROM os_grade_subjects gs JOIN os_subjects s ON s.id=gs.subject_id WHERE gs.school_year_id=${yearId} AND gs.grade_level=${sqlValue(selectedGrade)} ORDER BY s.name;`)
    : querySql('SELECT id, name FROM os_subjects ORDER BY name;');
  const subject = subjects.find((s) => s.id === selectedSubjectId);

  const assignments = selectedGrade && selectedSubjectId ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
      COUNT(sc.id) AS score_count,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
    FROM os_assignments a
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(selectedGrade)}
      AND a.subject_id=${selectedSubjectId}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC;`) : [];

  const selectedAssignment = selectedAssignmentId && !showAdd
    ? (assignments.find((a) => a.id === selectedAssignmentId) || querySql(`SELECT id, title, category, assignment_date, max_score FROM os_assignments WHERE id=${selectedAssignmentId} AND school_year_id=${yearId} LIMIT 1;`)[0])
    : null;

  const teacherStudentClause = user.role === ROLE_TEACHER ? `AND sy.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${asInt(user.teacher_id)} AND school_year_id=${yearId})` : '';
  const students = selectedGrade ? querySql(`SELECT st.id, st.first_name, st.last_name
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId}
      AND sy.grade_level=${sqlValue(selectedGrade)}
      AND sy.status='enrolled'
      ${teacherStudentClause}
    ORDER BY st.last_name, st.first_name;`) : [];

  const existingScores = selectedAssignment ? Object.fromEntries(
    querySql(`SELECT student_id, score FROM os_scores WHERE assignment_id=${selectedAssignment.id};`).map((r) => [r.student_id, r.score])
  ) : {};

  const baseParams = `yearId=${yearId}${selectedGrade ? `&grade=${encodeURIComponent(selectedGrade)}` : ''}${selectedSubjectId ? `&subjectId=${selectedSubjectId}` : ''}&mode=${scoreMode}`;
  const gradeSelect = `<select name="grade" data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
  const subjectSelect = `<select name="subjectId" data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const modeBaseParams = baseParams.replace(`mode=${scoreMode}`, 'mode=');

  const assignmentList = assignments.length > 0
    ? assignments.map((a) => {
        const active = !showAdd && a.id === selectedAssignmentId;
        return `<a class="family-link asgn-link ${active ? 'active' : ''}" href="/assignments?${baseParams}&assignmentId=${a.id}">
          <span class="asgn-title">${esc(a.title)}</span>
          <span class="asgn-meta">${displayCategoryShort(a.category)} &middot; ${esc(a.assignment_date || '—')}</span>
          <span class="badge ${gradeTone(a.avg_score)}">${formatPercent(a.avg_score)}</span>
        </a>`;
      }).join('')
    : `<div style="padding:.9rem">${emptyState(selectedGrade && selectedSubjectId ? 'No assignments yet.' : 'Select a grade and subject.')}</div>`;

  let rightPanel = '';
  if (selectedAssignment) {
    const maxScore = asPoints(selectedAssignment.max_score);
    const scoreModeControl = scoreModeToggle(
      `/assignments?${modeBaseParams}percent&assignmentId=${selectedAssignment.id}`,
      `/assignments?${modeBaseParams}wrong&assignmentId=${selectedAssignment.id}`,
      scoreMode
    );
    const scoreRows = students.map((st) => {
      const existing = existingScores[st.id];
      const val = scoreValueForMode(existing, maxScore, scoreMode);
      return `<div class="score-row">
        <div><b>${esc(`${st.last_name}, ${st.first_name}`)}</b></div>
        ${scoreInputControl(st.id, val, maxScore, scoreMode)}
      </div>`;
    }).join('') || emptyState('No enrolled students in this grade.');

    rightPanel = `<section class="family-detail assignment-editor">
      <div class="family-detail-head">
        <h2>${esc(selectedAssignment.title)}</h2>
        <a class="secondary-btn compact-action" href="/assignments?${baseParams}&action=add">+ New</a>
      </div>
      <div class="family-detail-body">
        <form method="post" action="/assignments" class="form-grid" style="margin-bottom:1.25rem">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="action" value="update" />
          <input type="hidden" name="assignmentId" value="${selectedAssignment.id}" />
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
          <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
          <div class="form-grid four">
            <label>Title<input name="title" value="${esc(selectedAssignment.title)}" required maxlength="140" /></label>
            <label>Type<select name="category">${categoryOptions(selectedAssignment.category)}</select></label>
            <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="${compactNumber(maxScore)}" required /></label>
            <label>Date<input type="date" name="assignmentDate" value="${esc(selectedAssignment.assignment_date || '')}" /></label>
          </div>
          <button type="submit">Save Details</button>
        </form>
        <div style="border-top:1px solid var(--line);padding-top:1.1rem">
          <p style="margin:0 0 .75rem;font-size:.9rem;font-weight:720">Student Scores</p>
          <form method="post" action="/assignments" class="form-grid">
            ${csrfInput(csrfToken)}
            <input type="hidden" name="action" value="scores" />
            <input type="hidden" name="assignmentId" value="${selectedAssignment.id}" />
            <input type="hidden" name="schoolYearId" value="${yearId}" />
            <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
            <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
            <input type="hidden" name="scoreMode" value="${scoreMode}" />
            ${scoreModeControl}
            <p class="score-help">${scoreMode === 'percent' ? 'Enter each student score as a percentage.' : `Enter how many points were marked wrong out of ${compactNumber(maxScore)}.`}</p>
            <div class="score-sheet">${scoreRows}</div>
            <button type="submit">Save Scores</button>
          </form>
        </div>
      </div>
    </section>`;
  } else {
    const placeholder = subject ? `e.g. Lesson 24 – ${subject.name}` : 'e.g. Lesson 24';
    rightPanel = `<section class="family-detail assignment-editor">
      <div class="family-detail-head"><h2>Add Assignment</h2></div>
      <div class="family-detail-body">
        ${selectedGrade && selectedSubjectId ? `<form method="post" action="/assignments" class="form-grid">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="action" value="add" />
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
          <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
          <label>Title<input name="title" placeholder="${esc(placeholder)}" required maxlength="140" /></label>
          <label>Type<select name="category">${categoryOptions()}</select></label>
          <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
          <label>Date<input type="date" name="assignmentDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <button type="submit">Add Assignment</button>
        </form>` : `<p class="empty">Select a grade and subject to add an assignment.</p>`}
      </div>
    </section>`;
  }

  return `<div class="workspace">
    ${schoolYearHead('Assignments', 'Create and edit assignments for a grade and subject.', selectedYear)}
    <section class="panel">
      <form method="get" action="/assignments" class="filters compact-filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <input type="hidden" name="mode" value="${scoreMode}" />
        <label>Grade${gradeSelect}</label>
        <label>Subject${subjectSelect}</label>
      </form>
    </section>
    <div class="assignments-layout">
      <section class="family-list">
        <div class="family-list-head">
          <h2>Assignments</h2>
          <div class="module-actions"><span class="family-count">${assignments.length}</span></div>
        </div>
        ${assignmentList}
      </section>
      ${rightPanel}
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

function reportLetter(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '';
  if (score >= 94) return 'A';
  if (score >= 86) return 'B';
  if (score >= 76) return 'C';
  if (score >= 70) return 'D';
  if (score >= 63) return 'E';
  return 'F';
}

function matchingWeightGroup(groups, grade, subjectId) {
  const rank = gradeRank(grade);
  return groups.find((group) => group.subject_id === subjectId && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || groups.find((group) => !group.subject_id && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || null;
}

function calculateWeightedAverage(scores, group, allItems) {
  const percentages = scores.map((row) => Number(row.percent)).filter(Number.isFinite);
  if (!percentages.length) return { average: null, breakdown: [] };
  const straight = average(percentages);
  if (!group || group.calculation_mode === 'straight') return { average: Math.round(straight), breakdown: [] };
  const items = allItems.filter((item) => item.group_id === group.id);
  let weightedTotal = 0;
  let usedWeight = 0;
  const breakdown = [];
  items.forEach((item) => {
    const categoryScores = scores.filter((row) => normalizeCategory(row.category) === normalizeCategory(item.category)).map((row) => Number(row.percent)).filter(Number.isFinite);
    if (!categoryScores.length) return;
    const categoryAverage = average(categoryScores);
    const weight = Number(item.weight) || 0;
    weightedTotal += categoryAverage * weight;
    usedWeight += weight;
    breakdown.push(`${normalizeCategory(item.category)} ${Math.round(categoryAverage)}% x ${weight}%`);
  });
  if (!usedWeight) return { average: Math.round(straight), breakdown: [] };
  const raw = weightedTotal / usedWeight;
  return { average: group.rounding_mode === 'round-up' ? Math.floor(raw + 0.5) : Math.round(raw), breakdown };
}

function absenceUnitsToDays(row) {
  const amount = Number(row.amount) || 0;
  return row.unit === 'hours' ? amount / 6 : amount;
}

function periodAbsenceTotal(rows, period) {
  return rows.filter((row) => {
    if (!period.start_date || !period.end_date) return false;
    return row.absence_date >= period.start_date && row.absence_date <= period.end_date;
  }).reduce((sum, row) => sum + absenceUnitsToDays(row), 0);
}

function formatAbsence(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
}

function reportCardBooksSvg() {
  return `<svg class="book-mark" viewBox="0 0 160 112" aria-hidden="true">
    <g fill="none" stroke="#2d6a60" stroke-width="2">
      <path d="M35 86 51 34l18 5-15 52z" fill="#e9f0ed"/>
      <path d="M55 88V28h17v60z" fill="#d7e4df"/>
      <path d="M76 89V22h16v67z" fill="#edf4f1"/>
      <path d="M96 86V30h17v56z" fill="#d7e4df"/>
      <path d="M118 85V38h15v47z" fill="#edf4f1"/>
      <path d="M28 91h112" />
      <path d="M58 39h10M58 47h10M99 42h10M121 50h9" />
      <circle cx="84" cy="49" r="4" fill="#9fb5ae"/>
      <circle cx="126" cy="60" r="4" fill="#9fb5ae"/>
    </g>
  </svg>`;
}

function rowInPeriod(row, period) {
  if (!period) return true;
  if (asInt(row.marking_period_id) === asInt(period.id)) return true;
  if (!row.marking_period_id && period.start_date && period.end_date && row.assignment_date) {
    return row.assignment_date >= period.start_date && row.assignment_date <= period.end_date;
  }
  return false;
}

function assignmentPeriodClause(period) {
  if (!period) return '';
  const idClause = `a.marking_period_id=${asInt(period.id)}`;
  if (!period.start_date || !period.end_date) return `AND ${idClause}`;
  return `AND (${idClause} OR (a.marking_period_id IS NULL AND a.assignment_date >= ${sqlValue(period.start_date)} AND a.assignment_date <= ${sqlValue(period.end_date)}))`;
}

function selectedPeriodFromRequest(req, url, periods) {
  const requestedId = asInt(url.searchParams.get('markingPeriodId'));
  const cookieId = asInt(parseCookies(req).gradebookPeriodId);
  return periods.find((period) => period.id === requestedId)
    || periods.find((period) => period.id === cookieId)
    || periods[0]
    || null;
}

function periodAverageRows(yearId, grade, subjectId, studentIds, period) {
  if (!grade || !subjectId || !studentIds.length || !period) return { classAverage: null, studentAverages: new Map() };
  const scoreRows = querySql(`SELECT sc.student_id, a.category, a.assignment_date, a.marking_period_id,
      ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
    FROM os_scores sc
    JOIN os_assignments a ON a.id = sc.assignment_id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(grade)}
      AND a.subject_id=${subjectId}
      AND sc.student_id IN (${studentIds.map(asInt).join(',')});`);
  const weightGroups = querySql(`SELECT * FROM os_grade_weight_groups WHERE school_year_id=${yearId};`);
  const weightItems = querySql(`SELECT wi.* FROM os_grade_weight_items wi
    JOIN os_grade_weight_groups wg ON wg.id = wi.group_id
    WHERE wg.school_year_id=${yearId};`);
  const group = matchingWeightGroup(weightGroups, grade, subjectId);
  const studentAverages = new Map();
  studentIds.forEach((studentId) => {
    const rows = scoreRows.filter((row) => asInt(row.student_id) === asInt(studentId) && rowInPeriod(row, period));
    studentAverages.set(asInt(studentId), calculateWeightedAverage(rows, group, weightItems).average);
  });
  return {
    classAverage: average([...studentAverages.values()].filter((value) => value !== null && value !== undefined)),
    studentAverages
  };
}

function reportCardsPage(url, selectedYear) {
  const yearId = asInt(selectedYear.id);
  const settings = appSettings();
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedStudentId = asInt(url.searchParams.get('studentId'));
  const selectedPeriodId = asInt(url.searchParams.get('markingPeriodId'));
  const grades = sortGrades(querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=${yearId} AND status='enrolled';`).map((row) => row.grade_level));
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) || null;
  const students = selectedGrade ? querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' AND sy.grade_level=${sqlValue(selectedGrade)}
    ORDER BY st.last_name, st.first_name;`) : [];
  const selectedStudent = students.find((student) => student.id === selectedStudentId) || null;
  const subjects = selectedGrade ? querySql(`SELECT s.id, s.name
    FROM os_grade_subjects gs
    JOIN os_subjects s ON s.id = gs.subject_id
    WHERE gs.school_year_id=${yearId} AND gs.grade_level=${sqlValue(selectedGrade)}
    ORDER BY s.name;`) : [];
  const weightGroups = querySql(`SELECT * FROM os_grade_weight_groups WHERE school_year_id=${yearId};`);
  const weightItems = querySql(`SELECT wi.* FROM os_grade_weight_items wi
    JOIN os_grade_weight_groups wg ON wg.id = wi.group_id
    WHERE wg.school_year_id=${yearId};`);
  const scoreRows = selectedStudent ? querySql(`SELECT a.subject_id, s.name AS subject_name, a.category, a.assignment_date, a.marking_period_id,
      ROUND((sc.score / a.max_score) * 100, 1) AS percent
    FROM os_scores sc
    JOIN os_assignments a ON a.id = sc.assignment_id
    JOIN os_subjects s ON s.id = a.subject_id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(selectedGrade)}
      AND sc.student_id=${selectedStudent.id};`) : [];
  const absenceRows = selectedStudent ? querySql(`SELECT * FROM os_absences
    WHERE school_year_id=${yearId}
      AND student_id=${selectedStudent.id}
      AND kind='absence'
    ORDER BY absence_date;`) : [];
  const subjectRows = subjects.map((subject) => {
    const rows = scoreRows.filter((row) => row.subject_id === subject.id && rowInPeriod(row, selectedPeriod));
    const group = matchingWeightGroup(weightGroups, selectedGrade, subject.id);
    const result = calculateWeightedAverage(rows, group, weightItems);
    return {
      subject,
      average: result.average,
      breakdown: result.breakdown,
      groupName: group?.name || 'Straight average'
    };
  });
  const subjectPeriodRows = subjects.map((subject) => {
    const group = matchingWeightGroup(weightGroups, selectedGrade, subject.id);
    const periodScores = periods.map((period) => {
      const rows = scoreRows.filter((row) => row.subject_id === subject.id && rowInPeriod(row, period));
      return calculateWeightedAverage(rows, group, weightItems).average;
    });
    return { subject, periodScores };
  });
  const gradeSelect = `<select name="grade" data-auto-submit required><option value="">Grade</option>${grades.map((grade) => `<option value="${esc(grade)}" ${grade === selectedGrade ? 'selected' : ''}>${esc(grade)}</option>`).join('')}</select>`;
  const studentSelect = `<select name="studentId" required><option value="">Student</option>${students.map((student) => `<option value="${student.id}" ${student.id === selectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)}</option>`).join('')}</select>`;
  const periodSelect = `<select name="markingPeriodId" required><option value="">Marking Period</option>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.name)}</option>`).join('')}</select>`;
  const pdfFilename = selectedStudent && selectedPeriod
    ? `report-card-${selectedStudent.last_name}-${selectedStudent.first_name}-${selectedPeriod.name}.pdf`.replace(/[^a-z0-9._-]/gi, '-').toLowerCase()
    : 'report-card.pdf';
  const periodHeaders = periods.map((period) => `<th>${esc(period.period_number)}</th>`).join('');
  const subjectPeriodHeaders = `${periodHeaders}<th class="average-col">Avg</th>`;
  const conductSectionStarts = new Set([0, 5, 11, 19, 22]);
  const conductRows = Array.from({ length: 28 }, (_, index) => `<tr class="${conductSectionStarts.has(index) ? 'conduct-section-row' : ''}">${periods.map(() => '<td></td>').join('')}</tr>`).join('');
  const subjectTableRows = subjectPeriodRows.map((row) => {
    const scores = row.periodScores
      .filter((score) => score !== null && score !== undefined && score !== '')
      .map((score) => Number(score))
      .filter(Number.isFinite);
    const avg = scores.length ? Math.round(average(scores)) : null;
    return `<tr>${row.periodScores.map((score) => `<td>${score === null || score === undefined ? '' : Math.round(Number(score))}</td>`).join('')}<td class="average-col">${avg === null ? '' : avg}</td></tr>`;
  }).join('');
  const subjectLabels = subjectPeriodRows.map((row) => `<span>${esc(row.subject.name)}</span>`).join('') || '<span>No subjects</span>';
  const absenceByPeriod = periods.map((period) => periodAbsenceTotal(absenceRows, period));
  const absenceTotal = absenceByPeriod.reduce((sum, value) => sum + value, 0);
  const presentDays = Math.max(0, (asInt(selectedYear.school_days) || 180) - absenceTotal);
  const preview = selectedStudent && selectedPeriod ? `<div class="report-card-document">
    <section class="report-card-spread cover-spread">
      <div class="report-page parent-page">
        <p class="parent-note"><em>To the parent:</em></p>
        <p class="parent-note">Please sign your name to show that you have read this report and return the report to school promptly.</p>
        <div class="signature-line">Signature</div>
        <div class="generated-note">Generated by<br>Oakstead</div>
      </div>
      <div class="report-spine"></div>
      <div class="report-page cover-page">
        <img class="cover-leaf" src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
        <h2>Report Card</h2>
        <div class="cover-of">of</div>
        <div class="script-line">${esc(selectedStudent.first_name)} ${esc(selectedStudent.last_name)}</div>
        <div class="cover-meta">Grade <span class="blank-line">${esc(selectedGrade)}</span> <span>School Year ${esc(selectedYear.name)}</span></div>
        <div class="school-name-line">${esc(settings.schoolName)}</div>
        ${reportCardBooksSvg()}
        <div class="verse">"The fear of the Lord is the beginning<br>of wisdom." Psalm 111:10</div>
        <div class="parents-copy">
          <em>To the Parents:</em>
          <p>This report is to inform you of your child's performance in their studies and conduct at school. Please read it carefully and discuss it with your child.</p>
          <p>The school requests your support so that your child does their best at school. We invite you to visit school and observe your child at work. We also encourage you to discuss your child's progress with their teacher.</p>
          <p class="board-signoff">The School Board and Teachers</p>
        </div>
      </div>
    </section>
    <section class="report-card-spread inside-spread">
      <div>
        <div class="period-grid-wrap">
          <div class="subject-list"><strong>REPORT PERIODS</strong>${subjectLabels}</div>
          <table class="period-table">
            <tr>${subjectPeriodHeaders}</tr>
            ${subjectTableRows || `<tr>${periods.map(() => '<td></td>').join('')}<td class="average-col"></td></tr>`}
          </table>
        </div>
        <div class="key-subject">
          <h3>Key to Subject Grades</h3>
          <div class="key-row"><span>A</span><span>(94-100)</span><span>Excellent Work</span></div>
          <div class="key-row"><span>B</span><span>(86-93)</span><span>Good Work</span></div>
          <div class="key-row"><span>C</span><span>(76-85)</span><span>Fair Work</span></div>
          <div class="key-row"><span>D</span><span>(70-75)</span><span>Poor Work</span></div>
          <div class="key-row"><span>E</span><span>(63-69)</span><span>Failing Work--Needs Improvement to Pass</span></div>
          <div class="key-row"><span>F</span><span>(62 and below)</span><span>Failing Work--Needs Great Improvement to Pass</span></div>
        </div>
      </div>
      <div>
        <div class="conduct-panel">
          <div class="conduct-list">
            <h3>Conduct Grades</h3>
            <div class="conduct-section"><strong>Classroom Behaviour</strong><span>Avoids disturbing others</span><span>Has good posture</span><span>Pays attention in class</span><span>Speaks with good volume and enunciation</span></div>
            <div class="conduct-section"><strong>Interpersonal Relationships</strong><span>Is mannerly</span><span>Is thoughtful and gracious</span><span>Respects others' feelings</span><span>Respects others' property</span><span>Works and plays well with others</span></div>
            <div class="conduct-section"><strong>Spiritual & Moral Traits</strong><span>Accepts direction cheerfully</span><span>Is honest & trustworthy</span><span>Is respectful</span><span>Obeys school rules</span><span>Shows interest in spiritual matters</span><span>Shows self-control</span><span>Uses wholesome speech</span></div>
            <div class="conduct-section"><strong>Stewardship</strong><span>Cares for school property</span><span>Keeps desk and books tidy</span></div>
            <div class="conduct-section"><strong>Work Habits</strong><span>Enjoys study</span><span>Follows directions</span><span>Shows effort and perseverance</span><span>Stays current with assignments</span><span>Uses time well</span><span>Works carefully</span></div>
          </div>
          <table class="conduct-table"><tr>${periodHeaders}</tr>${conductRows}</table>
        </div>
        <div class="conduct-keys">
          <div><strong>Key to Conduct Grades<br>(and First Grades Subjects)</strong><br>S &nbsp;&nbsp; Satisfactory<br>N &nbsp;&nbsp; Needs Improvement<br>U &nbsp;&nbsp; Unsatisfactory</div>
          <div><strong>Key to Subheading Marks</strong><br>(+) &nbsp;&nbsp; Commendable<br>(no mark) &nbsp;&nbsp; Satisfactory<br>(-) &nbsp;&nbsp; Needs Improvement</div>
        </div>
        <div class="attendance">
          <div class="attendance-labels"><h3>ATTENDANCE</h3><div>Absence</div><strong>Total Days Present</strong></div>
          <table class="attendance-table">
            <tr>${periodHeaders}<th>Total</th></tr>
            <tr>${absenceByPeriod.map((value) => `<td>${formatAbsence(value)}</td>`).join('')}<td>${formatAbsence(absenceTotal)}</td></tr>
            <tr>${periods.map(() => '<td></td>').join('')}<td>${formatAbsence(presentDays)}</td></tr>
          </table>
        </div>
      </div>
    </section>
  </div>` : emptyState('Select a grade, student, and marking period to build a report card.');

  return `<div class="workspace">
    ${schoolYearHead('Report Cards', 'Generate printable report cards from marking periods and grade weights.', selectedYear)}
    <section class="panel">
      <form method="get" action="/report-cards" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <label>Grade${gradeSelect}</label>
        <label>Student${studentSelect}</label>
        <label>Marking Period${periodSelect}</label>
        <button type="submit">Load Report Card</button>
      </form>
    </section>
    ${selectedStudent && selectedPeriod ? `<div class="report-card-actions"><button type="button" class="page-action compact-action" data-filename="${esc(pdfFilename)}" onclick="generateReportCardPdf(this)">Generate PDF</button></div>` : ''}
    ${preview}
  </div>`;
}

function absencesPage(url, selectedYear, csrfToken) {
  const yearId = asInt(selectedYear.id);
  const action = cleanText(url.searchParams.get('action'), 40);
  const students = querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
    ORDER BY sy.grade_level, st.last_name, st.first_name;`);
  const absences = querySql(`SELECT a.*, st.first_name, st.last_name, sy.grade_level
    FROM os_absences a
    JOIN os_students st ON st.id = a.student_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id = a.school_year_id
    WHERE a.school_year_id=${yearId}
    ORDER BY a.absence_date DESC, st.last_name, st.first_name
    LIMIT 80;`);
  const studentOptions = students.map((student) => `<option value="${student.id}">${esc(student.last_name)}, ${esc(student.first_name)} - Grade ${esc(student.grade_level)}</option>`).join('');
  const addForm = `<section class="family-detail">
    <div class="family-detail-head"><h2>Add Absence</h2><a class="secondary-btn compact-action" href="/absences">Cancel</a></div>
    <div class="family-detail-body">
      <form method="post" action="/absences" class="form-grid two">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <label>Date<input type="date" name="absenceDate" required value="${new Date().toISOString().slice(0, 10)}" /></label>
        <label>Student<select name="studentId" required><option value="">Choose student</option>${studentOptions}</select></label>
        <label>Type<select name="kind"><option value="absence">Absence</option><option value="tardy">Tardy</option></select></label>
        <label>Amount<input type="number" name="amount" min="0" max="30" step="0.25" value="1" required /></label>
        <label>Unit<select name="unit"><option value="days">Days</option><option value="hours">Hours</option></select></label>
        <label>Notes<textarea name="notes" maxlength="400"></textarea></label>
        <button type="submit">Save Absence</button>
      </form>
    </div>
  </section>`;
  const list = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Absences</h2>
      <div class="module-actions"><span class="family-count">${absences.length}</span><a class="page-action compact-action" href="/absences?action=add">Add</a></div>
    </div>
    <div class="family-detail-body">
      <div class="table-wrap compact-table"><table>
        <tr><th>Date</th><th>Student</th><th>Type</th><th>Amount</th><th>Notes</th></tr>
        ${absences.map((row) => `<tr><td>${esc(row.absence_date)}</td><td>${esc(row.last_name)}, ${esc(row.first_name)}<br><small>Grade ${esc(row.grade_level || '')}</small></td><td>${esc(row.kind)}</td><td>${formatAbsence(row.amount)} ${esc(row.unit)}</td><td>${esc(row.notes || '') || '&mdash;'}</td></tr>`).join('') || `<tr><td colspan="5">${emptyState('No absences recorded for this school year.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;
  return `<div class="workspace">
    ${schoolYearHead('Absences', 'Record absences and tardies for report card attendance.', selectedYear)}
    ${action === 'add' ? addForm : list}
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

function formArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function roleAssignmentRows(roles, personType, personId, csrfToken, redirectTo) {
  const rows = roles.filter((role) => role.person_type === personType && asInt(role.person_id) === asInt(personId));
  return rows.map((role) => `<tr>
    <td>${esc(role.group_name)}</td>
    <td>${role.is_assistant ? 'Assistant ' : ''}${esc(role.role_name)}</td>
    <td>${esc(role.term_start || '') || '&mdash;'}</td>
    <td>${esc(role.term_end || '') || '&mdash;'}</td>
    <td>
      <form method="post" action="/person-roles" style="margin:0">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="action" value="delete" />
        <input type="hidden" name="roleAssignmentId" value="${role.id}" />
        <input type="hidden" name="redirectTo" value="${esc(redirectTo)}" />
        <button class="secondary-btn compact-action" type="submit">Remove</button>
      </form>
    </td>
  </tr>`).join('');
}

function roleOptionsByGroup(roleGroups, roleTypes, selected = '') {
  return roleGroups.map((group) => {
    const options = roleTypes
      .filter((role) => asInt(role.group_id) === asInt(group.id))
      .map((role) => `<option value="${role.id}" data-role-group="${group.id}" ${selectedAttr(role.id, selected)}>${esc(role.name)}</option>`)
      .join('');
    return `<optgroup label="${esc(group.name)}">${options}</optgroup>`;
  }).join('');
}

function roleAssignmentForm({ csrfToken, redirectTo, personType, personId, roleGroups, roleTypes }) {
  return `<form method="post" action="/person-roles" class="form-grid five">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="redirectTo" value="${esc(redirectTo)}" />
    <input type="hidden" name="personType" value="${esc(personType)}" />
    <input type="hidden" name="personId" value="${asInt(personId)}" />
    <label>Group<select name="groupId" required><option value="">Group</option>${roleGroups.map((group) => `<option value="${group.id}">${esc(group.name)}</option>`).join('')}</select></label>
    <label>Role<select name="roleTypeId" required><option value="">Role</option>${roleOptionsByGroup(roleGroups, roleTypes)}</select></label>
    <label>Assistant<span class="check-row"><input type="checkbox" name="isAssistant" value="1" /> Assistant</span></label>
    <label>Term Starts<input type="date" name="termStart" /></label>
    <label>Term Ends<input type="date" name="termEnd" /></label>
    <button type="submit">Add Role</button>
  </form>`;
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
            school_district_id=${asInt(body.schoolDistrictId) || 'NULL'},
            father_name=${sqlValue(cleanText(body.fatherName, 120))},
            mother_name=${sqlValue(cleanText(body.motherName, 120))},
            father_phone=${sqlValue(cleanText(body.fatherPhone, 40))},
            mother_phone=${sqlValue(cleanText(body.motherPhone, 40))},
            phone=${sqlValue(cleanText(body.fatherPhone, 40))},
            email=${sqlValue(cleanText(body.email, 160))},
            address=${sqlValue(cleanText(body.address, 220))}
        WHERE id=${familyId};`);
      return redirect(res, `/setup?section=families&familyId=${familyId}`, headers);
    }
    const newFamilyId = insertReturningId(`INSERT INTO os_families (family_name, school_district_id, father_name, mother_name, father_phone, mother_phone, phone, email, address)
      VALUES (${sqlValue(cleanText(body.familyName, 120))}, ${asInt(body.schoolDistrictId) || 'NULL'}, ${sqlValue(cleanText(body.fatherName, 120))}, ${sqlValue(cleanText(body.motherName, 120))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.motherPhone, 40))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.address, 220))})`);
    return redirect(res, `/setup?section=families&familyId=${newFamilyId}`, headers);
  }

  if (p === '/school-districts') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const districtId = asInt(body.districtId);
    if (districtId) {
      runSql(`UPDATE os_school_districts SET name=${sqlValue(cleanText(body.name, 140))} WHERE id=${districtId};`);
      return redirect(res, '/setup?section=districts', headers);
    }
    runSql(`INSERT OR IGNORE INTO os_school_districts (name) VALUES (${sqlValue(cleanText(body.name, 140))});`);
    return redirect(res, '/setup?section=districts', headers);
  }

  if (p === '/students') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const existingStudentId = asInt(body.studentId);
    if (existingStudentId) {
      runSql(`UPDATE os_students
        SET first_name=${sqlValue(cleanText(body.firstName, 80))},
            middle_name=${sqlValue(cleanText(body.middleName, 80))},
            last_name=${sqlValue(cleanText(body.lastName, 80))},
            birth_date=${sqlValue(cleanDate(body.birthDate))},
            gender=${sqlValue(cleanGender(body.gender))}
        WHERE id=${existingStudentId} AND family_id=${asInt(body.familyId)};`);
      runSql(`UPDATE os_student_years
        SET classroom_id=${asInt(body.classroomId) || 'NULL'}
        WHERE student_id=${existingStudentId} AND school_year_id=${schoolYearId};`);
      return redirect(res, `/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
    }
    const studentId = insertReturningId(`INSERT INTO os_students (family_id, first_name, middle_name, last_name, birth_date, gender)
      VALUES (${asInt(body.familyId)}, ${sqlValue(cleanText(body.firstName, 80))}, ${sqlValue(cleanText(body.middleName, 80))}, ${sqlValue(cleanText(body.lastName, 80))}, ${sqlValue(cleanDate(body.birthDate))}, ${sqlValue(cleanGender(body.gender))})`);
    runSql(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id)
      VALUES (${studentId}, ${schoolYearId}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'});`);
    return redirect(res, `/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
  }

  if (p === '/emergency-contacts') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const familyId = asInt(body.familyId);
    const contactId = asInt(body.contactId);
    const priority = Math.max(1, Math.min(20, asInt(body.priority) || 1));
    if (contactId) {
      runSql(`UPDATE os_emergency_contacts
        SET priority=${priority},
            name=${sqlValue(cleanText(body.name, 120))},
            relationship=${sqlValue(cleanText(body.relationship, 80))},
            phone=${sqlValue(cleanText(body.phone, 40))},
            notes=${sqlValue(cleanText(body.notes, 400))}
        WHERE id=${contactId} AND family_id=${familyId};`);
      return redirect(res, `/setup?section=families&familyId=${familyId}`, headers);
    }
    runSql(`INSERT INTO os_emergency_contacts (family_id, priority, name, relationship, phone, notes)
      VALUES (${familyId}, ${priority}, ${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.relationship, 80))}, ${sqlValue(cleanText(body.phone, 40))}, ${sqlValue(cleanText(body.notes, 400))});`);
    return redirect(res, `/setup?section=families&familyId=${familyId}`, headers);
  }

  if (p === '/enrollments') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    runSql(`INSERT OR REPLACE INTO os_student_years (student_id, school_year_id, grade_level, classroom_id, status)
      VALUES (${asInt(body.studentId)}, ${asInt(body.schoolYearId)}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'}, 'enrolled');`);
    const family = querySql(`SELECT family_id FROM os_students WHERE id=${asInt(body.studentId)} LIMIT 1;`)[0];
    return redirect(res, `/setup?section=families&familyId=${asInt(family?.family_id)}`, headers);
  }

  if (p === '/absences') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const kind = cleanText(body.kind, 20).toLowerCase() === 'tardy' ? 'tardy' : 'absence';
    const unit = cleanText(body.unit, 20).toLowerCase() === 'hours' ? 'hours' : 'days';
    const amount = Math.max(0, Math.min(30, Number(body.amount) || 0));
    runSql(`INSERT INTO os_absences (school_year_id, student_id, absence_date, kind, amount, unit, notes)
      VALUES (${asInt(body.schoolYearId)}, ${asInt(body.studentId)}, ${sqlValue(cleanDate(body.absenceDate))}, ${sqlValue(kind)}, ${amount}, ${sqlValue(unit)}, ${sqlValue(cleanText(body.notes, 400))});`);
    return redirect(res, '/absences', headers);
  }

  if (p === '/teachers') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const teacherId = asInt(body.teacherId);
    if (teacherId) {
      runSql(`UPDATE os_teachers
        SET name=${sqlValue(cleanText(body.name, 120))},
            email=${sqlValue(cleanText(body.email, 160))},
            mobile_phone=${sqlValue(cleanText(body.mobilePhone, 40))},
            phone=${sqlValue(cleanText(body.mobilePhone, 40))},
            address=${sqlValue(cleanText(body.address, 220))}
        WHERE id=${teacherId};`);
      return redirect(res, `/setup?section=teachers&teacherId=${teacherId}`, headers);
    }
    const newTeacherId = insertReturningId(`INSERT INTO os_teachers (name, email, mobile_phone, phone, address)
      VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.mobilePhone, 40))}, ${sqlValue(cleanText(body.mobilePhone, 40))}, ${sqlValue(cleanText(body.address, 220))})`);
    return redirect(res, `/setup?section=teachers&teacherId=${newTeacherId}`, headers);
  }

  if (p === '/person-roles') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const redirectRaw = cleanText(body.redirectTo, 240);
    const redirectTo = redirectRaw.startsWith('/') && !redirectRaw.startsWith('//') ? redirectRaw : '/setup';
    if (body.action === 'delete') {
      runSql(`DELETE FROM os_person_roles WHERE id=${asInt(body.roleAssignmentId)};`);
      return redirect(res, redirectTo, headers);
    }
    const personType = cleanPersonRoleType(body.personType);
    const personId = asInt(body.personId);
    const roleTypeId = asInt(body.roleTypeId);
    const roleType = querySql(`SELECT id, group_id FROM os_role_types WHERE id=${roleTypeId} LIMIT 1;`)[0];
    if (!personType || !personId || !roleType) return sendText(res, 400, 'Bad Request');
    runSql(`INSERT INTO os_person_roles (person_type, person_id, group_id, role_type_id, is_assistant, term_start, term_end)
      VALUES (${sqlValue(personType)}, ${personId}, ${asInt(roleType.group_id)}, ${roleTypeId}, ${body.isAssistant ? 1 : 0}, ${sqlValue(cleanDate(body.termStart))}, ${sqlValue(cleanDate(body.termEnd))});`);
    return redirect(res, redirectTo, headers);
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
    let subjectId = asInt(body.subjectId);
    const schoolYearId = asInt(body.schoolYearId);
    const subjectName = cleanText(body.name, 120);
    if (subjectId) {
      runSql(`UPDATE os_subjects SET name=${sqlValue(subjectName)} WHERE id=${subjectId};`);
    } else {
      subjectId = insertReturningId(`INSERT INTO os_subjects (name) VALUES (${sqlValue(subjectName)})
        ON CONFLICT(name) DO UPDATE SET name=excluded.name`);
    }
    if (schoolYearId && subjectId) {
      runSql(`DELETE FROM os_grade_subjects WHERE school_year_id=${schoolYearId} AND subject_id=${subjectId};`);
      formArray(body.grades).map(cleanGrade).filter(Boolean).forEach((grade) => {
        runSql(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id)
          VALUES (${schoolYearId}, ${sqlValue(grade)}, ${subjectId});`);
      });
    }
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
    createMarkingPeriods(yearId, 6, cleanDate(body.startDate), cleanDate(body.endDate));
    createDefaultWeightGroups(yearId);
    appendSetCookie(headers, `selectedYearId=${cookieValue(yearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    return redirect(res, '/setup?section=years', headers);
  }

  if (p === '/marking-periods') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const schoolDays = Math.max(1, Math.min(260, asInt(body.schoolDays) || 180));
    const periodCount = Math.max(1, Math.min(12, asInt(body.periodCount) || 6));
    const startDate = cleanDate(body.startDate);
    const endDate = cleanDate(body.endDate);
    runSql(`UPDATE os_school_years SET school_days=${schoolDays}, start_date=${sqlValue(startDate)}, end_date=${sqlValue(endDate)} WHERE id=${schoolYearId};`);
    runSql(`DELETE FROM os_marking_periods WHERE school_year_id=${schoolYearId};`);
    createMarkingPeriods(schoolYearId, periodCount, startDate, endDate);
    return redirect(res, '/setup?section=years', headers);
  }

  if (p === '/promote-year') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const fromYearId = asInt(body.fromYearId);
    if (String(body.makeActive) === '1') runSql('UPDATE os_school_years SET is_active=0;');
    const newYearId = insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
      VALUES (${sqlValue(cleanText(body.name, 40))}, ${sqlValue(cleanDate(body.startDate))}, ${sqlValue(cleanDate(body.endDate))}, ${String(body.makeActive) === '1' ? 1 : 0})`);
    createMarkingPeriods(newYearId, 6, cleanDate(body.startDate), cleanDate(body.endDate));
    createDefaultWeightGroups(newYearId);
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

  if (p === '/grade-weights') {
    if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const groupId = asInt(body.weightGroupId);
    const name = cleanText(body.name, 120) || 'Grade Weight Group';
    const minGrade = cleanGrade(body.minGrade);
    const maxGrade = cleanGrade(body.maxGrade);
    const subjectId = asInt(body.subjectId);
    const roundingMode = cleanText(body.roundingMode, 40) || 'nearest';
    const calculationMode = cleanText(body.calculationMode, 40) || 'weighted';
    const savedGroupId = groupId || insertReturningId(`INSERT INTO os_grade_weight_groups (school_year_id, name, min_grade, max_grade, subject_id, rounding_mode, calculation_mode)
      VALUES (${schoolYearId}, ${sqlValue(name)}, ${sqlValue(minGrade)}, ${sqlValue(maxGrade)}, ${subjectId || 'NULL'}, ${sqlValue(roundingMode)}, ${sqlValue(calculationMode)})`);
    if (groupId) {
      runSql(`UPDATE os_grade_weight_groups
        SET name=${sqlValue(name)},
            min_grade=${sqlValue(minGrade)},
            max_grade=${sqlValue(maxGrade)},
            subject_id=${subjectId || 'NULL'},
            rounding_mode=${sqlValue(roundingMode)},
            calculation_mode=${sqlValue(calculationMode)}
        WHERE id=${groupId};`);
      runSql(`DELETE FROM os_grade_weight_items WHERE group_id=${groupId};`);
    }
    CATEGORIES.forEach((category) => {
      const weight = Number(body[`weight_${category}`]);
      if (!Number.isFinite(weight) || weight <= 0) return;
      runSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
        VALUES (${savedGroupId}, ${sqlValue(category)}, ${Math.max(0, Math.min(100, weight))});`);
    });
    return redirect(res, '/setup?section=weights', headers);
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
    const markingPeriodId = asInt(body.markingPeriodId);
    const gradeLevel = cleanGrade(body.gradeLevel);
    const subjectId = asInt(body.subjectId);
    const existingAssignmentId = asInt(body.assignmentId);
    const scoreMode = cleanScoreMode(body.scoreMode);
    if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel)) return sendText(res, 403, 'Forbidden');
    const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : 'NULL';
    const maxScore = existingAssignmentId
      ? asPoints(querySql(`SELECT max_score FROM os_assignments WHERE id=${existingAssignmentId} AND school_year_id=${schoolYearId} LIMIT 1;`)[0]?.max_score)
      : asPoints(body.maxScore);
    if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    const assignmentId = existingAssignmentId || insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, marking_period_id, title, category, assignment_date, max_score, teacher_id)
      VALUES (${schoolYearId}, ${sqlValue(gradeLevel)}, ${subjectId}, ${markingPeriodId || 'NULL'}, ${sqlValue(cleanText(body.title, 140))}, ${sqlValue(normalizeCategory(body.category))}, ${sqlValue(cleanDate(body.assignmentDate))}, ${maxScore}, ${teacherId})`);
    Object.keys(body).forEach((key) => {
      if (!key.startsWith('score_')) return;
      const studentId = asInt(key.replace('score_', ''));
      const score = scoreInputToPoints(body[key], scoreMode, maxScore);
      if (score === null) return;
      runSql(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score;`);
    });
    return redirect(res, `/gradebook?yearId=${schoolYearId}${markingPeriodId ? `&markingPeriodId=${markingPeriodId}` : ''}&grade=${encodeURIComponent(gradeLevel)}&subjectId=${subjectId}&mode=${scoreMode}&assignmentId=${assignmentId}`, headers);
  }

  if (p === '/assignments') {
    const action = body.action;
    const schoolYearId = asInt(body.schoolYearId);
    const gradeLevel = cleanGrade(body.gradeLevel);
    const subjectId = asInt(body.subjectId);
    if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel)) return sendText(res, 403, 'Forbidden');
    const baseRedirect = `/assignments?yearId=${schoolYearId}&grade=${encodeURIComponent(gradeLevel)}&subjectId=${subjectId}`;

    if (action === 'add') {
      const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : 'NULL';
      const maxScore = asPoints(body.maxScore);
      const newId = insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, title, category, assignment_date, max_score, teacher_id)
        VALUES (${schoolYearId}, ${sqlValue(gradeLevel)}, ${subjectId}, ${sqlValue(cleanText(body.title, 140))}, ${sqlValue(normalizeCategory(body.category))}, ${sqlValue(cleanDate(body.assignmentDate))}, ${maxScore}, ${teacherId})`);
      return redirect(res, `${baseRedirect}&assignmentId=${newId}`, headers);
    }

    if (action === 'update') {
      const assignmentId = asInt(body.assignmentId);
      const maxScore = asPoints(body.maxScore);
      runSql(`UPDATE os_assignments SET title=${sqlValue(cleanText(body.title, 140))}, category=${sqlValue(normalizeCategory(body.category))}, assignment_date=${sqlValue(cleanDate(body.assignmentDate))}, max_score=${maxScore} WHERE id=${assignmentId} AND school_year_id=${schoolYearId};`);
      return redirect(res, `${baseRedirect}&assignmentId=${assignmentId}`, headers);
    }

    if (action === 'scores') {
      const assignmentId = asInt(body.assignmentId);
      const scoreMode = cleanScoreMode(body.scoreMode);
      const maxScore = asPoints(querySql(`SELECT max_score FROM os_assignments WHERE id=${assignmentId} AND school_year_id=${schoolYearId} LIMIT 1;`)[0]?.max_score);
      Object.keys(body).forEach((key) => {
        if (!key.startsWith('score_')) return;
        const studentId = asInt(key.replace('score_', ''));
        const score = scoreInputToPoints(body[key], scoreMode, maxScore);
        if (score === null) return;
        runSql(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
          ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score;`);
      });
      return redirect(res, `${baseRedirect}&mode=${scoreMode}&assignmentId=${assignmentId}`, headers);
    }

    return sendText(res, 400, 'Bad Request');
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
    if (p === '/gradebook') {
      const markingPeriodId = asInt(url.searchParams.get('markingPeriodId'));
      if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Gradebook', content: gradebookPage(req, url, user, selected, csrfToken) }), headers);
    }
    if (p === '/assignments') return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Assignments', content: assignmentsPage(req, url, user, selected, csrfToken) }), headers);
    if (p === '/report-cards') return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Report Cards', content: reportCardsPage(url, selected) }), headers);
    if (p === '/absences') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return sendHtml(res, pageTemplate({ ...pageArgs, title: 'Absences', content: absencesPage(url, selected, csrfToken) }), headers);
    }
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
