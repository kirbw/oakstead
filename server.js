const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { URL } = require('url');
const {
  APP_REPOSITORY_URL,
  APP_ROOT,
  APP_VERSION,
  BACKUP_DIR,
  DATA_DIR,
  DB_FILE,
  DEFAULT_HOST,
  DEFAULT_LOGO_FILE,
  DEFAULT_PORT,
  DEFAULT_SCHOOL_NAME,
  DEMO_HIDDEN_POST_PATHS,
  DEMO_HIDDEN_SETUP_SECTIONS,
  DEMO_MODE,
  DEMO_REFRESH_HOURS,
  LEGACY_LOGO_FILE,
  LOGIN_LOCK_MS,
  LOGIN_WINDOW_MS,
  MAX_BODY_SIZE,
  MAX_LOGIN_FAILURES,
  PUBLIC_DIR,
  RELEASE_REPO,
  SESSION_HOURS,
  SQLITE_BIN,
  UPDATE_MODE,
  UPDATE_STATUS_FILE,
  UPLOAD_DIR,
  cleanBindHost,
  parsePort
} = require('./server/config');
const {
  asInt,
  asPoints,
  asScore,
  cleanDate,
  cleanGrade,
  cleanScoreMode,
  cleanText,
  compactNumber,
  esc,
  formatFileSize,
  normalizeCategory,
  scoreInputToPoints,
  scoreValueForMode,
  sqlValue
} = require('./server/input');
const { createHttpHelpers } = require('./server/http');
const {
  gradebookRedirectUrl,
  gridScoreEntries,
  scoreFieldEntries
} = require('./server/gradebook-utils');
const {
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
} = createHttpHelpers({ escapeHtml: esc, maxBodySize: MAX_BODY_SIZE });
let ACTIVE_NETWORK = {
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  hostOverridden: Boolean(process.env.HOST),
  portOverridden: Boolean(process.env.PORT)
};

const ROLE_ADMIN = 'admin';
const ROLE_PRINCIPAL = 'principal';
const ROLE_TEACHER = 'teacher';
const ROLE_PARENT = 'parent';
const ROLES = [ROLE_ADMIN, ROLE_PRINCIPAL, ROLE_TEACHER, ROLE_PARENT];
const CATEGORIES = ['Lesson / Homework', 'Quiz', 'Test'];
const DEFAULT_LETTER_GRADES = [
  ['A+', 100],
  ['A', 96],
  ['A-', 94],
  ['B+', 92],
  ['B', 88],
  ['B-', 86],
  ['C+', 84],
  ['C', 79],
  ['C-', 76],
  ['D', 70],
  ['E', 63],
  ['F', 0]
];
const loginAttempts = new Map();

function ensureRuntimeDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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

function gridModeToggle(offUrl, onUrl, isGrid) {
  return `<div class="gradebook-layout-toggle" aria-label="Gradebook grid layout">
    <span>Grid</span>
    <label class="score-switch">
      <input type="checkbox" data-grid-toggle data-off-url="${esc(offUrl)}" data-on-url="${esc(onUrl)}" ${isGrid ? 'checked' : ''} />
      <span class="score-switch-track" aria-hidden="true"><span class="score-switch-thumb"></span></span>
      <span class="sr-only">Toggle grid gradebook layout</span>
    </label>
    <strong>${isGrid ? 'On' : 'Off'}</strong>
  </div>`;
}

function runSql(sql) {
  return execFileSync(SQLITE_BIN, [DB_FILE, sql], { encoding: 'utf8' });
}

function querySql(sql) {
  const out = execFileSync(SQLITE_BIN, ['-json', DB_FILE, sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

function insertReturningId(sql) {
  const row = querySql(`${sql} RETURNING id;`)[0];
  return asInt(row?.id);
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function backupPath(fileName) {
  const base = path.basename(String(fileName || ''));
  if (!/^oakstead-backup-[0-9T-]+Z(?:-[a-z0-9-]+)?\.db$/i.test(base)) return '';
  const target = path.join(BACKUP_DIR, base);
  return target.startsWith(BACKUP_DIR) ? target : '';
}

function createDatabaseBackup(reason = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const safeReason = cleanText(reason, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'manual';
  const fileName = `oakstead-backup-${timestampForFile()}-${safeReason}.db`;
  const target = path.join(BACKUP_DIR, fileName);
  fs.copyFileSync(DB_FILE, target);
  setSetting('backup_last_at', new Date().toISOString());
  setSetting('backup_last_file', fileName);
  return { fileName, path: target, size: fs.statSync(target).size };
}

function listDatabaseBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .map((fileName) => {
      const target = backupPath(fileName);
      if (!target || !fs.existsSync(target)) return null;
      const stat = fs.statSync(target);
      return { fileName, size: stat.size, createdAt: stat.mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function validateBackupDatabase(filePath) {
  const output = execFileSync(SQLITE_BIN, [filePath, 'PRAGMA quick_check;'], { encoding: 'utf8' }).trim();
  if (output !== 'ok') throw new Error('Backup database did not pass integrity check.');
}

function refreshDemoData(reason = 'scheduled') {
  const script = path.join(__dirname, 'scripts', 'seed-demo.js');
  if (!fs.existsSync(script)) {
    console.error('Demo seed script is missing.');
    return;
  }
  const result = spawnSync(process.execPath, [script, '--reset'], {
    cwd: __dirname,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
    env: { ...process.env, DB_FILE, SQLITE_BIN }
  });
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.status !== 0) console.error(`Demo data refresh failed during ${reason}.`);
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

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function loginAttemptKeys(req, username) {
  const ip = clientIp(req);
  return [`ip:${ip}`, `user:${username || 'blank'}:${ip}`];
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, attempt] of loginAttempts.entries()) {
    if (attempt.lockedUntil > now || now - attempt.firstAt <= LOGIN_WINDOW_MS) continue;
    loginAttempts.delete(key);
  }
}

function loginThrottleStatus(req, username) {
  pruneLoginAttempts();
  const now = Date.now();
  const locked = loginAttemptKeys(req, username)
    .map((key) => loginAttempts.get(key))
    .filter((attempt) => attempt?.lockedUntil > now)
    .sort((a, b) => b.lockedUntil - a.lockedUntil)[0];
  if (!locked) return null;
  return { retryAfter: Math.max(1, Math.ceil((locked.lockedUntil - now) / 1000)) };
}

function recordLoginFailure(req, username) {
  pruneLoginAttempts();
  const now = Date.now();
  loginAttemptKeys(req, username).forEach((key) => {
    const previous = loginAttempts.get(key);
    const attempt = previous && now - previous.firstAt <= LOGIN_WINDOW_MS
      ? previous
      : { count: 0, firstAt: now, lockedUntil: 0 };
    attempt.count += 1;
    if (attempt.count >= MAX_LOGIN_FAILURES) attempt.lockedUntil = now + LOGIN_LOCK_MS;
    loginAttempts.set(key, attempt);
  });
}

function clearLoginFailures(req, username) {
  loginAttemptKeys(req, username).forEach((key) => loginAttempts.delete(key));
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
CREATE TABLE IF NOT EXISTS os_congregations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS os_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL,
  school_district_id INTEGER,
  congregation_id INTEGER,
  father_name TEXT,
  mother_name TEXT,
  father_phone TEXT,
  mother_phone TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_district_id) REFERENCES os_school_districts(id),
  FOREIGN KEY (congregation_id) REFERENCES os_congregations(id)
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
  parent_family_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES os_teachers(id),
  FOREIGN KEY (parent_family_id) REFERENCES os_families(id)
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
CREATE TABLE IF NOT EXISTS os_letter_grade_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  min_grade TEXT NOT NULL,
  max_grade TEXT NOT NULL,
  subject_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_year_id) REFERENCES os_school_years(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES os_subjects(id)
);
CREATE TABLE IF NOT EXISTS os_letter_grade_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  letter TEXT NOT NULL,
  threshold REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, letter),
  FOREIGN KEY (group_id) REFERENCES os_letter_grade_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_os_sessions_token ON os_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_os_student_years_year_grade ON os_student_years(school_year_id, grade_level);
CREATE INDEX IF NOT EXISTS idx_os_assignments_year_grade_subject ON os_assignments(school_year_id, grade_level, subject_id);
`);

  ensureColumn('os_school_years', 'school_days', 'school_days INTEGER DEFAULT 180');
  ensureColumn('os_assignments', 'marking_period_id', 'marking_period_id INTEGER');
  ensureColumn('os_families', 'school_district_id', 'school_district_id INTEGER');
  ensureColumn('os_families', 'congregation_id', 'congregation_id INTEGER');
  ensureColumn('os_families', 'father_phone', 'father_phone TEXT');
  ensureColumn('os_families', 'mother_phone', 'mother_phone TEXT');
  ensureColumn('os_students', 'middle_name', 'middle_name TEXT');
  ensureColumn('os_students', 'gender', 'gender TEXT');
  ensureColumn('os_teachers', 'mobile_phone', 'mobile_phone TEXT');
  ensureColumn('os_teachers', 'address', 'address TEXT');
  ensureColumn('os_users', 'parent_family_id', 'parent_family_id INTEGER');

  runSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('school_name', ${sqlValue(DEFAULT_SCHOOL_NAME)});`);
  runSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('network_bind_host', ${sqlValue(DEFAULT_HOST)});`);
  runSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('network_port', ${sqlValue(DEFAULT_PORT)});`);
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
    const letterCount = querySql(`SELECT COUNT(*) AS count FROM os_letter_grade_groups WHERE school_year_id=${asInt(year.id)};`)[0]?.count || 0;
    if (!letterCount) createDefaultLetterGradeGroup(asInt(year.id));
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

function createDefaultLetterGradeGroup(yearId) {
  const groupId = insertReturningId(`INSERT INTO os_letter_grade_groups (school_year_id, name, min_grade, max_grade, subject_id)
    VALUES (${yearId}, 'Default Letter Grades', '1', '12', NULL)`);
  DEFAULT_LETTER_GRADES.forEach(([letter, threshold], index) => {
    runSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
      VALUES (${groupId}, ${sqlValue(letter)}, ${Number(threshold)}, ${index});`);
  });
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
  if (DEMO_MODE) return { id: 0, name: 'Demo Admin', username: 'demo', role: ROLE_ADMIN, teacher_id: null, parent_family_id: null };
  const token = parseCookies(req).sessionToken;
  if (!token) return null;
  const rows = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, u.parent_family_id
    FROM os_sessions s
    JOIN os_users u ON u.id = s.user_id
    WHERE s.session_token=${sqlValue(token)} AND s.expires_at > datetime('now')
    LIMIT 1;`);
  return rows[0] || null;
}

function isAdmin(user) {
  return user?.role === ROLE_ADMIN;
}

function isPrincipal(user) {
  return user?.role === ROLE_PRINCIPAL;
}

function isTeacher(user) {
  return user?.role === ROLE_TEACHER;
}

function isParent(user) {
  return user?.role === ROLE_PARENT;
}

function canAccessSetup(user) {
  return isAdmin(user) || isPrincipal(user);
}

function canManageAdminUsers(user) {
  return isAdmin(user);
}

function canManageSchoolUsers(user) {
  return isAdmin(user) || isPrincipal(user);
}

function canManageSchoolSetup(user) {
  return isAdmin(user) || isPrincipal(user);
}

function canManageAcademicRecords(user) {
  return isAdmin(user) || isPrincipal(user) || isTeacher(user);
}

function teacherStudentClause(user, yearId, alias = 'sy') {
  return isTeacher(user) ? `AND ${alias}.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${asInt(user.teacher_id)} AND school_year_id=${asInt(yearId)})` : '';
}

function studentAccessClause(user, yearId, studentAlias = 'st', enrollmentAlias = 'sy') {
  if (isAdmin(user) || isPrincipal(user)) return '';
  if (isTeacher(user)) return teacherStudentClause(user, yearId, enrollmentAlias);
  if (isParent(user)) return `AND ${studentAlias}.family_id=${asInt(user.parent_family_id)}`;
  return 'AND 1=0';
}

function canViewStudent(user, studentId, yearId) {
  if (isAdmin(user) || isPrincipal(user)) return true;
  if (!studentId || !yearId) return false;
  if (isTeacher(user)) {
    const rows = querySql(`SELECT sy.student_id
      FROM os_student_years sy
      JOIN os_classrooms c ON c.id = sy.classroom_id
      WHERE sy.student_id=${asInt(studentId)}
        AND sy.school_year_id=${asInt(yearId)}
        AND sy.status='enrolled'
        AND c.teacher_id=${asInt(user.teacher_id)}
      LIMIT 1;`);
    return Boolean(rows.length);
  }
  if (isParent(user)) {
    const rows = querySql(`SELECT st.id
      FROM os_students st
      JOIN os_student_years sy ON sy.student_id = st.id
      WHERE st.id=${asInt(studentId)}
        AND st.family_id=${asInt(user.parent_family_id)}
        AND sy.school_year_id=${asInt(yearId)}
        AND sy.status='enrolled'
      LIMIT 1;`);
    return Boolean(rows.length);
  }
  return false;
}

function canModifyStudentAcademicRecord(user, studentId, yearId) {
  if (isAdmin(user) || isPrincipal(user)) return true;
  if (!isTeacher(user)) return false;
  return canViewStudent(user, studentId, yearId);
}

function roleOptionsForUser(user, selected = '') {
  const roles = canManageAdminUsers(user) ? ROLES : [ROLE_TEACHER, ROLE_PARENT];
  return roles.map((role) => `<option value="${role}" ${selectedAttr(role, selected)}>${roleLabel(role)}</option>`).join('');
}

function roleLabel(role) {
  if (role === ROLE_ADMIN) return 'Admin';
  if (role === ROLE_PRINCIPAL) return 'Principal';
  if (role === ROLE_PARENT) return 'Parent';
  return 'Teacher';
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

function backupFrequency(value) {
  const clean = cleanText(value, 20).toLowerCase();
  return ['manual', 'daily', 'weekly', 'monthly'].includes(clean) ? clean : 'manual';
}

function desiredNetworkConfig() {
  const storedHost = getSetting('network_bind_host', DEFAULT_HOST);
  const storedPort = getSetting('network_port', String(DEFAULT_PORT));
  return {
    host: process.env.HOST ? cleanBindHost(process.env.HOST, DEFAULT_HOST) : cleanBindHost(storedHost, DEFAULT_HOST),
    port: process.env.PORT ? parsePort(process.env.PORT, DEFAULT_PORT) : parsePort(storedPort, DEFAULT_PORT),
    hostOverridden: Boolean(process.env.HOST),
    portOverridden: Boolean(process.env.PORT)
  };
}

function localNetworkAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address)
    .filter((address, index, addresses) => addresses.indexOf(address) === index)
    .sort();
}

function networkAccessLabel(host) {
  return host === '0.0.0.0' ? 'LAN access' : 'Local only';
}

function networkAccessHostForMode(value) {
  const mode = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (['lan', 'trusted-lan', 'network', 'local-network', '0.0.0.0'].includes(mode)) return '0.0.0.0';
  if (['local', 'local-only', 'localhost', '127.0.0.1'].includes(mode)) return '127.0.0.1';
  return '';
}

function networkUrls(config = ACTIVE_NETWORK) {
  if (config.host === '0.0.0.0') {
    const addresses = localNetworkAddresses();
    return (addresses.length ? addresses : [os.hostname()]).map((host) => `http://${host}:${config.port}`);
  }
  return [`http://${config.host === 'localhost' ? '127.0.0.1' : config.host}:${config.port}`];
}

function networkStatus() {
  const desired = desiredNetworkConfig();
  return {
    desired,
    active: ACTIVE_NETWORK,
    hostName: os.hostname(),
    addresses: localNetworkAddresses(),
    urls: networkUrls(ACTIVE_NETWORK),
    desiredUrls: networkUrls(desired),
    restartRequired: desired.host !== ACTIVE_NETWORK.host || desired.port !== ACTIVE_NETWORK.port,
    envManaged: desired.hostOverridden || desired.portOverridden
  };
}

function printNetworkStatus() {
  const savedHost = cleanBindHost(getSetting('network_bind_host', DEFAULT_HOST), DEFAULT_HOST);
  const savedPort = parsePort(getSetting('network_port', String(DEFAULT_PORT)), DEFAULT_PORT);
  const effective = desiredNetworkConfig();
  console.log(`Saved network access: ${networkAccessLabel(savedHost)} (${savedHost}:${savedPort})`);
  if (effective.hostOverridden || effective.portOverridden) {
    console.log(`Environment override: ${effective.hostOverridden ? `HOST=${effective.host}` : 'HOST unset'}, ${effective.portOverridden ? `PORT=${effective.port}` : 'PORT unset'}`);
  }
  console.log(`Effective on next start: ${networkAccessLabel(effective.host)} (${effective.host}:${effective.port})`);
  networkUrls(effective).forEach((item) => console.log(`URL: ${item}`));
}

function printNetworkAccessUsage() {
  console.log([
    'Usage:',
    '  node server.js --network-status',
    '  node server.js --set-network-access <lan|local> [port]',
    '',
    'Examples:',
    '  node server.js --set-network-access lan',
    '  node server.js --set-network-access local 3000'
  ].join('\n'));
}

function setNetworkAccessFromCli(args) {
  const [modeValue, portValue] = args;
  if (!modeValue || modeValue === '--help' || modeValue === '-h') {
    printNetworkAccessUsage();
    return Boolean(modeValue);
  }
  const host = networkAccessHostForMode(modeValue);
  if (!host) {
    console.error(`Unknown network access mode: ${modeValue}`);
    printNetworkAccessUsage();
    return false;
  }
  const currentPort = parsePort(getSetting('network_port', String(DEFAULT_PORT)), DEFAULT_PORT);
  const port = portValue === undefined ? currentPort : parsePort(portValue, 0);
  if (!port) {
    console.error(`Invalid port: ${portValue}`);
    printNetworkAccessUsage();
    return false;
  }
  setSetting('network_bind_host', host);
  setSetting('network_port', String(port));
  setSetting('network_restart_required_at', new Date().toISOString());
  console.log(`Saved network access: ${networkAccessLabel(host)} (${host}:${port})`);
  networkUrls({ host, port }).forEach((item) => console.log(`URL after restart: ${item}`));
  if (process.env.HOST || process.env.PORT) {
    console.log('Note: HOST or PORT is currently set, so the environment override wins until it is removed.');
  }
  console.log('Restart Oakstead for this change to take effect.');
  return true;
}

function backupFrequencyLabel(value) {
  return { manual: 'Manual only', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[backupFrequency(value)];
}

function scheduledBackupDue(now = new Date()) {
  const frequency = backupFrequency(getSetting('backup_frequency', 'manual'));
  if (frequency === 'manual') return false;
  const lastAt = getSetting('backup_last_at', '');
  if (!lastAt) return true;
  const last = new Date(lastAt);
  if (Number.isNaN(last.getTime())) return true;
  const ageMs = now - last;
  const dayMs = 24 * 60 * 60 * 1000;
  if (frequency === 'daily') return ageMs >= dayMs;
  if (frequency === 'weekly') return ageMs >= dayMs * 7;
  return ageMs >= dayMs * 30;
}

function runScheduledBackupIfDue() {
  try {
    if (fs.existsSync(DB_FILE) && scheduledBackupDue()) createDatabaseBackup('scheduled');
  } catch (error) {
    console.error('Scheduled backup failed:', error.message || error);
  }
}

function defaultUpdateStatus() {
  return {
    running: false,
    phase: 'idle',
    percent: 0,
    message: UPDATE_MODE === 'installer' ? 'Ready to check GitHub releases for a Windows installer.' : 'Ready to check for updates.',
    updateMode: UPDATE_MODE,
    channel: 'stable',
    version: APP_VERSION,
    targetVersion: '',
    latestVersion: '',
    latestTag: '',
    updateAvailable: false,
    releaseUrl: '',
    installerAssetName: '',
    installerDownloadUrl: '',
    downloadUrl: '',
    updatedAt: new Date().toISOString(),
    log: []
  };
}

function readUpdateStatus() {
  try {
    if (!fs.existsSync(UPDATE_STATUS_FILE)) return defaultUpdateStatus();
    const status = { ...defaultUpdateStatus(), ...JSON.parse(fs.readFileSync(UPDATE_STATUS_FILE, 'utf8')) };
    if (status.latestVersion && compareVersions(status.latestVersion, APP_VERSION) <= 0) {
      status.updateAvailable = false;
      status.downloadUrl = '';
      status.installerDownloadUrl = '';
    }
    return status;
  } catch {
    return defaultUpdateStatus();
  }
}

function writeUpdateStatus(patch) {
  const previous = readUpdateStatus();
  const log = patch.log ? [...(previous.log || []), ...patch.log].slice(-80) : previous.log || [];
  const next = { ...previous, ...patch, log, updateMode: UPDATE_MODE, version: APP_VERSION, updatedAt: new Date().toISOString() };
  fs.writeFileSync(UPDATE_STATUS_FILE, JSON.stringify(next, null, 2));
  return next;
}

function updateLog(message) {
  return `${new Date().toLocaleTimeString('en-US', { hour12: false })} ${message}`;
}

function compareVersions(a, b) {
  const parse = (value) => {
    const [version, prerelease = ''] = String(value || '').replace(/^v/i, '').split('-', 2);
    const parts = version.split('.').map((part) => Number(part) || 0);
    return { parts: [parts[0] || 0, parts[1] || 0, parts[2] || 0], prerelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Oakstead/${APP_VERSION}`
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024 * 4) {
          request.destroy(new Error('GitHub response was too large.'));
        }
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`GitHub returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('Timed out checking GitHub releases.')));
    request.on('error', reject);
  });
}

async function githubReleaseForChannel(channel) {
  const releases = await httpsJson(`https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=20`);
  if (!Array.isArray(releases)) throw new Error('GitHub release list was not an array.');
  const published = releases.filter((release) => !release.draft);
  if (channel === 'prerelease') return published.find((release) => release.prerelease) || published.find((release) => !release.prerelease) || null;
  return published.find((release) => !release.prerelease) || null;
}

function installerAssetForRelease(release, version) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const escapedVersion = String(version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionedSetup = new RegExp(`oakstead.*setup.*v?${escapedVersion}.*\\.exe$`, 'i');
  return assets.find((asset) => versionedSetup.test(asset.name || ''))
    || assets.find((asset) => /oakstead.*setup.*\.exe$/i.test(asset.name || ''))
    || assets.find((asset) => /\.exe$/i.test(asset.name || ''))
    || null;
}

function runUpdateCommand(label, command, args, options = {}) {
  writeUpdateStatus({ message: label, log: [updateLog(label)] });
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
    ...options
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (output) writeUpdateStatus({ log: output.split('\n').slice(-30).map((line) => `  ${line.slice(0, 500)}`) });
  if (result.status !== 0) {
    throw new Error(`${label} failed${result.error ? `: ${result.error.message}` : ''}`);
  }
  return output;
}

function latestReleaseTag(channel) {
  const tags = runUpdateCommand('Reading release tags', 'git', ['tag', '--list', '--sort=-v:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const stable = tags.find((tag) => /^v?\d+\.\d+\.\d+$/.test(tag));
  const prerelease = tags.find((tag) => /^v?\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(tag));
  return channel === 'prerelease' ? (prerelease || stable || '') : (stable || '');
}

function checkLatestGitRelease(channel) {
  const updateChannel = channel === 'prerelease' ? 'prerelease' : 'stable';
  writeUpdateStatus({
    phase: 'checking',
    percent: 4,
    channel: updateChannel,
    releaseUrl: '',
    installerAssetName: '',
    installerDownloadUrl: '',
    downloadUrl: '',
    message: 'Checking GitHub for available releases.',
    log: [updateLog(`Checking ${updateChannel} releases`)]
  });
  runUpdateCommand('Fetching GitHub release tags', 'git', ['fetch', '--tags', '--prune', 'origin']);
  const tag = latestReleaseTag(updateChannel);
  const latestVersion = tag ? tag.replace(/^v/, '') : '';
  const updateAvailable = Boolean(latestVersion && compareVersions(latestVersion, APP_VERSION) > 0);
  return writeUpdateStatus({
    running: false,
    phase: 'checked',
    percent: 0,
    channel: updateChannel,
    targetVersion: latestVersion,
    latestVersion,
    latestTag: tag,
    updateAvailable,
    message: tag ? `${updateAvailable ? 'Update available' : 'Already current'}: ${tag}` : 'No release tag was found.',
    log: [updateLog(tag ? `Latest ${updateChannel} release is ${tag}` : 'No release tag found')]
  });
}

async function checkLatestInstallerRelease(channel) {
  const updateChannel = channel === 'prerelease' ? 'prerelease' : 'stable';
  writeUpdateStatus({
    phase: 'checking',
    percent: 10,
    channel: updateChannel,
    releaseUrl: '',
    installerAssetName: '',
    installerDownloadUrl: '',
    downloadUrl: '',
    message: `Checking GitHub releases for ${RELEASE_REPO}.`,
    log: [updateLog(`Checking ${updateChannel} installer releases from ${RELEASE_REPO}`)]
  });
  const release = await githubReleaseForChannel(updateChannel);
  if (!release) {
    return writeUpdateStatus({
      running: false,
      phase: 'checked',
      percent: 0,
      updateAvailable: false,
      message: 'No published GitHub release was found.',
      log: [updateLog('No published GitHub release was found')]
    });
  }
  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const asset = installerAssetForRelease(release, latestVersion);
  const updateAvailable = Boolean(latestVersion && compareVersions(latestVersion, APP_VERSION) > 0);
  const hasInstaller = Boolean(asset?.browser_download_url);
  return writeUpdateStatus({
    running: false,
    phase: 'checked',
    percent: 0,
    channel: updateChannel,
    targetVersion: latestVersion,
    latestVersion,
    latestTag: release.tag_name || '',
    updateAvailable,
    releaseUrl: release.html_url || '',
    installerAssetName: asset?.name || '',
    installerDownloadUrl: asset?.browser_download_url || '',
    downloadUrl: asset?.browser_download_url || '',
    message: updateAvailable
      ? (hasInstaller ? `Windows installer available: v${latestVersion}` : `v${latestVersion} is available, but no Windows installer asset was attached.`)
      : `Already current: v${latestVersion || APP_VERSION}`,
    log: [
      updateLog(`Latest ${updateChannel} release is ${release.tag_name || latestVersion || 'unknown'}`),
      updateLog(hasInstaller ? `Installer asset: ${asset.name}` : 'No installer asset found on the release')
    ]
  });
}

async function checkLatestRelease(channel) {
  return UPDATE_MODE === 'installer' ? checkLatestInstallerRelease(channel) : checkLatestGitRelease(channel);
}

function restartApplication() {
  writeUpdateStatus({ phase: 'restarting', percent: 98, message: 'Restarting Oakstead.', log: [updateLog('Restarting application')] });
  const supervised = Boolean(process.env.INVOCATION_ID || process.env.pm_id || process.env.NODE_APP_INSTANCE);
  if (!supervised) {
    const child = spawn(process.execPath, [__filename], {
      cwd: APP_ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    child.unref();
  }
  setTimeout(() => process.exit(0), 900);
}

async function startInstallerUpdate(channel) {
  const active = readUpdateStatus();
  const updateChannel = channel === 'prerelease' ? 'prerelease' : 'stable';
  const activeIsCurrent = active.installerDownloadUrl
    && active.channel === updateChannel
    && active.latestVersion
    && compareVersions(active.latestVersion, APP_VERSION) > 0;
  const status = activeIsCurrent ? active : await checkLatestInstallerRelease(updateChannel);
  if (!status.updateAvailable) {
    return writeUpdateStatus({
      running: false,
      phase: 'checked',
      percent: 0,
      channel: updateChannel,
      message: status.message || 'No installer update is available.',
      log: [updateLog('Installer update was requested, but no update is available')]
    });
  }
  if (!status.installerDownloadUrl) {
    return writeUpdateStatus({
      running: false,
      phase: 'missing installer',
      percent: 0,
      channel: updateChannel,
      message: 'A release is available, but it does not include a Windows installer asset.',
      log: [updateLog('Installer update cannot continue because no .exe asset was found')]
    });
  }
  try {
    if (fs.existsSync(DB_FILE)) {
      const backup = createDatabaseBackup('pre-installer-update');
      writeUpdateStatus({ log: [updateLog(`Created pre-installer backup ${backup.fileName}`)] });
    }
  } catch (error) {
    writeUpdateStatus({ log: [updateLog(`Backup before installer download failed: ${error.message || error}`)] });
  }
  return writeUpdateStatus({
    running: false,
    phase: 'download ready',
    percent: 100,
    channel: updateChannel,
    message: `Download ${status.installerAssetName || 'the Windows installer'} and run it on this computer to complete the update.`,
    downloadUrl: status.installerDownloadUrl,
    installerDownloadUrl: status.installerDownloadUrl,
    log: [updateLog('Installer download is ready')]
  });
}

async function startSystemUpdate(channel) {
  const active = readUpdateStatus();
  if (active.running) return active;
  if (UPDATE_MODE === 'installer') return startInstallerUpdate(channel);
  const updateChannel = channel === 'prerelease' ? 'prerelease' : 'stable';
  writeUpdateStatus({
    running: true,
    phase: 'starting',
    percent: 2,
    channel: updateChannel,
    targetVersion: '',
    message: 'Starting update.',
    log: [updateLog(`Starting ${updateChannel} update from version ${APP_VERSION}`)]
  });
  const child = spawn(process.execPath, [__filename, '--run-system-update', updateChannel], {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
  return readUpdateStatus();
}

function runSystemUpdateWorker(channel) {
  try {
    writeUpdateStatus({ phase: 'backup', percent: 5, message: 'Creating a database backup before updating.' });
    const backup = createDatabaseBackup('pre-update');
    writeUpdateStatus({ log: [updateLog(`Created pre-update backup ${backup.fileName}`)] });
    writeUpdateStatus({ phase: 'checking', percent: 8, message: 'Checking local repository state.' });
    runUpdateCommand('Checking for tracked local changes', 'git', ['diff', '--quiet']);
    runUpdateCommand('Checking staged changes', 'git', ['diff', '--cached', '--quiet']);
    writeUpdateStatus({ phase: 'fetching', percent: 22, message: 'Fetching releases from GitHub.' });
    runUpdateCommand('Fetching GitHub release tags', 'git', ['fetch', '--tags', '--prune', 'origin']);
    const tag = latestReleaseTag(channel);
    writeUpdateStatus({ phase: 'downloading', percent: 42, targetVersion: tag.replace(/^v/, ''), message: tag ? `Downloading ${tag}.` : 'No release tag found; updating current branch.' });
    if (tag) {
      runUpdateCommand(`Checking out ${tag}`, 'git', ['checkout', tag]);
    } else {
      const branch = runUpdateCommand('Reading current branch', 'git', ['branch', '--show-current']).trim() || 'main';
      runUpdateCommand(`Pulling origin/${branch}`, 'git', ['pull', '--ff-only', 'origin', branch]);
    }
    writeUpdateStatus({ phase: 'installing', percent: 66, message: 'Installing npm dependencies.' });
    runUpdateCommand('Running npm install', 'npm', ['install']);
    writeUpdateStatus({ phase: 'validating', percent: 84, message: 'Validating server code.' });
    runUpdateCommand('Running npm run check', 'npm', ['run', 'check']);
    writeUpdateStatus({ running: false, phase: 'complete', percent: 96, message: 'Update complete. Restarting now.', log: [updateLog('Update completed successfully')] });
    restartApplication();
  } catch (error) {
    writeUpdateStatus({
      running: false,
      phase: 'failed',
      percent: 100,
      message: error.message || 'Update failed.',
      log: [updateLog(`ERROR ${error.message || error}`)]
    });
  }
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

function imageUploadError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function detectedImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return '.ico';
  return '';
}

function uploadExtension(file) {
  const nameExt = path.extname(String(file?.filename || '')).toLowerCase();
  if (nameExt === '.svg') throw imageUploadError('SVG uploads are not supported. Use PNG, JPEG, WebP, or ICO.');
  const detectedExt = detectedImageExtension(file?.data);
  if (!detectedExt) throw imageUploadError('Unsupported image upload. Use PNG, JPEG, WebP, or ICO.');
  const compatibleExts = detectedExt === '.jpg' ? new Set(['.jpg', '.jpeg']) : new Set([detectedExt]);
  if (nameExt && !compatibleExts.has(nameExt)) {
    throw imageUploadError('Uploaded image extension does not match the file contents.');
  }
  return detectedExt;
}

function saveUploadedImage(file, basename) {
  if (!file?.data?.length) return '';
  const ext = uploadExtension(file);
  if (!ext) return '';
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fileName = `${basename}${ext}`;
  const target = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(target, file.data);
  return `uploads/${fileName}`;
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

function gradebookTitle(category, title) {
  const cleanTitle = cleanText(title, 140);
  return cleanTitle || displayCategoryShort(category);
}

function gradebookLetter(value, scale = DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }))) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '';
  const rows = [...scale]
    .map((row) => ({ letter: cleanText(row.letter, 12), threshold: Number(row.threshold) }))
    .filter((row) => row.letter && Number.isFinite(row.threshold))
    .sort((a, b) => b.threshold - a.threshold);
  return rows.find((row) => score >= row.threshold)?.letter || rows.at(-1)?.letter || '';
}

function compactPercent(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(decimals).replace(/\.?0+$/, '');
}

function gradebookDisplayScore(value, scale) {
  const percent = compactPercent(value);
  if (!percent) return '&mdash;';
  const letter = gradebookLetter(value, scale);
  return `${percent}<sup>${esc(letter)}</sup>`;
}

function gradebookCategoryClass(category) {
  const cat = normalizeCategory(category);
  if (cat === 'Quiz') return 'quiz';
  if (cat === 'Test') return 'test';
  return 'lesson';
}

function matchingLetterGradeGroup(groups, grade, subjectId) {
  const rank = gradeRank(grade);
  return groups.find((group) => group.subject_id === subjectId && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || groups.find((group) => !group.subject_id && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || null;
}

function letterGradeScale(yearId, grade, subjectId) {
  const groups = querySql(`SELECT * FROM os_letter_grade_groups WHERE school_year_id=${yearId};`);
  const group = matchingLetterGradeGroup(groups, grade, subjectId);
  if (!group) return DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
  const items = querySql(`SELECT letter, threshold FROM os_letter_grade_items WHERE group_id=${asInt(group.id)} ORDER BY threshold DESC, sort_order, letter;`);
  return items.length ? items : DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
}

function teacherAllowedForSelection(user, yearId, grade, classroomId = 0) {
  if (!user) return false;
  if (isAdmin(user) || isPrincipal(user)) return true;
  if (!isTeacher(user)) return false;
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

const REPORT_ICONS = {
  families: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M17 12.5a3 3 0 0 0 0-6"/><path d="M18.5 20v-1a4 4 0 0 0-2-3.46"/></svg>',
  students: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12.2V17c0 1.66 2.69 3 6 3s6-1.34 6-3v-4.8"/><path d="M22 10v6"/></svg>',
  'school-board': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8"/><path d="M9 4v5l-4 7"/><path d="M15 4v5l4 7"/><path d="M5 16h14"/><path d="M7 20h10"/><path d="M12 9v11"/></svg>',
  birthdays: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4z"/><path d="M4 15c1.4 0 1.4-1 2.8-1s1.4 1 2.8 1 1.4-1 2.8-1 1.4 1 2.8 1 1.4-1 2.8-1 1.4 1 2.8 1"/><path d="M8 11V8"/><path d="M12 11V8"/><path d="M16 11V8"/><path d="M8 5l.8 1L8 7 7.2 6 8 5Z"/><path d="m12 5 .8 1-.8 1-.8-1L12 5Z"/><path d="m16 5 .8 1-.8 1-.8-1L16 5Z"/></svg>',
  'grade-graph': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m6 15 4-4 3 3 5-7"/><path d="M10 11h.01"/><path d="M13 14h.01"/><path d="M18 7h.01"/></svg>'
};

const REPORT_METER_COLORS = ['#2f6f5e', '#2563eb', '#a16207', '#be123c', '#6d28d9', '#0e7490', '#7c2d12', '#4d7c0f'];

function navItemActive(pathname, currentPath) {
  return currentPath === pathname || (pathname !== '/' && currentPath.startsWith(pathname));
}

function navLink(pathname, currentPath, label, iconKey) {
  const active = navItemActive(pathname, currentPath);
  return `<a class="nav-link ${active ? 'active' : ''}" href="${pathname}">${NAV_ICONS[iconKey] || ''}<span>${esc(label)}</span></a>`;
}

function navItemsForUser(user) {
  if (isParent(user)) return [{ pathname: '/parent', label: 'Parent Portal', iconKey: 'reports' }];
  return [
    { pathname: '/', label: 'Dashboard', iconKey: 'dashboard' },
    { pathname: '/assignments', label: 'Assignments', iconKey: 'assignments' },
    { pathname: '/gradebook', label: 'Gradebook', iconKey: 'gradebook' },
    { pathname: '/absences', label: 'Absences', iconKey: 'absences' },
    { pathname: '/reports', label: 'Reports', iconKey: 'reports' },
    { pathname: '/report-cards', label: 'Report Card', iconKey: 'reportcards' },
    ...(canAccessSetup(user) ? [{ pathname: '/setup', label: 'School Setup', iconKey: 'setup' }] : [])
  ];
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
  const yearSwitcher = (extraClass = '') => user && selectedYear ? `<form class="year-form ${extraClass}" method="post" action="/switch-year">
      ${csrfInput(csrfToken)}
      <select name="yearId" aria-label="School year">
        ${years.map((year) => `<option value="${year.id}" ${year.id === selectedYear.id ? 'selected' : ''}>${esc(year.name)}</option>`).join('')}
      </select>
      <button class="sr-only" type="submit">Switch school year</button>
    </form>` : '';
  const navItems = user ? navItemsForUser(user) : [];
  const navMarkup = navItems.map((item) => navLink(item.pathname, currentPath, item.label, item.iconKey)).join('');
  const activeNav = navItems.find((item) => navItemActive(item.pathname, currentPath)) || navItems[0] || null;
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
  --grade-grid-head: #dce8ff;
  --grade-grid-head-ink: #172554;
  --grade-grid-head-line: #8aa4d6;
  --grade-grid-band: #dce8ff;
  --grade-grid-band-strong: #c9dafb;
  --grade-grid-band-ink: #172554;
  --shadow: 0 18px 48px rgba(16, 24, 40, .07);
  --radius: 4px;
  --demo-offset: ${DEMO_MODE ? '34px' : '0px'};
  --topbar-height: 66px;
  --mobile-strip-height: 50px;
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
  --grade-grid-head: #171515;
  --grade-grid-head-ink: #ffffff;
  --grade-grid-head-line: #8a8a91;
  --grade-grid-band: #273967;
  --grade-grid-band-strong: #415995;
  --grade-grid-band-ink: #ffffff;
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
.demo-banner {
  grid-column: 1 / -1;
  position: sticky;
  top: 0;
  z-index: 30;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: .38rem .85rem;
  background: #b42318;
  color: #fff;
  font-size: .84rem;
  font-weight: 850;
  text-align: center;
  letter-spacing: .015em;
}
.topbar {
  position: sticky;
  top: var(--demo-offset);
  z-index: 24;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: .75rem;
  min-height: var(--topbar-height);
  padding: .55rem max(.85rem, env(safe-area-inset-left)) .55rem max(.85rem, env(safe-area-inset-right));
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  backdrop-filter: blur(16px);
}
.brand-row, .top-actions, .year-form, .user-chip { display: flex; align-items: center; gap: .5rem; min-width: 0; }
.brand-row { justify-content: space-between; }
.brand { display: flex; align-items: center; gap: .65rem; min-width: 0; text-decoration: none; }
.brand img { width: 44px; height: 34px; object-fit: contain; flex: 0 0 auto; }
.brand-text { min-width: 0; }
.brand-text strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.02rem; font-weight: 760; letter-spacing: 0; line-height: 1.2; }
.brand-text span { display: block; color: var(--muted); font-size: .82rem; margin-top: .05rem; line-height: 1.35; }
.top-actions { justify-content: flex-end; flex-wrap: nowrap; margin-left: auto; }
.year-form { flex: 0 0 auto; }
.year-form select { min-height: 38px; width: 150px; border-color: var(--line); background: var(--paper); font-size: .84rem; font-weight: 700; padding: .42rem .54rem; }
.year-form button, .icon-btn, .logout-btn {
  border: 1px solid var(--line);
  background: var(--paper-strong);
  color: var(--ink);
  border-radius: var(--radius);
  padding: .42rem .58rem;
  cursor: pointer;
}
.logout-form { margin: 0; }
.logout-btn {
  min-height: 36px;
  font-size: .82rem;
  font-weight: 760;
  white-space: nowrap;
}
.user-chip {
  min-height: 34px;
  max-width: 170px;
  color: var(--muted);
  font-size: .82rem;
  font-weight: 700;
  white-space: nowrap;
}
.user-name { overflow: hidden; text-overflow: ellipsis; }
.user-role::before { content: " · "; }
.mobile-nav-strip {
  grid-column: 1 / -1;
  position: sticky;
  top: calc(var(--demo-offset) + var(--topbar-height));
  z-index: 22;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(108px, 140px);
  gap: .5rem;
  min-height: var(--mobile-strip-height);
  padding: .42rem max(.75rem, env(safe-area-inset-left)) .42rem max(.75rem, env(safe-area-inset-right));
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  backdrop-filter: blur(16px);
}
.nav-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  min-width: 0;
  min-height: 38px;
  padding: .42rem .58rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-strong);
  color: var(--ink);
  cursor: pointer;
  font-weight: 800;
}
.nav-toggle-main {
  display: inline-flex;
  align-items: center;
  gap: .48rem;
  min-width: 0;
}
.nav-toggle-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-toggle svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  fill: currentColor;
}
.nav-toggle-chevron {
  transition: transform .16s ease;
}
.nav-open .nav-toggle-chevron {
  transform: rotate(180deg);
}
.mobile-year-form { justify-content: end; }
.mobile-year-form select {
  width: 100%;
  min-width: 0;
}
.sidebar {
  position: sticky;
  top: calc(var(--demo-offset) + var(--topbar-height) + var(--mobile-strip-height));
  z-index: 21;
  display: none;
  gap: .35rem;
  max-height: calc(100svh - var(--demo-offset) - var(--topbar-height) - var(--mobile-strip-height));
  overflow: auto;
  padding: .48rem .65rem .65rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 94%, transparent);
  scrollbar-width: none;
}
.nav-open .sidebar { display: grid; }
.sidebar::-webkit-scrollbar { width: 0; height: 0; display: none; }
.sidebar-context { display: none; }
.nav-links {
  display: grid;
  gap: .28rem;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: .65rem;
  text-decoration: none;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: var(--radius);
  padding: .7rem .75rem;
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
  width: 38px;
  height: 38px;
  min-height: 38px;
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
  transition: opacity .14s ease;
}
.main.app-loading {
  opacity: .48;
}
@media (prefers-reduced-motion: reduce) {
  .main { transition: none; }
}
.app-footer {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .8rem max(.85rem, env(safe-area-inset-left)) max(.9rem, env(safe-area-inset-bottom)) max(.85rem, env(safe-area-inset-right));
  border-top: 1px solid var(--line);
  color: var(--muted);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  font-size: .78rem;
  font-weight: 750;
}
.app-footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-footer a {
  color: inherit;
  text-decoration: none;
}
.app-footer a:hover { color: var(--accent-dark); }
.app-footer a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 3px;
}
.app-footer strong { color: var(--ink); font-weight: 850; }
.app-footer a:hover strong { color: inherit; }
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
.absence-form {
  gap: .85rem .75rem;
  align-items: end;
}
.absence-form fieldset {
  display: grid;
  gap: .32rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.absence-form legend {
  margin: 0;
  padding: 0;
  color: var(--muted);
  font-size: .86rem;
  font-weight: 650;
}
.choice-group {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: .18rem;
  align-items: center;
  justify-self: start;
  min-height: 42px;
  padding: .18rem;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--paper-strong);
}
.choice-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  gap: 0;
  color: var(--muted);
  font-size: .84rem;
  font-weight: 820;
  cursor: pointer;
}
.choice-pill input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.choice-pill span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: .35rem .6rem;
  border-radius: calc(var(--radius) - 1px);
  line-height: 1;
  white-space: nowrap;
  transition: background .16s ease, color .16s ease, box-shadow .16s ease;
}
.choice-pill input:checked + span {
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 0 0 1px var(--line);
}
.choice-pill input:focus-visible + span {
  outline: 3px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.absence-notes-field textarea {
  min-height: 76px;
}
.absence-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  flex-wrap: wrap;
}
.absence-list-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: .5rem;
  flex-wrap: wrap;
}
.absence-header-filters {
  display: flex;
  align-items: center;
  gap: .38rem;
  flex-wrap: wrap;
}
.absence-filter-label {
  color: var(--muted);
  font-size: .78rem;
  font-weight: 850;
}
.absence-header-filters select {
  width: auto;
  min-width: 112px;
  max-width: min(220px, 58vw);
  min-height: 34px;
  padding: .34rem 1.8rem .34rem .55rem;
  border-color: var(--line);
  background-color: var(--paper-strong);
  color: var(--ink);
  font-size: .82rem;
  font-weight: 760;
}
.absence-header-filters select[name="studentId"] {
  min-width: 180px;
}
.absence-clear-filter {
  min-height: 34px;
  padding: .34rem .55rem;
}
.absence-table th,
.absence-table td {
  vertical-align: middle;
}
.absence-date-cell,
.absence-grade-cell,
.absence-kind-cell,
.absence-amount-cell {
  white-space: nowrap;
}
.absence-student-cell {
  font-weight: 750;
}
.absence-grade-cell {
  color: var(--muted);
  font-size: .84rem;
  font-weight: 820;
}
.absence-kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  min-width: 70px;
  padding: .16rem .52rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper-strong);
  color: var(--muted);
  font-size: .78rem;
  font-weight: 850;
}
.absence-kind.absence {
  border-color: color-mix(in srgb, var(--red) 34%, var(--line));
  background: color-mix(in srgb, var(--red) 8%, var(--paper));
  color: var(--red);
}
.absence-kind.tardy {
  border-color: color-mix(in srgb, var(--gold) 42%, var(--line));
  background: color-mix(in srgb, var(--gold) 10%, var(--paper));
  color: var(--gold);
}
.family-form-section {
  grid-column: 1 / -1;
  display: grid;
  gap: .7rem;
  padding-top: .15rem;
}
.family-form-section + .family-form-section {
  margin-top: .25rem;
  padding-top: .85rem;
  border-top: 1px solid var(--line);
}
.family-form-section h3 {
  margin: 0;
  color: var(--ink);
  font-size: .92rem;
  letter-spacing: 0;
}
.family-form-section-grid {
  display: grid;
  gap: .7rem;
  grid-template-columns: 1fr;
}
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-height: 42px;
  height: auto;
  justify-self: start;
  align-self: end;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  padding: .62rem .85rem;
  cursor: pointer;
}
.form-grid button[type="submit"] {
  grid-column: auto;
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
.assignment-history-panel {
  align-self: start;
}
.assignment-history-list {
  display: grid;
}
.history-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .65rem;
  align-items: center;
  padding: .78rem .9rem;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--line);
  transition: background .16s ease, color .16s ease;
}
.history-link:last-child { border-bottom: 0; }
.history-link:hover {
  background: color-mix(in srgb, var(--accent-soft) 52%, var(--paper));
}
.history-link.active {
  background: var(--accent-soft);
  color: var(--accent-dark);
}
.history-main,
.history-side {
  display: grid;
  gap: .18rem;
  min-width: 0;
}
.history-main b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .9rem;
}
.history-main small,
.history-side small {
  color: var(--muted);
  font-size: .76rem;
  font-weight: 700;
  white-space: nowrap;
}
.history-side {
  justify-items: end;
}
.history-side .badge {
  margin: 0;
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
.gradebook-score-panel {
  min-width: 0;
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
.gradebook-layout-toggle {
  display: inline-flex;
  align-items: center;
  gap: .5rem;
  min-height: 42px;
  color: var(--muted);
  font-size: .86rem;
  font-weight: 850;
  white-space: nowrap;
}
.gradebook-layout-toggle strong {
  color: var(--ink);
  min-width: 24px;
}
.gradebook-grid-workspace {
  gap: .7rem;
}
.gb-grid-shell {
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: var(--shadow);
}
.gb-grid-shell.letters-hidden .gb-cell-letter,
.gb-grid-shell.letters-hidden .gb-grid-average sup,
.gb-grid-shell.letters-hidden .gb-grid-student sup,
.gb-grid-shell.letters-hidden .gb-grid-class-row sup {
  display: none;
}
.gb-grid-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 190px)) minmax(300px, 1fr) minmax(110px, 140px) minmax(96px, 110px);
  gap: .62rem;
  align-items: end;
  padding: .65rem .75rem;
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
  border-bottom: 1px solid var(--line);
}
.gb-grid-toolbar label {
  color: var(--ink);
  font-size: .72rem;
  font-weight: 850;
}
.gb-grid-toolbar select {
  min-height: 30px;
  padding: .3rem .45rem;
  border-color: var(--line-strong);
  background: var(--paper);
  color: var(--ink);
}
.gb-toolbar-check .check-row {
  min-height: 30px;
  padding: .3rem .45rem;
  border-color: var(--line-strong);
  background: var(--paper);
  font-size: .78rem;
  font-weight: 850;
}
.gb-type-legend {
  display: flex;
  align-items: center;
  gap: .45rem;
  min-height: 32px;
  color: var(--ink);
  font-size: .78rem;
  white-space: nowrap;
  overflow: auto;
  scrollbar-width: none;
}
.gb-type-legend::-webkit-scrollbar { display: none; }
.gb-type-legend b {
  margin-right: .4rem;
  font-size: .72rem;
}
.legend-box {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: .18rem;
  vertical-align: -2px;
}
.legend-box.lesson { background: #111827; }
.legend-box.quiz { background: #4778d9; }
.legend-box.test { background: #c43a35; }
.gb-grid-form {
  display: grid;
  min-width: 0;
  background: var(--paper);
}
.gb-grid-scroll {
  width: 100%;
  overflow: auto;
  background: linear-gradient(to bottom, var(--grade-grid-head) 0 126px, var(--paper) 126px);
  scrollbar-color: #a6adba #e5e7eb;
  scrollbar-width: thin;
}
.gb-grid-stage {
  position: relative;
  width: max-content;
  min-width: 100%;
}
.gb-grid-header-overlay {
  position: absolute;
  top: 0;
  left: 150px;
  z-index: calc(var(--gb-assignment-count) + 20);
  width: calc((var(--gb-assignment-count) + 1) * 54px);
  height: 126px;
  pointer-events: none;
}
.gb-header-svg {
  display: block;
  width: 100%;
  height: 126px;
  overflow: visible;
}
.gb-header-svg line {
  stroke: var(--grade-grid-head-line);
  stroke-width: 1;
}
.gb-header-svg text {
  fill: var(--grade-grid-head-ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
}
.gb-header-add {
  position: absolute;
  top: 0;
  left: calc(var(--gb-assignment-count) * 54px);
  width: 54px;
  height: 126px;
  pointer-events: auto;
}
.gb-header-add::after {
  content: "";
  position: absolute;
  left: -0.5px;
  bottom: 30px;
  width: 1px;
  height: 117px;
  background: var(--grade-grid-head-line);
  transform: rotate(43deg);
  transform-origin: bottom center;
  pointer-events: none;
}
.gb-grid-table {
  min-width: max-content;
  width: max-content;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  color: var(--ink);
  font-size: .82rem;
  line-height: 1.1;
}
.gb-grid-student-col { width: 150px; }
.gb-grid-score-col { width: 54px; }
.gb-grid-table th,
.gb-grid-table td {
  width: 54px;
  min-width: 54px;
  height: 40px;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  text-align: center;
  vertical-align: middle;
  overflow: visible;
  background: var(--paper);
}
.gb-grid-table thead th {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--grade-grid-head);
  color: var(--grade-grid-head-ink);
  font-weight: 800;
}
.gb-grid-top-row th {
  height: 96px;
  border-right-color: transparent;
  border-bottom: 0;
}
.gb-grid-icon-row th {
  top: 96px;
  height: 30px;
  border-top: 1px solid color-mix(in srgb, var(--grade-grid-head-line) 45%, transparent);
  border-right-color: transparent;
}
.gb-grid-assignment {
  position: relative;
  z-index: var(--gb-header-z, 4) !important;
  vertical-align: bottom;
  overflow: visible !important;
}
.gb-grid-assignment::before {
  content: none;
}
.gb-grid-assignment::after {
  content: none;
}
.gb-grid-assignment a {
  display: none;
}
.gb-grid-assignment span {
  display: none;
}
.gb-grid-icon-row a,
.gb-grid-add a {
  color: #4f8df5;
  font-size: .72rem;
  font-weight: 850;
  text-decoration: none;
}
.gb-edit-icon {
  width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #4f8df5;
  cursor: pointer;
}
.gb-edit-icon svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}
.gb-grid-add a {
  color: #16a34a;
  font-size: 1.15rem;
}
.gb-grid-add {
  position: relative;
}
.gb-grid-add-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, #16a34a 55%, var(--grade-grid-head-line));
  background: color-mix(in srgb, #16a34a 14%, var(--grade-grid-head));
  border-radius: 4px;
  cursor: pointer;
  color: var(--grade-grid-head-ink);
  font-weight: 950;
}
.gb-grid-add-btn:hover {
  background: color-mix(in srgb, #16a34a 24%, var(--grade-grid-head));
}
.gb-grid-year,
.gb-grid-student,
.gb-grid-table tbody th {
  position: sticky;
  left: 0;
  z-index: 5;
  width: 150px !important;
  min-width: 150px !important;
  padding: .38rem .55rem !important;
  text-align: right !important;
  background: var(--grade-grid-band-strong) !important;
  color: var(--grade-grid-band-ink) !important;
  border-right: 1px solid color-mix(in srgb, var(--grade-grid-band) 70%, #000) !important;
}
.gb-grid-year {
  top: 0;
  z-index: 7;
  height: 126px !important;
  text-align: center !important;
  background: var(--grade-grid-head) !important;
}
.gb-grid-year:empty::before {
  content: "";
  display: block;
  min-height: 1px;
}
.gb-grid-year span {
  display: block;
  margin: .25rem 0 1.4rem;
  font-weight: 850;
}
.gb-grid-year label {
  display: flex;
  align-items: center;
  gap: .34rem;
  margin: .2rem 0;
  color: var(--grade-grid-head-ink);
  font-size: .76rem;
  font-weight: 750;
}
.gb-grid-year input[type="checkbox"] {
  accent-color: var(--accent);
}
.gb-grid-table tbody th span {
  margin-left: .25rem;
  font-size: .76rem;
  font-weight: 900;
}
.gb-grid-class-row th,
.gb-grid-class-row td,
.gb-grid-points-row th,
.gb-grid-points-row td {
  background: var(--grade-grid-band) !important;
  color: var(--grade-grid-band-ink) !important;
  border-bottom-color: color-mix(in srgb, var(--grade-grid-band) 70%, var(--line));
}
.gb-grid-class-row th {
  text-align: left !important;
  padding-left: 1rem !important;
}
.gb-grid-points-row th {
  background: var(--grade-grid-band-strong) !important;
}
.gb-grid-points-row td {
  background: var(--grade-grid-band) !important;
  font-weight: 850;
}
.gb-grid-table tbody tr:nth-child(odd) td {
  background: color-mix(in srgb, var(--paper-strong) 70%, var(--bg));
}
.gb-grid-table tbody tr:nth-child(even) td {
  background: var(--paper);
}
.gb-grid-score-cell {
  position: relative;
  overflow: hidden !important;
}
.gb-grid-score-cell input {
  width: calc(100% - 13px);
  height: 100%;
  min-height: 40px;
  padding: .1rem 0 .1rem .08rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  text-align: right;
  font-size: .78rem;
  font-weight: 760;
  appearance: textfield;
  -moz-appearance: textfield;
}
.gb-grid-score-cell input::-webkit-outer-spin-button,
.gb-grid-score-cell input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
.gb-grid-score-cell input:focus {
  position: relative;
  z-index: 3;
  outline: 2px solid #2563eb;
  background: var(--paper);
}
.gb-cell-letter {
  position: absolute;
  right: .12rem;
  top: .26rem;
  color: var(--ink);
  font-size: .62rem;
  font-weight: 850;
  line-height: 1;
  pointer-events: none;
}
.gb-cell-status {
  position: absolute;
  left: .18rem;
  bottom: .12rem;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  opacity: 0;
  pointer-events: none;
}
.gb-grid-score-cell.saving .gb-cell-status {
  opacity: 1;
  background: #f59e0b;
}
.gb-grid-score-cell.saved .gb-cell-status {
  opacity: 1;
  background: #16a34a;
  animation: saveFade .9s ease forwards;
}
.gb-grid-score-cell.save-error .gb-cell-status {
  opacity: 1;
  background: #dc2626;
}
@keyframes saveFade {
  0%, 55% { opacity: 1; }
  100% { opacity: 0; }
}
.gb-type-quiz input,
.gb-type-quiz .gb-cell-letter,
.gb-grid-average.gb-type-quiz {
  color: #2563eb;
}
.gb-type-test input,
.gb-type-test .gb-cell-letter,
.gb-grid-average.gb-type-test {
  color: #dc2626;
}
.gb-grid-average {
  font-weight: 850;
}
.gb-grid-average sup,
.gb-grid-student sup,
.gb-grid-class-row sup {
  font-size: .62em;
  margin-left: .05rem;
}
.gb-grid-footer {
  position: sticky;
  bottom: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .75rem;
  padding: .55rem .75rem;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 72%, var(--bg));
  color: var(--muted);
  font-size: .82rem;
  font-weight: 800;
}
.assignment-dialog {
  width: min(720px, calc(100vw - 2rem));
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0;
  color: var(--ink);
  background: var(--paper);
  box-shadow: 0 24px 80px rgba(16, 24, 40, .3);
}
.assignment-dialog::backdrop {
  background: rgba(17, 24, 39, .68);
}
.assignment-dialog-form {
  display: grid;
}
.assignment-dialog-head {
  display: flex;
  align-items: center;
  gap: .7rem;
  padding: 1rem 1.15rem;
  border-bottom: 1px solid var(--line);
}
.assignment-dialog-head span,
.assignment-dialog-head svg {
  width: 26px;
  height: 26px;
  fill: var(--ink);
}
.assignment-dialog-head h3 {
  margin: 0;
  font-size: 1.1rem;
}
.assignment-dialog-body {
  display: grid;
  gap: 1rem;
  padding: 1.15rem;
}
.assignment-dialog-grid {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(120px, .75fr) minmax(140px, .75fr);
  gap: .9rem;
  align-items: start;
}
.assignment-dialog fieldset {
  display: grid;
  gap: .7rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.assignment-dialog legend {
  margin-bottom: .25rem;
  color: var(--ink);
  font-size: .86rem;
  font-weight: 850;
}
.assignment-type-radio {
  display: flex;
  align-items: center;
  gap: .5rem;
  min-height: 30px;
  color: var(--ink);
  font-weight: 500;
}
.assignment-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: .65rem;
  padding: .85rem 1.15rem;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper-strong) 70%, var(--bg));
}
.assignment-dialog-actions .danger-action {
  margin-right: auto;
  border-color: var(--red);
  color: var(--red);
}
.letter-grade-edit-table input {
  min-height: 34px;
  padding: .38rem .5rem;
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
.assignments-layout .family-list {
  align-self: start;
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
.asgn-link {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .24rem .5rem;
  align-items: center;
  padding: .68rem .75rem;
}
.asgn-link .asgn-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 720;
  font-size: .88rem;
}
.asgn-link .asgn-meta {
  color: var(--muted);
  font-size: .75rem;
  white-space: nowrap;
  grid-column: 1;
}
.asgn-link .badge {
  grid-column: 2;
  grid-row: 1 / span 2;
  margin: 0;
  white-space: nowrap;
}
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
.update-status {
  display: grid;
  gap: .65rem;
  padding: .75rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.update-status-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .75rem;
}
.update-status-head strong { font-size: .95rem; }
.update-status-head span { color: var(--muted); font-size: .8rem; font-weight: 800; }
.progress-track {
  height: 12px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  background: var(--paper);
}
.progress-fill {
  height: 100%;
  width: var(--progress-value);
  background: var(--accent);
  transition: width .2s ease;
}
.update-log {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: .65rem;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: .78rem;
  white-space: pre-wrap;
}
.update-actions {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: .65rem;
}
.update-actions label {
  min-width: min(260px, 100%);
}
.update-actions button {
  min-height: 38px;
}
.backup-list {
  display: grid;
  gap: .55rem;
}
.backup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .75rem;
  align-items: center;
  padding: .65rem;
  border: 1px solid var(--line);
  background: var(--paper-strong);
}
.backup-row strong { display: block; font-size: .88rem; overflow-wrap: anywhere; }
.backup-row span { display: block; color: var(--muted); font-size: .78rem; }
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
.bar-list,
.distribution {
  display: grid;
  gap: .55rem;
}
.bar-row,
.distribution-row {
  --bar-color: var(--accent);
  display: grid;
  grid-template-columns: minmax(92px, .42fr) minmax(0, 1fr) minmax(34px, auto);
  align-items: center;
  gap: .65rem;
  min-height: 34px;
  padding: .26rem .36rem;
  border: 1px solid color-mix(in srgb, var(--bar-color) 16%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--bar-color) 5%, var(--paper));
}
.distribution-row {
  grid-template-columns: 56px minmax(0, 1fr) minmax(34px, auto);
}
.bar-row b,
.distribution-row b {
  color: var(--ink);
  font-size: .84rem;
  font-weight: 820;
  overflow-wrap: anywhere;
}
.bar-track {
  height: 18px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--bar-color) 22%, var(--line));
  border-radius: 999px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--bar-color) 8%, transparent), transparent),
    var(--paper-strong);
  box-shadow: inset 0 1px 2px rgba(16, 24, 40, .08);
}
.bar-fill {
  height: 100%;
  width: var(--bar-value);
  border-radius: inherit;
  background: linear-gradient(90deg, var(--bar-color), color-mix(in srgb, var(--bar-color) 76%, #111827));
  transition: width .35s ease;
}
.bar-fill.good { --bar-color: var(--accent); }
.bar-fill.watch { --bar-color: var(--gold); }
.bar-fill.low { --bar-color: var(--red); }
.bar-row span,
.distribution-row span {
  display: inline-flex;
  justify-content: center;
  min-width: 2rem;
  padding: .12rem .42rem;
  border: 1px solid color-mix(in srgb, var(--bar-color) 24%, var(--line));
  border-radius: 999px;
  background: color-mix(in srgb, var(--bar-color) 10%, var(--paper-strong));
  color: var(--ink);
  font-size: .78rem;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.report-nav-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: .65rem;
}
.report-tile {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: .72rem;
  min-height: 104px;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  background: var(--paper-strong);
  text-decoration: none;
  transition: transform .16s ease, border-color .16s ease, background .16s ease;
}
.report-tile:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line));
  background: color-mix(in srgb, var(--accent-soft) 46%, var(--paper));
}
.report-tile.active {
  border-color: color-mix(in srgb, var(--accent) 56%, var(--line));
  background: var(--accent-soft);
}
.report-tile-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-soft) 56%, var(--paper));
  color: var(--accent-dark);
}
.report-tile-icon svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.report-tile:hover .report-tile-icon,
.report-tile.active .report-tile-icon {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--line));
  background: var(--paper);
}
.report-tile-copy {
  display: grid;
  gap: .28rem;
  min-width: 0;
}
.report-tile strong { font-size: .95rem; }
.report-tile-copy span { color: var(--muted); font-size: .82rem; line-height: 1.4; }
.report-kpis {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .65rem;
}
.report-kpi {
  display: grid;
  gap: .28rem;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.report-kpi span { color: var(--muted); font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .025em; }
.report-kpi strong { font-size: 1.45rem; line-height: 1; }
.print-report-head {
  display: none;
}
.report-section-list {
  display: grid;
  gap: 1rem;
}
.report-grade-section {
  display: grid;
  gap: .65rem;
}
.report-grade-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .8rem;
  padding: .35rem 0;
  border-bottom: 1px solid var(--line);
}
.report-grade-head h3 { margin: 0; font-size: 1rem; }
.report-grade-head span { color: var(--muted); font-size: .84rem; font-weight: 750; }
.month-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: .75rem;
}
.month-block {
  display: grid;
  align-content: start;
  gap: .55rem;
  min-height: 128px;
  padding: .85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.month-block h3 {
  margin: 0;
  font-size: .9rem;
}
.birthday-list {
  display: grid;
  gap: .4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.birthday-list li {
  display: grid;
  gap: .12rem;
  padding-top: .4rem;
  border-top: 1px solid var(--line);
  font-size: .86rem;
}
.birthday-list li:first-child { border-top: 0; padding-top: 0; }
.birthday-list span { color: var(--muted); font-size: .78rem; }
.birthday-date { font-variant-numeric: tabular-nums; }
.board-report-list {
  display: grid;
  gap: .95rem;
  padding: .95rem;
}
.board-report-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(140px, .7fr) minmax(160px, .8fr);
  gap: 1rem;
  align-items: start;
}
.board-report-row strong { display: block; font-size: .92rem; }
.board-report-row span {
  display: block;
  color: var(--muted);
  font-size: .84rem;
  line-height: 1.38;
}
.grade-graph {
  display: grid;
  gap: .8rem;
}
.grade-graph-screen {
  display: grid;
  gap: .8rem;
}
.grade-graph-svg {
  width: 100%;
  min-height: 260px;
  display: block;
  overflow: visible;
}
.grade-graph-svg .guide { stroke: var(--line); stroke-dasharray: 4 4; }
.grade-graph-svg .axis { stroke: var(--line-strong); }
.grade-graph-svg .label { fill: var(--muted); font-size: 11px; font-family: inherit; }
.grade-graph-svg .line {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.grade-graph-svg .dot { stroke: var(--paper); stroke-width: 2; }
.grade-graph-svg .empty-msg { fill: var(--muted); font-size: 13px; text-anchor: middle; font-family: inherit; }
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: .45rem .75rem;
}
.graph-legend span {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--muted);
  font-size: .82rem;
  font-weight: 750;
}
.graph-legend i {
  width: 22px;
  height: 3px;
  border-radius: 999px;
  background: var(--legend-color);
}
.grade-graph-print-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: .9rem 1rem;
}
.grade-graph-print-grid.single {
  grid-template-columns: 1fr;
}
.mini-subject-chart {
  display: grid;
  gap: .42rem;
  min-width: 0;
  padding: .82rem;
  border: 1px solid var(--line);
  border-left: 4px solid var(--subject-color, var(--accent));
  border-radius: 8px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--subject-color, var(--accent)) 5%, transparent), transparent 46%),
    var(--paper-strong);
}
.mini-subject-chart header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: .5rem;
  padding-bottom: .12rem;
  border-bottom: 1px solid var(--line-strong);
}
.mini-subject-chart h3 {
  margin: 0;
  color: var(--ink);
  font-size: .92rem;
}
.mini-subject-chart span {
  color: var(--muted);
  font-size: .76rem;
  font-weight: 750;
  white-space: nowrap;
}
.mini-subject-chart svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}
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
  .top-actions { justify-content: end; }
  .main { padding: 1.2rem 1rem 4rem; }
  .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .form-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .form-grid.five { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .absence-form {
    grid-template-columns: 170px minmax(260px, 1fr);
  }
  .absence-date-field { grid-column: 1; }
  .absence-student-field { grid-column: 2; }
  .absence-notes-field { grid-column: 1 / -1; }
  .family-form-section-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .filters { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }
  .compact-filters { grid-template-columns: repeat(auto-fill, minmax(130px, 180px)); }
  .class-average-callout { min-width: 190px; }
  .score-row { grid-template-columns: minmax(220px, 1fr) 120px; }
  .asset-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-nav-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .report-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (min-width: 1040px) {
  .app { grid-template-columns: 168px 1fr; max-width: none; }
  .topbar { grid-column: 1 / -1; }
  .mobile-nav-strip { display: none; }
  .sidebar {
    display: grid;
    position: sticky;
    top: calc(var(--demo-offset) + var(--topbar-height));
    height: calc(100svh - var(--demo-offset) - var(--topbar-height));
    max-height: none;
    align-self: start;
    grid-auto-flow: row;
    grid-auto-columns: auto;
    align-content: start;
    border-right: 1px solid var(--line);
    border-bottom: 0;
    padding: .8rem .65rem;
  }
  .sidebar-context {
    display: grid;
    gap: .55rem;
    margin-bottom: .35rem;
    padding: .05rem .1rem .75rem;
    border-bottom: 1px solid var(--line);
  }
  .sidebar-context .year-form select { width: 100%; }
  .nav-link { border-radius: var(--radius); }
  .main { padding: 1.35rem 1.35rem 4rem; }
  .app-footer { grid-column: 2; }
  .split { grid-template-columns: minmax(0, 1.2fr) minmax(330px, .8fr); align-items: start; }
  .gradebook-split {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
    grid-template-areas: "scores history";
  }
  .absence-form {
    grid-template-columns: 170px minmax(260px, 420px) max-content 104px max-content;
  }
  .absence-notes-field {
    grid-column: 1 / 3;
    max-width: 620px;
  }
  .absence-submit {
    grid-column: 3;
    justify-self: start;
    min-width: 136px;
  }
  .gradebook-score-panel { grid-area: scores; }
  .assignment-history-panel { grid-area: history; }
  .kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .family-layout { grid-template-columns: 320px minmax(0, 1fr); align-items: start; }
  .assignments-layout { grid-template-columns: minmax(270px, 34%) minmax(0, 1fr); align-items: start; }
  .family-module-grid { grid-template-columns: 300px minmax(0, 1fr); align-items: start; }
  .setup-layout { grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
  .sidebar-utility { margin-top: auto; padding-top: .75rem; border-top: 1px solid var(--line); }
}
@media (min-width: 1280px) {
  .assignments-layout { grid-template-columns: minmax(280px, 32%) minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .topbar { gap: .5rem; }
  .brand { gap: .5rem; }
  .brand img { width: 34px; height: 30px; }
  .brand-text span { display: none; }
  .top-actions { gap: .35rem; }
  .user-chip { max-width: 112px; }
  .user-role { display: none; }
  .logout-btn { padding: .36rem .5rem; }
  .page-head { align-items: stretch; flex-direction: column; }
  .detail-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .main { padding: .8rem .7rem 2.4rem; }
  .workspace { gap: .8rem; }
  .page-head { gap: .45rem; padding-top: .15rem; }
  .page-head h1 { font-size: 1.42rem; }
  .page-head p { font-size: .94rem; line-height: 1.38; }
  .panel, .ledger, .chart-panel, .family-list, .family-detail, .setup-nav { border-radius: 10px; }
  .kpis { gap: .55rem; }
  .kpi { padding: .72rem; border-radius: 10px; }
  .kpi strong { font-size: 1.36rem; }
  .kpi span { font-size: .78rem; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .table-wrap table { min-width: 620px; }
  .compact-table table { min-width: 0; }
  .chart-head { align-items: start; }
  .mobile-nav-strip { grid-template-columns: minmax(0, 1fr) minmax(104px, 124px); }
}
@media (max-width: 390px) {
  .topbar { padding-inline: max(.65rem, env(safe-area-inset-left)) max(.65rem, env(safe-area-inset-right)); }
  .user-chip { max-width: 86px; font-size: .78rem; }
  .logout-btn { font-size: .78rem; padding-inline: .42rem; }
  .mobile-nav-strip { padding-inline: max(.65rem, env(safe-area-inset-left)) max(.65rem, env(safe-area-inset-right)); grid-template-columns: minmax(0, 1fr) 108px; }
}
@media print {
  @page { size: letter portrait; margin: .48in .55in; }
  @page report-card-page { size: letter landscape; margin: 0; }
  html, body { width: auto; margin: 0; background: #fff; color: #000; }
  .demo-banner, .topbar, .mobile-nav-strip, .sidebar, .app-footer, .filters, .inline-actions, .quick-scores, .report-card-actions, .panel, .page-head, .report-nav-grid { display: none !important; }
  .app { display: block; width: 100%; }
  .main { padding: 0; }
  .workspace,
  .grade-graph-report,
  .grade-graph {
    display: block;
  }
  .print-report-head {
    display: block;
    margin: 0 0 .22in;
    text-align: center;
    color: #000;
  }
  .print-report-head h1 {
    margin: 0;
    font-size: 18pt;
    line-height: 1.15;
  }
  .print-report-head p {
    margin: .03in 0 0;
    font-size: 10pt;
    color: #222;
  }
  .panel, .ledger, .kpi, .chart-panel, .month-block, .report-kpi {
    box-shadow: none;
    break-inside: avoid;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .grade-graph.chart-panel {
    margin: 0;
    padding: 0;
    break-inside: auto;
    break-before: avoid;
    page-break-before: avoid;
    page-break-inside: auto;
  }
  .grade-graph-report .print-report-head {
    margin-bottom: .08in;
    break-after: avoid;
    page-break-after: avoid;
  }
  .ledger-head, .chart-head { display: none; }
  th, td {
    border-bottom-color: #cfcfcf;
    padding: .05in .06in;
    color: #000;
    font-size: 9.5pt;
  }
  th {
    background: transparent;
    color: #000;
    font-size: 8.5pt;
  }
  .student-report .family-detail-body,
  .birthday-report .family-detail-body { padding: 0; }
  .student-report .report-section-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .08in .42in;
    align-items: start;
  }
  .student-report .report-grade-section {
    gap: 0;
    break-inside: avoid;
  }
  .student-report .report-grade-head {
    padding: .02in 0;
    border-bottom: 1px solid #c8c8c8;
  }
  .student-report .report-grade-head h3,
  .month-block h3 {
    font-size: 10pt;
    font-weight: 800;
  }
  .student-report .report-grade-head span,
  .month-block h3 span {
    color: #000;
    font-size: 9pt;
    font-weight: 400;
  }
  .student-report th,
  .student-report td:nth-child(3),
  .student-report td:nth-child(4) { display: none; }
  .student-report td {
    border: 0;
    padding: .01in 0;
    font-size: 9.2pt;
  }
  .student-report td:nth-child(2) {
    display: table-cell;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .month-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .16in .52in;
  }
  .month-block {
    min-height: 0;
    padding: 0;
  }
  .month-block h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 .04in;
    padding: 0 0 .02in;
    border-bottom: 1px solid #c8c8c8;
  }
  .birthday-list {
    gap: 0;
  }
  .birthday-list li {
    grid-template-columns: minmax(0, 1fr) .95in;
    gap: .12in;
    border: 0;
    padding: .01in 0;
    font-size: 9.2pt;
  }
  .birthday-list span {
    color: #000;
    font-size: 9.2pt;
    text-align: right;
  }
  .birthday-meta { display: none !important; }
  .board-report-list {
    gap: .18in;
    padding: 0;
  }
  .board-report-row {
    grid-template-columns: minmax(2.4in, 1fr) 1.55in minmax(1.8in, 1fr);
    gap: .32in;
    break-inside: avoid;
  }
  .board-report-row strong,
  .board-report-row span {
    color: #000;
    font-size: 10pt;
  }
  .board-report-row strong { font-weight: 800; }
  .grade-graph-screen { display: none; }
  .grade-graph-print-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: .06in .24in;
    margin: 0;
    break-before: avoid;
    page-break-before: avoid;
  }
  .grade-graph-print-grid.single {
    grid-template-columns: 1fr;
  }
  .mini-subject-chart {
    break-inside: avoid;
    page-break-inside: avoid;
    padding: 0;
    border: 0;
    background: transparent;
  }
  .mini-subject-chart header {
    gap: .08in;
    padding-bottom: .01in;
  }
  .mini-subject-chart h3 { font-size: 9.3pt; }
  .mini-subject-chart span { color: #333; font-size: 7.6pt; }
  .mini-subject-chart svg text { font-family: Arial, sans-serif; }
  body.report-card-printing { page: report-card-page; width: 11in; }
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
  ${DEMO_MODE ? `<div class="demo-banner">DEMO MODE. Data will reset every ${DEMO_REFRESH_HOURS} ${DEMO_REFRESH_HOURS === 1 ? 'hr' : 'hrs'}</div>` : ''}
  <header class="topbar">
    <div class="brand-row">
      <a class="brand" href="/">
        <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
        <span class="brand-text"><strong>${esc(settings.schoolName)}</strong><span>Rooted Records for Growing Minds</span></span>
      </a>
    </div>
    <div class="top-actions">
      ${user ? `<span class="user-chip"><span class="user-name">${esc(user.name)}</span><span class="user-role">${roleLabel(user.role)}</span></span>
        <form class="logout-form" method="post" action="/logout">${csrfInput(csrfToken)}<button class="logout-btn" type="submit">Log out</button></form>` : ''}
    </div>
  </header>
  ${user ? `<div class="mobile-nav-strip">
    <button id="navToggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="primaryNav">
      <span class="nav-toggle-main">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"></path></svg>
        <span>${esc(activeNav?.label || 'Menu')}</span>
      </span>
      <svg class="nav-toggle-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5H7Z"></path></svg>
    </button>
    ${yearSwitcher('mobile-year-form')}
  </div>
  <nav id="primaryNav" class="sidebar" aria-label="Primary">
    <div class="sidebar-context">
      ${yearSwitcher('sidebar-year-form')}
    </div>
    <div class="nav-links">
      ${navMarkup}
    </div>
    <div class="sidebar-utility">
      <button id="themeToggle" class="theme-icon-btn" type="button" title="Toggle theme" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"></path></svg>
      </button>
    </div>
  </nav>` : ''}
  <main class="main" data-app-main>${content}</main>
  <footer class="app-footer"><span>${esc(settings.schoolName)}</span><span><a href="${esc(APP_REPOSITORY_URL)}" target="_blank" rel="noopener noreferrer"><strong>Oakstead</strong> v${esc(APP_VERSION)}</a></span></footer>
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
  const gridTimers = new WeakMap();
  let gridSaveQueue = Promise.resolve();
  let activeScoreInput = null;
  let navAbort = null;
  if (saved === 'dark') root.setAttribute('data-theme', 'dark');

  function mainEl() {
    return document.querySelector('[data-app-main]') || document.querySelector('.main');
  }

  function setMobileNav(open) {
    const navToggle = document.getElementById('navToggle');
    document.body.classList.toggle('nav-open', open);
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function canUseAppNav(url) {
    return url.origin === window.location.origin
      && !url.pathname.startsWith('/assets/')
      && url.pathname !== '/backup/download'
      && url.pathname !== '/system-update/status';
  }

  function isSamePageHash(url) {
    return url.hash && url.pathname === window.location.pathname && url.search === window.location.search;
  }

  function updateShellFrom(doc) {
    const currentNav = document.querySelector('.nav-links');
    const nextNav = doc.querySelector('.nav-links');
    if (currentNav && nextNav) currentNav.innerHTML = nextNav.innerHTML;
    const currentMobileLabel = document.querySelector('#navToggle .nav-toggle-main span');
    const nextMobileLabel = doc.querySelector('#navToggle .nav-toggle-main span');
    if (currentMobileLabel && nextMobileLabel) currentMobileLabel.textContent = nextMobileLabel.textContent;
  }

  function navigateApp(to, options) {
    options = options || {};
    const nextUrl = new URL(to, window.location.href);
    if (!canUseAppNav(nextUrl)) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    const currentMain = mainEl();
    if (!currentMain) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    if (navAbort) navAbort.abort();
    navAbort = new AbortController();
    currentMain.classList.add('app-loading');
    return fetch(nextUrl.toString(), {
      signal: navAbort.signal,
      headers: { Accept: 'text/html', 'X-Requested-With': 'Oakstead-App-Shell' }
    }).then(function(response) {
      if (!response.ok) throw new Error('Navigation failed');
      return response.text().then(function(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nextMain = doc.querySelector('[data-app-main]') || doc.querySelector('.main');
        if (!nextMain) {
          window.location.href = response.url || nextUrl.toString();
          return false;
        }
        document.title = doc.title || document.title;
        updateShellFrom(doc);
        const liveMain = mainEl();
        liveMain.replaceWith(document.importNode(nextMain, true));
        if (options.push !== false) history.pushState({ oaksteadApp: true }, '', nextUrl.toString());
        if (options.scroll !== false) window.scrollTo(0, 0);
        setMobileNav(false);
        initDynamicContent(mainEl());
        return true;
      });
    }).catch(function(error) {
      if (error.name === 'AbortError') return false;
      window.location.href = nextUrl.toString();
      return false;
    }).finally(function() {
      const liveMain = mainEl();
      if (liveMain) liveMain.classList.remove('app-loading');
    });
  }

  function formToUrl(form) {
    const url = new URL(form.getAttribute('action') || window.location.href, window.location.href);
    url.search = '';
    new FormData(form).forEach(function(value, key) {
      if (key) url.searchParams.append(key, value);
    });
    return url;
  }

  function submitFormSmoothly(form, options) {
    if (!form) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) {
      form.submit();
      return;
    }
    navigateApp(formToUrl(form), options);
  }

  function goToUrl(url, options) {
    const nextUrl = new URL(url, window.location.href);
    if (canUseAppNav(nextUrl)) navigateApp(nextUrl, options);
    else window.location.href = nextUrl.toString();
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function(){
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
      localStorage.setItem('oakstead-theme', next);
    });
  }

  const navToggle = document.getElementById('navToggle');
  const primaryNav = document.getElementById('primaryNav');
  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', function(event) {
      event.stopPropagation();
      setMobileNav(!document.body.classList.contains('nav-open'));
    });
    primaryNav.addEventListener('click', function(event) {
      if (event.target.closest('a')) setMobileNav(false);
    });
    document.addEventListener('click', function(event) {
      if (!document.body.classList.contains('nav-open')) return;
      if (primaryNav.contains(event.target) || navToggle.contains(event.target)) return;
      setMobileNav(false);
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setMobileNav(false);
    });
  }

  document.querySelectorAll('.year-form select').forEach(function(select) {
    select.addEventListener('change', function() {
      select.form.submit();
    });
  });

  document.addEventListener('click', function(event) {
    const closeButton = event.target.closest('[data-dialog-close]');
    if (closeButton) {
      closeButton.closest('dialog')?.close();
      return;
    }
    const dialogButton = event.target.closest('[data-dialog-target]');
    if (dialogButton) {
      const dialog = document.getElementById(dialogButton.dataset.dialogTarget);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      return;
    }
    if (event.target.matches('.assignment-dialog')) {
      event.target.close();
      return;
    }
    const scoreChip = event.target.closest('[data-score-chip]');
    if (scoreChip) {
      const target = activeScoreInput || document.querySelector('[data-score-input]');
      if (!target) return;
      target.value = scoreChip.dataset.scoreChip;
      updateScorePreview(target);
      const next = target.closest('.score-row')?.nextElementSibling?.querySelector('[data-score-input]');
      if (next) {
        next.focus();
        next.select();
      }
      return;
    }
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target || anchor.hasAttribute('download') || anchor.dataset.noAppNav !== undefined) return;
    const url = new URL(anchor.href, window.location.href);
    if (!canUseAppNav(url) || isSamePageHash(url)) return;
    event.preventDefault();
    navigateApp(url);
  });

  document.addEventListener('submit', function(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) return;
    event.preventDefault();
    navigateApp(formToUrl(form));
  });

  document.addEventListener('change', function(event) {
    const assignmentSelect = event.target.closest('[data-assignment-select]');
    if (assignmentSelect) {
      if (assignmentSelect.dataset.baseUrl) {
        const nextUrl = new URL(assignmentSelect.dataset.baseUrl, window.location.origin);
        if (assignmentSelect.value === '__new__') {
          nextUrl.searchParams.delete('assignmentId');
          nextUrl.searchParams.set('action', 'add');
        } else if (assignmentSelect.value) {
          nextUrl.searchParams.delete('action');
          nextUrl.searchParams.set('assignmentId', assignmentSelect.value);
        }
        goToUrl(nextUrl);
        return;
      }
      if (assignmentSelect.value) {
        submitFormSmoothly(assignmentSelect.form);
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('assignmentId');
        goToUrl(url);
      }
      return;
    }
    const scoreModeToggle = event.target.closest('[data-score-mode-toggle]');
    if (scoreModeToggle) {
      goToUrl(scoreModeToggle.checked ? scoreModeToggle.dataset.wrongUrl : scoreModeToggle.dataset.percentUrl);
      return;
    }
    const gridToggle = event.target.closest('[data-grid-toggle]');
    if (gridToggle) {
      goToUrl(gridToggle.checked ? gridToggle.dataset.onUrl : gridToggle.dataset.offUrl);
      return;
    }
    const lettersToggle = event.target.closest('[data-grid-letters-toggle]');
    if (lettersToggle) {
      syncGridLettersToggle(lettersToggle, true);
      return;
    }
    if (event.target.matches('select[name="groupId"]')) {
      syncRoleOptions(event.target.closest('form'));
      return;
    }
    const gridInput = event.target.closest('[data-grid-score-input]');
    if (gridInput) {
      clearTimeout(gridTimers.get(gridInput));
      autosaveGridInput(gridInput);
      return;
    }
    const auto = event.target.closest('[data-auto-submit]');
    if (auto && auto.form) submitFormSmoothly(auto.form, { scroll: false });
  });

  document.addEventListener('focusin', function(event) {
    if (event.target.matches('[data-score-input]')) {
      activeScoreInput = event.target;
      window.setTimeout(function() { event.target.select?.(); }, 0);
    }
  });

  document.addEventListener('input', function(event) {
    if (event.target.matches('[data-score-input]')) {
      updateScorePreview(event.target);
      return;
    }
    if (event.target.matches('[data-grid-score-input]')) {
      const input = event.target;
      clearTimeout(gridTimers.get(input));
      gridTimers.set(input, setTimeout(function() { autosaveGridInput(input); }, 550));
      return;
    }
    if (event.target.matches('input[name="maxScore"]')) {
      event.target.form?.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    }
  });

  document.addEventListener('keydown', function(event) {
    const input = event.target.closest('[data-grid-score-input]');
    if (!input || event.key !== 'Tab') return;
    const inputs = Array.from(document.querySelectorAll('[data-grid-score-input][data-assignment-id="' + input.dataset.assignmentId + '"]'));
    const index = inputs.indexOf(input);
    const next = inputs[index + (event.shiftKey ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    autosaveGridInput(input);
    next.focus();
    next.select?.();
  });

  window.addEventListener('popstate', function() {
    navigateApp(window.location.href, { push: false, scroll: false });
  });

  history.replaceState({ oaksteadApp: true }, '', window.location.href);

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

  function syncGridLettersToggle(toggle, save) {
    const shell = toggle.closest('.gb-grid-shell');
    if (!save && localStorage.getItem('oakstead-gradebook-letters') === 'off') toggle.checked = false;
    shell?.classList.toggle('letters-hidden', !toggle.checked);
    if (save) localStorage.setItem('oakstead-gradebook-letters', toggle.checked ? 'on' : 'off');
  }

  function markGridCell(input, state) {
    const cell = input.closest('.gb-grid-score-cell');
    if (!cell) return;
    cell.classList.remove('saving', 'saved', 'save-error');
    if (state) cell.classList.add(state);
  }

  function gridHidden(container, name) {
    return container.querySelector('input[name="' + name + '"]')?.value || '';
  }

  function updateGridAverages(result, container) {
    if (!result || !result.display) return;
    const root = container || document;
    const assignmentId = String(result.assignmentId || '');
    const studentId = String(result.studentId || '');
    const assignmentAverage = assignmentId ? root.querySelector('[data-grid-assignment-average="' + assignmentId + '"]') : null;
    const studentAverage = studentId ? root.querySelector('[data-grid-student-average="' + studentId + '"]') : null;
    const classAverage = root.querySelector('[data-grid-class-average]');
    if (assignmentAverage && result.display.assignmentAverage !== undefined) assignmentAverage.innerHTML = result.display.assignmentAverage;
    if (studentAverage && result.display.studentAverage !== undefined) studentAverage.innerHTML = result.display.studentAverage;
    if (classAverage && result.display.classAverage !== undefined) classAverage.innerHTML = result.display.classAverage;
  }

  function autosaveGridInput(input) {
    const container = input.closest('[data-grid-autosave]');
    if (!container || input.value === input.dataset.originalValue) return;
    const valueToSave = input.value;
    gridSaveQueue = gridSaveQueue
      .catch(function() {})
      .then(function() {
        return saveGridInput(input, container, valueToSave);
      });
  }

  function saveGridInput(input, container, valueToSave) {
    if (!input.isConnected || !container.isConnected || valueToSave === input.dataset.originalValue) return Promise.resolve();
    const formData = new FormData();
    formData.set('csrfToken', gridHidden(container, 'csrfToken'));
    formData.set('action', 'grid-score');
    formData.set('schoolYearId', gridHidden(container, 'schoolYearId'));
    formData.set('markingPeriodId', gridHidden(container, 'markingPeriodId'));
    formData.set('gradeLevel', gridHidden(container, 'gradeLevel'));
    formData.set('subjectId', gridHidden(container, 'subjectId'));
    formData.set('scoreMode', gridHidden(container, 'scoreMode'));
    formData.set('assignmentId', input.dataset.assignmentId || '');
    formData.set('studentId', input.dataset.studentId || '');
    formData.set('scoreValue', valueToSave);
    const status = container.querySelector('[data-grid-autosave-status]');
    markGridCell(input, 'saving');
    if (status) status.textContent = 'Saving...';
    return fetch(container.dataset.action || '/gradebook', { method: 'POST', body: formData, headers: { Accept: 'application/json' } })
      .then(function(response) {
        if (!response.ok) throw new Error('Save failed');
        return response.json();
      })
      .then(function(result) {
        if (!input.isConnected || !container.isConnected) return;
        input.dataset.originalValue = valueToSave;
        if (input.value !== valueToSave) return;
        const letter = input.closest('.gb-grid-score-cell')?.querySelector('.gb-cell-letter');
        if (letter && result.letter !== undefined) letter.textContent = result.letter || '';
        updateGridAverages(result, container);
        markGridCell(input, 'saved');
        if (status) status.textContent = 'Saved';
      })
      .catch(function() {
        markGridCell(input, 'save-error');
        if (status) status.textContent = 'Could not save';
      });
  }

  function syncRoleOptions(form) {
    if (!form) return;
    const groupSelect = form.querySelector('select[name="groupId"]');
    const roleSelect = form.querySelector('select[name="roleTypeId"]');
    if (!groupSelect || !roleSelect) return;
    const groupId = groupSelect.value;
    Array.from(roleSelect.options).forEach(function(option) {
      if (!option.value) return;
      const matches = !groupId || option.dataset.roleGroup === groupId;
      option.disabled = !matches;
      option.hidden = !matches;
    });
    if (roleSelect.selectedOptions[0] && roleSelect.selectedOptions[0].disabled) roleSelect.value = '';
  }

  function initUpdateTools(scope) {
    const panel = scope.querySelector('[data-update-status]');
    if (!panel) return;
    const updateForm = scope.querySelector('[data-update-form]');
    const updateCheckForm = scope.querySelector('[data-update-check-form]');
    const updateDownloadRow = scope.querySelector('[data-update-download-row]');
    const updateDownloadLink = scope.querySelector('[data-update-download]');
    const updateReleaseLink = scope.querySelector('[data-update-release]');
    function renderUpdateStatus(status) {
      if (!panel.isConnected || !status) return;
      const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
      const message = panel.querySelector('[data-update-message]');
      const percentLabel = panel.querySelector('[data-update-percent]');
      const progress = panel.querySelector('[data-update-progress]');
      const phase = panel.querySelector('[data-update-phase]');
      const log = panel.querySelector('[data-update-log]');
      if (message) message.textContent = status.message || '';
      if (percentLabel) percentLabel.textContent = percent + '%';
      if (progress) progress.style.setProperty('--progress-value', percent + '%');
      if (phase) phase.textContent = (status.phase || 'idle') + (status.targetVersion ? ' / target v' + status.targetVersion : '');
      if (log) log.textContent = status.log && status.log.length ? status.log.join('\\n') : 'No update activity yet.';
      if (updateDownloadRow && updateDownloadLink) {
        const downloadUrl = status.downloadUrl || status.installerDownloadUrl || '';
        updateDownloadRow.style.display = downloadUrl || status.releaseUrl ? 'flex' : 'none';
        updateDownloadLink.style.display = downloadUrl ? 'inline-flex' : 'none';
        if (downloadUrl) updateDownloadLink.href = downloadUrl;
        if (status.installerAssetName) updateDownloadLink.textContent = 'Download ' + status.installerAssetName;
      }
      if (updateReleaseLink) {
        updateReleaseLink.style.display = status.releaseUrl ? 'inline-flex' : 'none';
        if (status.releaseUrl) updateReleaseLink.href = status.releaseUrl;
      }
      [updateForm, updateCheckForm].forEach(function(form) {
        const button = form?.querySelector('button[type="submit"]');
        if (button) button.disabled = Boolean(status.running);
      });
      const channelInput = updateForm?.querySelector('input[name="channel"]');
      if (channelInput && status.channel) channelInput.value = status.channel;
    }
    function pollUpdateStatus() {
      if (!panel.isConnected) return;
      fetch('/system-update/status', { headers: { Accept: 'application/json' } })
        .then(function(response) { return response.ok ? response.json() : null; })
        .then(function(status) {
          renderUpdateStatus(status);
          if (status && status.running) setTimeout(pollUpdateStatus, 1400);
        })
        .catch(function() {});
    }
    if (updateForm && !updateForm.dataset.bound) {
      updateForm.dataset.bound = '1';
      updateForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        fetch('/system-update', { method: 'POST', body: new FormData(updateForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) {
            renderUpdateStatus(status);
            if (status && (status.downloadUrl || status.installerDownloadUrl)) {
              window.location.href = status.downloadUrl || status.installerDownloadUrl;
            }
            setTimeout(pollUpdateStatus, 800);
          })
          .catch(function() { if (button) button.disabled = false; });
      });
      pollUpdateStatus();
    }
    if (updateCheckForm && !updateCheckForm.dataset.bound) {
      updateCheckForm.dataset.bound = '1';
      updateCheckForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateCheckForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        fetch('/system-update/check', { method: 'POST', body: new FormData(updateCheckForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) { renderUpdateStatus(status); })
          .catch(function() {})
          .finally(function() { if (button) button.disabled = false; });
      });
    }
  }

  function initDynamicContent(scope) {
    scope = scope || document;
    scope.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    scope.querySelectorAll('[data-grid-letters-toggle]').forEach(function(toggle) {
      syncGridLettersToggle(toggle, false);
    });
    scope.querySelectorAll('form[action="/person-roles"]').forEach(syncRoleOptions);
    initUpdateTools(scope);
  }

  initDynamicContent(document);
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

function uploadedAssetPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized.startsWith('uploads/')) return '';
  const fileName = path.basename(normalized);
  const dataPath = path.join(UPLOAD_DIR, fileName);
  if (fs.existsSync(dataPath)) return dataPath;
  const legacyPath = path.join(PUBLIC_DIR, normalized);
  return fs.existsSync(legacyPath) ? legacyPath : '';
}

function logoAsset() {
  const customPath = uploadedAssetPath(getSetting('logo_path', ''));
  if (customPath) return customPath;
  return fs.existsSync(DEFAULT_LOGO_FILE) ? DEFAULT_LOGO_FILE : LEGACY_LOGO_FILE;
}

function faviconAsset() {
  const customPath = uploadedAssetPath(getSetting('favicon_path', ''));
  return customPath || logoAsset();
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
  const congregations = querySql('SELECT * FROM os_congregations ORDER BY name;');
  const families = querySql(`SELECT f.*, cng.name AS congregation_name,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
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
  const congregationOptions = (selected = '') => congregations.map((congregation) => `<option value="${congregation.id}" ${selectedAttr(congregation.id, selected)}>${esc(congregation.name)}</option>`).join('');
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
        <span>${esc(childText)}${family.congregation_name ? ` / ${esc(family.congregation_name)}` : ''}${contact ? ` / ${esc(contact)}` : ''}</span>
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
        <label>Congregation<select name="congregationId"><option value="">Not selected</option>${congregationOptions()}</select></label>
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
        <div class="detail-item"><span>Parents</span><strong>${esc([firstNameOnly(selectedFamily.father_name), firstNameOnly(selectedFamily.mother_name)].filter(Boolean).join(' / ')) || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Phone</span><strong>${esc(selectedFamily.phone || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Congregation</span><strong>${esc(selectedFamily.congregation_name || '') || '&mdash;'}</strong></div>
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

function setupPage(selectedYear, csrfToken, url, user) {
  const yearId = asInt(selectedYear.id);
  const allSections = ['families', 'districts', 'congregations', 'teachers', 'classrooms', 'subjects', 'years', 'weights', 'letter-grades', 'users', 'settings', 'network', 'backups', 'updates'];
  const validSections = DEMO_MODE ? allSections.filter((item) => !DEMO_HIDDEN_SETUP_SECTIONS.has(item)) : allSections;
  const section = validSections.includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'families';
  const action = cleanText(url.searchParams.get('action'), 40);
  const settings = appSettings();
  const teachers = querySql('SELECT * FROM os_teachers ORDER BY name;');
  const subjects = querySql('SELECT * FROM os_subjects ORDER BY name;');
  const districts = querySql('SELECT * FROM os_school_districts ORDER BY name;');
  const congregations = querySql('SELECT * FROM os_congregations ORDER BY name;');
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
  const families = querySql(`SELECT f.*, sd.name AS school_district_name, cng.name AS congregation_name,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_school_districts sd ON sd.id = f.school_district_id
    LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`);
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`);
  const users = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, u.parent_family_id, t.name AS teacher_name, f.family_name AS parent_family_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    LEFT JOIN os_families f ON f.id = u.parent_family_id
    ORDER BY u.name;`);
  const weightGroups = querySql(`SELECT wg.*, s.name AS subject_name
    FROM os_grade_weight_groups wg
    LEFT JOIN os_subjects s ON s.id = wg.subject_id
    WHERE wg.school_year_id=${yearId}
    ORDER BY CAST(wg.min_grade AS INTEGER), wg.name;`);
  const weightItems = querySql(`SELECT * FROM os_grade_weight_items
    WHERE group_id IN (SELECT id FROM os_grade_weight_groups WHERE school_year_id=${yearId})
    ORDER BY category;`);
  const letterGroups = querySql(`SELECT lg.*, s.name AS subject_name
    FROM os_letter_grade_groups lg
    LEFT JOIN os_subjects s ON s.id = lg.subject_id
    WHERE lg.school_year_id=${yearId}
    ORDER BY CAST(lg.min_grade AS INTEGER), lg.name;`);
  const letterItems = querySql(`SELECT * FROM os_letter_grade_items
    WHERE group_id IN (SELECT id FROM os_letter_grade_groups WHERE school_year_id=${yearId})
    ORDER BY threshold DESC, sort_order, letter;`);
  const teacherOptions = (selected = '') => teachers.map((teacher) => `<option value="${teacher.id}" ${selectedAttr(teacher.id, selected)}>${esc(teacher.name)}</option>`).join('');
  const familyOptions = (selected = '') => families.map((family) => `<option value="${family.id}" ${selectedAttr(family.id, selected)}>${esc(familyReportName(family))}</option>`).join('');
  const subjectOptions = (selected = '') => subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(subject.id, selected)}>${esc(subject.name)}</option>`).join('');
  const classroomOptions = (selected = '') => classrooms.map((room) => `<option value="${room.id}" ${selectedAttr(room.id, selected)}>${esc(room.name)}</option>`).join('');
  const districtOptions = (selected = '') => districts.map((district) => `<option value="${district.id}" ${selectedAttr(district.id, selected)}>${esc(district.name)}</option>`).join('');
  const congregationOptions = (selected = '') => congregations.map((congregation) => `<option value="${congregation.id}" ${selectedAttr(congregation.id, selected)}>${esc(congregation.name)}</option>`).join('');
  const updateStatus = readUpdateStatus();
  const backups = listDatabaseBackups();
  const backupFreq = backupFrequency(getSetting('backup_frequency', 'manual'));
  const networkInfo = networkStatus();
  const setupLinks = [
    ['families', 'Families', `${families.length} households`],
    ['districts', 'School Districts', `${districts.length} districts`],
    ['congregations', 'Congregations', `${congregations.length} churches`],
    ['teachers', 'Teachers', `${teachers.length} records`],
    ['classrooms', 'Classrooms', `${classrooms.length} rooms in ${selectedYear.name}`],
    ['subjects', 'Subjects', `${subjects.length} subjects`],
    ['years', 'School Years', `${schoolYears.length} years`],
    ['weights', 'Grade Weights', `${weightGroups.length} groups`],
    ['letter-grades', 'Letter Grades', `${letterGroups.length} scales`],
    ['users', 'Users', `${users.length} sign-ins`],
    ['settings', 'System Settings', settings.schoolName],
    ...(!DEMO_MODE ? [
      ['network', 'Network Access', networkAccessLabel(networkInfo.desired.host)],
      ['backups', 'Backups', `${backupFrequencyLabel(backupFreq)}`],
      ['updates', 'System Updates', `v${APP_VERSION}`]
    ] : [])
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
      const householdLine = familyReportName(family);
      const contact = [family.father_phone || family.phone, family.mother_phone].filter(Boolean).join(' / ');
      return `<a class="family-link ${active}" href="/setup?section=families&familyId=${family.id}">
        <strong>${esc(householdLine)}</strong>
        <span>${esc(childText)}${family.school_district_name ? ` / ${esc(family.school_district_name)}` : ''}${family.congregation_name ? ` / ${esc(family.congregation_name)}` : ''}${contact ? ` / ${esc(contact)}` : ''}</span>
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
        <div class="family-form-section">
          <h3>Household</h3>
          <div class="family-form-section-grid two">
            <label>Last Name<input name="familyName" required maxlength="120" value="${esc(familyForForm?.family_name || '')}" /></label>
            <label>Father<input name="fatherName" maxlength="120" value="${esc(firstNameOnly(familyForForm?.father_name || ''))}" /></label>
            <label>Mother<input name="motherName" maxlength="120" value="${esc(firstNameOnly(familyForForm?.mother_name || ''))}" /></label>
          </div>
        </div>
        <div class="family-form-section">
          <h3>Contact</h3>
          <div class="family-form-section-grid two">
            <label>Father Phone<input name="fatherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.father_phone || familyForForm?.phone || '')}" /></label>
            <label>Mother Phone<input name="motherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.mother_phone || '')}" /></label>
            <label>Email<input name="email" type="email" maxlength="160" value="${esc(familyForForm?.email || '')}" /></label>
            <label>Address<input name="address" maxlength="220" value="${esc(familyForForm?.address || '')}" /></label>
          </div>
        </div>
        <div class="family-form-section">
          <h3>Church and District</h3>
          <div class="family-form-section-grid two">
            <label>Congregation<select name="congregationId"><option value="">Not selected</option>${congregationOptions(familyForForm?.congregation_id || '')}</select></label>
            <label>School District<select name="schoolDistrictId"><option value="">Not selected</option>${districtOptions(familyForForm?.school_district_id || '')}</select></label>
          </div>
        </div>
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
      </div>
    </div>
    <div class="family-detail-body">
	      <div class="detail-grid">
	        <div class="detail-item"><span>Father</span><strong>${esc(firstNameOnly(selectedFamily.father_name || '')) || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother</span><strong>${esc(firstNameOnly(selectedFamily.mother_name || '')) || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Contact</h3></div>
	      <div class="detail-grid">
	        <div class="detail-item"><span>Father Phone</span><strong>${esc(selectedFamily.father_phone || selectedFamily.phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother Phone</span><strong>${esc(selectedFamily.mother_phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Church and District</h3></div>
	      <div class="detail-grid">
	        <div class="detail-item"><span>Congregation</span><strong>${esc(selectedFamily.congregation_name || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>School District</span><strong>${esc(selectedFamily.school_district_name || '') || '&mdash;'}</strong></div>
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
	      <div class="subhead"><h3>Children</h3><div class="module-actions"><span class="family-count">${esc(selectedYear.name)}</span><a class="page-action compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-child">Add Child</a></div></div>
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

  const congregationEdit = congregations.find((congregation) => congregation.id === asInt(url.searchParams.get('congregationId')));
  const congregationForm = `<form method="post" action="/congregations" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${congregationEdit ? `<input type="hidden" name="congregationId" value="${congregationEdit.id}" />` : ''}
    <label>Church Name<input name="name" required maxlength="140" value="${esc(congregationEdit?.name || '')}" /></label>
    <button type="submit">${congregationEdit ? 'Save Church' : 'Add Church'}</button>
  </form>`;
  const congregationsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Congregations</h2>
      <div class="module-actions"><span class="family-count">${congregations.length}</span><a class="page-action compact-action" href="/setup?section=congregations&action=add-congregation">Add Church</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-congregation' || congregationEdit) ? `<div class="subhead"><h3>${congregationEdit ? 'Edit Church' : 'Add Church'}</h3><a class="secondary-btn compact-action" href="/setup?section=congregations">Cancel</a></div>${congregationForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Church</th><th>Families</th><th></th></tr>
        ${congregations.map((congregation) => {
          const count = families.filter((family) => asInt(family.congregation_id) === asInt(congregation.id)).length;
          return `<tr><td>${esc(congregation.name)}</td><td>${count}</td><td><a class="text-action" href="/setup?section=congregations&congregationId=${congregation.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No congregations yet.')}</td></tr>`}
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

  const letterEdit = letterGroups.find((group) => group.id === asInt(url.searchParams.get('letterGroupId')));
  const letterRows = letterEdit
    ? letterItems.filter((item) => item.group_id === letterEdit.id)
    : DEFAULT_LETTER_GRADES.map(([letter, threshold], index) => ({ letter, threshold, sort_order: index }));
  const letterFormRows = [...letterRows, { letter: '', threshold: '', sort_order: letterRows.length }];
  const letterForm = `<form method="post" action="/letter-grades" class="form-grid">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${letterEdit ? `<input type="hidden" name="letterGroupId" value="${letterEdit.id}" />` : ''}
    <div class="form-grid four">
      <label>Scale Name<input name="name" required maxlength="120" value="${esc(letterEdit?.name || 'Default Letter Grades')}" /></label>
      <label>Subject<select name="subjectId"><option value="">Any subject</option>${subjectOptions(letterEdit?.subject_id || '')}</select></label>
      <label>Minimum Grade<select name="minGrade">${gradeOptions(letterEdit?.min_grade || '1')}</select></label>
      <label>Maximum Grade<select name="maxGrade">${gradeOptions(letterEdit?.max_grade || '12')}</select></label>
    </div>
    <div class="table-wrap compact-table"><table class="letter-grade-edit-table">
      <tr><th>Letter</th><th>Threshold</th></tr>
      ${letterFormRows.map((row, index) => `<tr>
        <td><input name="letter_${index}" maxlength="12" value="${esc(row.letter || '')}" placeholder="${index === letterFormRows.length - 1 ? 'Add letter' : ''}" /></td>
        <td><input type="number" name="threshold_${index}" min="0" max="100" step="0.1" value="${esc(row.threshold ?? '')}" /></td>
      </tr>`).join('')}
    </table></div>
    <button type="submit">${letterEdit ? 'Save Letter Grades' : 'Create Letter Scale'}</button>
  </form>`;
  const letterGradesModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Letter Grades</h2>
      <div class="module-actions"><span class="family-count">${letterGroups.length}</span><a class="page-action compact-action" href="/setup?section=letter-grades&action=add-letter-scale">Add Scale</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-letter-scale' || letterEdit) ? `<div class="subhead"><h3>${letterEdit ? 'Edit Letter Scale' : 'Add Letter Scale'}</h3><a class="secondary-btn compact-action" href="/setup?section=letter-grades">Cancel</a></div>${letterForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Scale</th><th>Grades</th><th>Subject</th><th>Thresholds</th><th></th></tr>
        ${letterGroups.map((group) => {
          const items = letterItems.filter((item) => item.group_id === group.id);
          return `<tr>
            <td>${esc(group.name)}</td>
            <td>${esc(group.min_grade)}-${esc(group.max_grade)}</td>
            <td>${esc(group.subject_name || 'Any')}</td>
            <td>${items.map((item) => `<span class="badge">${esc(item.letter)} ${compactNumber(item.threshold)}%</span>`).join('')}</td>
            <td><a class="text-action" href="/setup?section=letter-grades&letterGroupId=${group.id}">Edit</a></td>
          </tr>`;
        }).join('') || `<tr><td colspan="5">${emptyState('No letter grade scales yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const userEdit = users.find((setupUser) => setupUser.id === asInt(url.searchParams.get('userId')));
  const protectedAdminEdit = [ROLE_ADMIN, ROLE_PRINCIPAL].includes(userEdit?.role) && !canManageAdminUsers(user);
  const roleValue = userEdit?.role || (canManageAdminUsers(user) ? ROLE_ADMIN : ROLE_TEACHER);
  const userForm = protectedAdminEdit ? '<p class="notice danger">Only admins can edit admin or principal users.</p>' : `<form method="post" action="/users" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${userEdit ? `<input type="hidden" name="userId" value="${userEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(userEdit?.name || '')}" /></label>
    <label>Username<input name="username" required maxlength="80" value="${esc(userEdit?.username || '')}" /></label>
    <label>Role<select name="role">${roleOptionsForUser(user, roleValue)}</select></label>
    <label>Teacher Link<select name="teacherId"><option value="">None</option>${teacherOptions(userEdit?.teacher_id || '')}</select></label>
    <label>Parent Family<select name="parentFamilyId"><option value="">None</option>${familyOptions(userEdit?.parent_family_id || '')}</select></label>
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
        <tr><th>Name</th><th>Username</th><th>Role</th><th>Teacher</th><th>Family</th><th></th></tr>
        ${users.map((setupUser) => {
          const canEditUser = ![ROLE_ADMIN, ROLE_PRINCIPAL].includes(setupUser.role) || canManageAdminUsers(user);
          return `<tr><td>${esc(setupUser.name)}</td><td>${esc(setupUser.username)}</td><td>${roleLabel(setupUser.role)}</td><td>${esc(setupUser.teacher_name || '') || '&mdash;'}</td><td>${esc(setupUser.parent_family_name || '') || '&mdash;'}</td><td>${canEditUser ? `<a class="text-action" href="/setup?section=users&userId=${setupUser.id}">Edit</a>` : '&mdash;'}</td></tr>`;
        }).join('') || `<tr><td colspan="6">${emptyState('No users yet.')}</td></tr>`}
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
        <label>Logo<input type="file" name="logo" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" /></label>
        <label>Favicon<input type="file" name="favicon" accept=".ico,.png,.jpg,.jpeg,.webp,image/x-icon,image/png,image/jpeg,image/webp" /></label>
        <button type="submit">Save Settings</button>
      </form>
    </div>
  </section>`;

  const networkAccessMode = networkInfo.desired.host === '0.0.0.0' ? 'lan' : 'local';
  const networkDisabled = networkInfo.envManaged ? 'disabled' : '';
  const networkModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Network Access</h2>
      <span class="family-count">${esc(networkAccessLabel(networkInfo.active.host))}</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Active Mode</span><strong>${esc(networkAccessLabel(networkInfo.active.host))}</strong></div>
        <div class="detail-item"><span>Active Port</span><strong>${esc(networkInfo.active.port)}</strong></div>
        <div class="detail-item"><span>Host Machine</span><strong>${esc(networkInfo.hostName)}</strong></div>
        <div class="detail-item"><span>Data Directory</span><strong>${esc(DATA_DIR)}</strong></div>
      </div>
      ${networkInfo.restartRequired ? '<p class="notice danger">Network settings have changed. Restart Oakstead before other devices use the new address.</p>' : ''}
      ${networkInfo.envManaged ? '<p class="notice danger">HOST or PORT is set by the runtime environment, so the form below is read-only until those environment variables are removed.</p>' : ''}
      <form method="post" action="/network-settings" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Access Mode<select name="accessMode" ${networkDisabled}>
          <option value="local" ${selectedAttr(networkAccessMode, 'local')}>Local computer only</option>
          <option value="lan" ${selectedAttr(networkAccessMode, 'lan')}>Local network devices</option>
        </select></label>
        <label>Port<input name="port" type="number" min="1" max="65535" value="${esc(networkInfo.desired.port)}" ${networkDisabled} /></label>
        <button class="secondary-btn compact-action" type="submit" ${networkDisabled}>Save Network Settings</button>
      </form>
      <div class="subhead"><h3>Current URLs</h3></div>
      <div class="backup-list">
        ${networkInfo.urls.map((item) => `<div class="backup-row"><div><strong>${esc(item)}</strong><span>${networkInfo.active.host === '0.0.0.0' ? 'Open this from another device on the same network.' : 'Open this on the host computer.'}</span></div></div>`).join('')}
      </div>
      <div class="subhead"><h3>Detected LAN Addresses</h3></div>
      <div class="backup-list">
        ${networkInfo.addresses.length ? networkInfo.addresses.map((item) => `<div class="backup-row"><div><strong>${esc(item)}</strong><span>${networkInfo.active.host === '0.0.0.0' ? esc(`http://${item}:${networkInfo.active.port}`) : 'Enable LAN access to use this address.'}</span></div></div>`).join('') : '<div class="backup-row"><div><strong>No non-local IPv4 address detected</strong><span>Check the host machine network connection.</span></div></div>'}
      </div>
      <p class="notice">LAN access should stay on a trusted local network or VPN. Do not expose Oakstead directly to the public internet.</p>
    </div>
  </section>`;

  const updateLogText = (updateStatus.log || []).slice(-20).join('\n');
  const latestBackup = backups[0] || null;
  const backupsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Backups</h2>
      <span class="family-count">${backups.length} saved</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Schedule</span><strong>${backupFrequencyLabel(backupFreq)}</strong></div>
        <div class="detail-item"><span>Latest Backup</span><strong>${latestBackup ? esc(latestBackup.fileName) : 'None yet'}</strong></div>
      </div>
      <form method="post" action="/backup-settings" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Automatic Backup Schedule<select name="frequency">
          <option value="manual" ${selectedAttr(backupFreq, 'manual')}>Manual only</option>
          <option value="daily" ${selectedAttr(backupFreq, 'daily')}>Daily</option>
          <option value="weekly" ${selectedAttr(backupFreq, 'weekly')}>Weekly</option>
          <option value="monthly" ${selectedAttr(backupFreq, 'monthly')}>Monthly</option>
        </select></label>
        <button class="secondary-btn compact-action" type="submit">Save Schedule</button>
      </form>
      <div class="inline-actions">
        <form method="post" action="/backup/create" style="margin:0">${csrfInput(csrfToken)}<button class="page-action compact-action" type="submit">Create Backup</button></form>
        ${latestBackup ? `<a class="secondary-btn compact-action" href="/backup/download?file=${encodeURIComponent(latestBackup.fileName)}">Download Latest</a>` : ''}
      </div>
      <div class="subhead"><h3>Restore Backup</h3></div>
      <form method="post" action="/backup/restore" enctype="multipart/form-data" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Saved Backup<select name="backupFileName"><option value="">Choose saved backup</option>${backups.map((backup) => `<option value="${esc(backup.fileName)}">${esc(backup.fileName)}</option>`).join('')}</select></label>
        <label>Upload Backup<input type="file" name="backupFile" accept=".db,application/octet-stream" /></label>
        <button class="secondary-btn compact-action" type="submit">Restore Backup</button>
      </form>
      <p class="notice">Restoring replaces the current database. Oakstead creates a pre-restore backup first.</p>
      <div class="backup-list">
        ${backups.map((backup) => `<div class="backup-row">
          <div><strong>${esc(backup.fileName)}</strong><span>${esc(formatFileSize(backup.size))} / ${esc(backup.createdAt.toLocaleString())}</span></div>
          <a class="secondary-btn compact-action" href="/backup/download?file=${encodeURIComponent(backup.fileName)}">Download</a>
        </div>`).join('') || emptyState('No backups have been created yet.')}
      </div>
    </div>
  </section>`;
  const updatesModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>System Updates</h2>
      <span class="family-count">v${esc(APP_VERSION)}</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Installed Version</span><strong>v${esc(APP_VERSION)}</strong></div>
        <div class="detail-item"><span>Latest Checked</span><strong>${updateStatus.latestVersion ? `v${esc(updateStatus.latestVersion)}` : 'Not checked yet'}</strong></div>
        <div class="detail-item"><span>Update Mode</span><strong>${UPDATE_MODE === 'installer' ? 'Windows installer' : 'Git checkout'}</strong></div>
        <div class="detail-item"><span>Release Source</span><strong>${UPDATE_MODE === 'installer' ? esc(RELEASE_REPO) : 'Configured Git remote'}</strong></div>
      </div>
      <div class="update-actions">
      <form method="post" action="/system-update/check" class="update-actions" data-update-check-form>
        ${csrfInput(csrfToken)}
        <label>Release Type<select name="channel">
          <option value="stable" ${selectedAttr(updateStatus.channel, 'stable')}>Current release</option>
          <option value="prerelease" ${selectedAttr(updateStatus.channel, 'prerelease')}>Pre-release</option>
        </select></label>
        <button class="secondary-btn compact-action" type="submit" ${updateStatus.running ? 'disabled' : ''}>Check for Updates</button>
      </form>
      <form method="post" action="/system-update" class="update-actions" data-update-form>
        ${csrfInput(csrfToken)}
        <input type="hidden" name="channel" value="${esc(updateStatus.channel)}" />
        <button class="page-action compact-action" type="submit" ${updateStatus.running ? 'disabled' : ''}>${UPDATE_MODE === 'installer' ? 'Download Installer' : 'Download and Install'}</button>
      </form>
      </div>
      <div class="inline-actions" data-update-download-row style="${updateStatus.installerDownloadUrl || updateStatus.releaseUrl ? '' : 'display:none'}">
        <a class="page-action compact-action" data-update-download href="${esc(updateStatus.installerDownloadUrl || '#')}" style="${updateStatus.installerDownloadUrl ? '' : 'display:none'}">${updateStatus.installerAssetName ? `Download ${esc(updateStatus.installerAssetName)}` : 'Download Windows Installer'}</a>
        <a class="secondary-btn compact-action" data-update-release href="${esc(updateStatus.releaseUrl || '#')}" style="${updateStatus.releaseUrl ? '' : 'display:none'}">Open Release Page</a>
      </div>
      <div class="update-status" data-update-status>
        <div class="update-status-head">
          <strong data-update-message>${esc(updateStatus.message)}</strong>
          <span data-update-percent>${asInt(updateStatus.percent)}%</span>
        </div>
        <div class="progress-track" aria-label="Update progress"><div class="progress-fill" data-update-progress style="--progress-value:${asInt(updateStatus.percent)}%"></div></div>
        <p class="notice" data-update-phase>${esc(updateStatus.phase)}${updateStatus.targetVersion ? ` / target v${esc(updateStatus.targetVersion)}` : ''}</p>
        <pre class="update-log" data-update-log>${esc(updateLogText || 'No update activity yet.')}</pre>
      </div>
      <p class="notice">${UPDATE_MODE === 'installer'
        ? 'Packaged Windows updates are installed by downloading the GitHub release installer, running it on the host computer, and letting it replace app files while preserving the data directory.'
        : 'Updates are fetched from the configured GitHub remote. Oakstead creates a database backup before updating, installs npm dependencies, validates the server, and restarts after success.'}</p>
    </div>
  </section>`;

  const modules = {
    families: familiesModule,
    districts: districtsModule,
    congregations: congregationsModule,
    teachers: teachersModule,
    classrooms: classroomsModule,
    subjects: subjectsModule,
    years: yearsModule,
    weights: weightsModule,
    'letter-grades': letterGradesModule,
    users: usersModule,
    settings: settingsModule,
    ...(!DEMO_MODE ? {
      network: networkModule,
      backups: backupsModule,
      updates: updatesModule
    } : {})
  };

  return `<div class="workspace">
    ${schoolYearHead('School Setup', 'Manage the records that define the school year.', selectedYear)}
    <div class="setup-layout">
      ${setupNav}
      ${modules[section]}
    </div>
  </div>`;
}

function gradebookGridView({
  selectedYear,
  yearId,
  periods,
  selectedPeriodId,
  selectedGrade,
  selectedSubjectId,
  scoreMode,
  allGrades,
  subjects,
  subject,
  allowed,
  students,
  assignments,
  averageData,
  letterScale,
  classAverageBlock,
  csrfToken
}) {
  const gridAssignments = [...assignments].sort((a, b) => {
    const dateCompare = String(a.assignment_date || '').localeCompare(String(b.assignment_date || ''));
    return dateCompare || Number(a.id) - Number(b.id);
  });
  const assignmentIds = gridAssignments.map((assignment) => asInt(assignment.id)).filter(Boolean);
  const studentIds = students.map((student) => asInt(student.id)).filter(Boolean);
  const scoreRows = assignmentIds.length && studentIds.length
    ? querySql(`SELECT sc.assignment_id, sc.student_id, sc.score,
        ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
      FROM os_scores sc
      JOIN os_assignments a ON a.id = sc.assignment_id
      WHERE sc.assignment_id IN (${assignmentIds.join(',')})
        AND sc.student_id IN (${studentIds.join(',')});`)
    : [];
  const scoresByCell = new Map(scoreRows.map((row) => [`${asInt(row.assignment_id)}:${asInt(row.student_id)}`, row]));
  const periodSelect = `<select name="markingPeriodId" required data-auto-submit>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.period_number)}</option>`).join('')}</select>`;
  const gradeSelect = `<select name="grade" required data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
  const subjectSelect = `<select name="subjectId" required data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const modeSelect = `<select name="mode" data-auto-submit><option value="wrong" ${scoreMode === 'wrong' ? 'selected' : ''}>Errors</option><option value="percent" ${scoreMode === 'percent' ? 'selected' : ''}>Percentages</option></select>`;
  const subjectLabel = subject ? esc(subject.name) : 'Subject';

  const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V21h3.75L18.81 9.94l-3.75-3.75L4 17.25Zm16.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0l-1.48 1.48 3.75 3.75 1.65-1.31Z"/></svg>';
  const addIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
  const headerOverlayWidth = (gridAssignments.length + 1) * 54;
  const headerLines = Array.from({length: gridAssignments.length + 1}, (_, i) =>
    `<line x1="${i * 54}" y1="96" x2="${i * 54 + 80}" y2="10"></line>`
  ).join('');
  const headerLabels = gridAssignments.map((assignment, index) =>
    `<text transform="translate(${index * 54 + 57} 64) rotate(-47)" text-anchor="middle">${esc(gradebookTitle(assignment.category, assignment.title))}</text>`
  ).join('');
  const headerOverlay = `<svg class="gb-header-svg" viewBox="0 0 ${headerOverlayWidth} 126" aria-hidden="true">${headerLines}${headerLabels}</svg>`;
  const headerCells = gridAssignments.map((assignment, index) => {
    const categoryClass = gradebookCategoryClass(assignment.category);
    return `<th class="gb-grid-assignment gb-type-${categoryClass}" style="--gb-header-z:${gridAssignments.length - index + 10}" title="${esc(assignment.title)}">
    </th>`;
  }).join('');

  const classAverageCells = gridAssignments.map((assignment) => `<td class="gb-grid-average gb-type-${gradebookCategoryClass(assignment.category)}" data-grid-assignment-average="${assignment.id}">${gradebookDisplayScore(assignment.avg_score, letterScale)}</td>`).join('');
  const pointsCells = gridAssignments.map((assignment) => `<td>${compactNumber(assignment.max_score)}</td>`).join('');
  const emptyAssignmentCells = gridAssignments.map(() => '<td></td>').join('');

  const studentRows = students.map((student) => {
    const studentAverage = averageData.studentAverages.get(asInt(student.id));
    const cells = gridAssignments.map((assignment) => {
      const key = `${asInt(assignment.id)}:${asInt(student.id)}`;
      const row = scoresByCell.get(key);
      const displayPercent = row?.percent;
      const value = scoreValueForMode(row?.score, assignment.max_score, scoreMode);
      const categoryClass = gradebookCategoryClass(assignment.category);
      const letter = gradebookLetter(displayPercent, letterScale);
      return `<td class="gb-grid-score-cell gb-type-${categoryClass}">
        <input data-score-input data-grid-score-input data-score-points="${compactNumber(asPoints(assignment.max_score))}" data-score-mode="${scoreMode}" data-assignment-id="${assignment.id}" data-student-id="${student.id}" data-original-value="${esc(value)}" name="gridscore_${assignment.id}_${student.id}" type="number" inputmode="decimal" min="0" max="${scoreMode === 'percent' ? '100' : compactNumber(asPoints(assignment.max_score))}" step="0.01" value="${esc(value)}" aria-label="${esc(student.first_name)} ${esc(student.last_name)} ${esc(assignment.title)}" autocomplete="off" />
        <span class="gb-cell-letter">${esc(letter)}</span>
        <span class="gb-cell-status" data-grid-save-status></span>
      </td>`;
    }).join('');
    return `<tr>
      <th class="gb-grid-student">${esc(student.first_name)} <span data-grid-student-average="${student.id}">${gradebookDisplayScore(studentAverage, letterScale)}</span></th>
      ${cells}
    </tr>`;
  }).join('');

  const assignmentDialogs = gridAssignments.map((assignment) => {
    const category = normalizeCategory(assignment.category);
    return `<dialog class="assignment-dialog" id="assignment-dialog-${assignment.id}">
      <form method="post" action="/gradebook" class="assignment-dialog-form">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="action" value="update-assignment" />
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
        <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
        <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
        <input type="hidden" name="assignmentId" value="${assignment.id}" />
        <input type="hidden" name="scoreMode" value="${scoreMode}" />
        <div class="assignment-dialog-head">
          <span>${editIcon}</span>
          <h3>Edit Assignment</h3>
        </div>
        <div class="assignment-dialog-body">
          <label>Title<input name="title" required maxlength="140" value="${esc(assignment.title)}" /></label>
          <div class="assignment-dialog-grid">
            <label>Type<select name="category">${categoryOptions(assignment.category)}</select></label>
            <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="${compactNumber(assignment.max_score)}" required /></label>
            <label>Date<input type="date" name="assignmentDate" value="${esc(assignment.assignment_date || '')}" /></label>
          </div>
        </div>
        <div class="assignment-dialog-actions">
          <button class="secondary-btn danger-action" type="submit" name="deleteAssignment" value="1">Delete</button>
          <button class="secondary-btn" type="button" data-dialog-close>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </dialog>`;
  }).join('');

  let gridBody = '';
  if (!allowed) {
    gridBody = `<div class="panel">${emptyState('This grade is not assigned to your teacher account.')}</div>`;
  } else if (!selectedGrade || !selectedSubjectId) {
    gridBody = `<div class="panel">${emptyState('Select a grade and subject to begin.')}</div>`;
  } else if (!gridAssignments.length) {
    gridBody = `<div class="panel">${emptyState('No assignments found for this period. Switch Grid off to add the first assignment, or use Assignments to create several at once.')}</div>`;
  } else {
    gridBody = `<div class="gb-grid-form" data-grid-autosave data-action="/gradebook">
      ${csrfInput(csrfToken)}
      <input type="hidden" name="action" value="grid-scores" />
      <input type="hidden" name="schoolYearId" value="${yearId}" />
      <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
      <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
      <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
      <input type="hidden" name="scoreMode" value="${scoreMode}" />
      <input type="hidden" name="gridMode" value="on" />
      ${gridAssignments.map((assignment) => `<input type="hidden" name="assignmentMax_${assignment.id}" value="${compactNumber(asPoints(assignment.max_score))}" />`).join('')}
      <div class="gb-grid-scroll">
        <div class="gb-grid-stage" style="--gb-assignment-count:${gridAssignments.length}">
        <div class="gb-grid-header-overlay">${headerOverlay}</div>
        <table class="gb-grid-table">
          <colgroup>
            <col class="gb-grid-student-col" />
            ${gridAssignments.map(() => '<col class="gb-grid-score-col" />').join('')}
          </colgroup>
          <thead>
            <tr class="gb-grid-top-row">
              <th class="gb-grid-year" rowspan="2">
                <button class="gb-grid-add-btn" type="button" data-dialog-target="add-assignment-dialog" title="Add assignment" aria-label="Add assignment">+</button>
              </th>
              ${headerCells}
            </tr>
            <tr class="gb-grid-icon-row">
              ${gridAssignments.map((assignment) => `<th class="gb-type-${gradebookCategoryClass(assignment.category)}"><button class="gb-edit-icon" type="button" data-dialog-target="assignment-dialog-${assignment.id}" aria-label="Edit ${esc(assignment.title)}">${editIcon}</button></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="gb-grid-class-row">
              <th>Class Average <span data-grid-class-average>${gradebookDisplayScore(averageData.classAverage, letterScale)}</span></th>
              ${classAverageCells}
            </tr>
            <tr class="gb-grid-points-row">
              <th>Points</th>
              ${pointsCells}
            </tr>
            ${students.length ? studentRows : `<tr><th>No Students</th>${emptyAssignmentCells}</tr>`}
          </tbody>
        </table>
        </div>
      </div>
      <div class="gb-grid-footer">
        <span>${students.length} students / ${gridAssignments.length} assignments / ${subjectLabel}</span>
        <span data-grid-autosave-status>Autosaves changes</span>
      </div>
      ${assignmentDialogs}
      <dialog class="assignment-dialog" id="add-assignment-dialog">
        <form method="post" action="/gradebook" class="assignment-dialog-form">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="action" value="add-assignment" />
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
          <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
          <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
          <input type="hidden" name="scoreMode" value="${scoreMode}" />
          <div class="assignment-dialog-head">
            <span>${addIcon}</span>
            <h3>Add Assignment</h3>
          </div>
          <div class="assignment-dialog-body">
            <label>Title<input name="title" placeholder="${subject ? `e.g. Lesson 24 – ${esc(subject.name)}` : 'e.g. Lesson 24'}" required maxlength="140" /></label>
            <div class="assignment-dialog-grid">
              <label>Type<select name="category">${categoryOptions()}</select></label>
              <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
              <label>Date<input type="date" name="assignmentDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
            </div>
          </div>
          <div class="assignment-dialog-actions">
            <button class="secondary-btn" type="button" data-dialog-close>Cancel</button>
            <button type="submit">Add Assignment</button>
          </div>
        </form>
      </dialog>
    </div>`;
  }

  return `<section class="gb-grid-shell">
    <form method="get" action="/gradebook" class="gb-grid-toolbar">
      <input type="hidden" name="yearId" value="${yearId}" />
      <input type="hidden" name="grid" value="on" />
      <label>Period${periodSelect}</label>
      <label>Grade${gradeSelect}</label>
      <label>Subject${subjectSelect}</label>
      <div class="gb-type-legend" aria-label="Grade type legend">
        <b>Legend</b>
        <span><i class="legend-box lesson"></i> Homework</span>
        <span><i class="legend-box quiz"></i> Quiz</span>
        <span><i class="legend-box test"></i> Test</span>
      </div>
      <label>Enter As${modeSelect}</label>
      <label class="gb-toolbar-check"><span>Display</span><span class="check-row"><input type="checkbox" data-grid-letters-toggle checked /> Letters</span></label>
    </form>
    ${gridBody}
  </section>`;
}

function gradebookPage(req, url, user, selectedYear, csrfToken) {
  const yearId = asInt(selectedYear.id);
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const selectedPeriod = selectedPeriodFromRequest(req, url, periods);
  const selectedPeriodId = asInt(selectedPeriod?.id);
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
  const requestedAssignmentId = asInt(url.searchParams.get('assignmentId'));
  const showNewAssignment = url.searchParams.get('action') === 'add';
  const scoreMode = cleanScoreMode(url.searchParams.get('mode'));
  const gridParam = cleanText(url.searchParams.get('grid'), 12);
  const savedGridMode = parseCookies(req).gradebookGrid;
  const gridMode = gridParam ? gridParam !== 'off' : (savedGridMode ? savedGridMode === 'on' : true);
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
  const assignments = selectedGrade && selectedSubjectId && allowed ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
      COUNT(sc.id) AS score_count,
      ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
    FROM os_assignments a
    LEFT JOIN os_scores sc ON sc.assignment_id = a.id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(selectedGrade)}
      AND a.subject_id=${selectedSubjectId}
      ${assignmentPeriodClause(selectedPeriod)}
    GROUP BY a.id
    ORDER BY a.assignment_date DESC, a.id DESC;`) : [];
  const selectedAssignmentId = showNewAssignment ? 0 : (requestedAssignmentId || asInt(assignments[0]?.id));
  const selectedAssignment = selectedAssignmentId
    ? (assignments.find((a) => a.id === selectedAssignmentId) || querySql(`SELECT id, title, category, assignment_date, max_score FROM os_assignments WHERE id=${selectedAssignmentId} AND school_year_id=${yearId} LIMIT 1;`)[0])
    : null;
  const existingScores = selectedAssignment ? Object.fromEntries(
    querySql(`SELECT student_id, score FROM os_scores WHERE assignment_id=${selectedAssignment.id};`).map((r) => [r.student_id, r.score])
  ) : {};

  const periodParam = selectedPeriodId ? `&markingPeriodId=${selectedPeriodId}` : '';
  const baseParams = `yearId=${yearId}${periodParam}${selectedGrade ? `&grade=${encodeURIComponent(selectedGrade)}` : ''}${selectedSubjectId ? `&subjectId=${selectedSubjectId}` : ''}&mode=${scoreMode}`;
  const gridOffUrl = `/gradebook?${baseParams}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}&grid=off`;
  const gridOnUrl = `/gradebook?${baseParams}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}&grid=on`;
  const layoutToggle = gridModeToggle(gridOffUrl, gridOnUrl, gridMode);
  const periodSelect = `<select name="markingPeriodId" required data-auto-submit>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.period_number)}</option>`).join('')}</select>`;
  const gradeSelect = `<select name="grade" required data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
  const subjectSelect = `<select name="subjectId" required data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  const assignmentModeParam = showNewAssignment ? '&action=add' : (selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : '');
  const percentUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=percent')}${assignmentModeParam}`;
  const wrongUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=wrong')}${assignmentModeParam}`;
  const scoreModeControl = scoreModeToggle(percentUrl, wrongUrl, scoreMode);
  const averageData = selectedGrade && selectedSubjectId && selectedPeriod
    ? periodAverageRows(yearId, selectedGrade, selectedSubjectId, students.map((student) => student.id), selectedPeriod)
    : { classAverage: null, studentAverages: new Map() };
  const scale = selectedGrade && selectedSubjectId ? letterGradeScale(yearId, selectedGrade, selectedSubjectId) : DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
  const classAverageBlock = selectedGrade && selectedSubjectId && selectedPeriod
    ? `<div class="class-average-callout"><span>Class average</span><b>${formatPercent(averageData.classAverage)}</b></div>`
    : '';

  if (gridMode) {
    return `<div class="workspace gradebook-grid-workspace">
      ${schoolYearHead('Gradebook', 'Grid entry with students down the side and assignments across the top.', selectedYear, layoutToggle)}
      ${gradebookGridView({
        selectedYear,
        yearId,
        periods,
        selectedPeriodId,
        selectedGrade,
        selectedSubjectId,
        scoreMode,
        allGrades,
        subjects,
        subject,
        allowed,
        students,
        assignments,
        averageData,
        letterScale: scale,
        classAverageBlock,
        csrfToken
      })}
    </div>`;
  }

  // Score entry panel
  let scoreContent = '';
  if (!allowed) {
    scoreContent = emptyState('This grade is not assigned to your teacher account.');
  } else if (!selectedGrade || !selectedSubjectId) {
    scoreContent = emptyState('Select a grade and subject to begin.');
  } else {
    const assignmentPicker = `<label class="assignment-picker">Assignment<select name="assignmentId" data-assignment-select data-base-url="/gradebook?${baseParams}">
      <option value="__new__" ${!selectedAssignment ? 'selected' : ''}>New assignment</option>
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
    return `<a class="history-link ${active ? 'active' : ''}" href="/gradebook?${baseParams}&assignmentId=${a.id}">
      <span class="history-main"><b>${esc(a.title)}</b><small>${esc(a.assignment_date || '') || 'No date'} · ${displayCategoryShort(a.category)} · ${compactNumber(a.max_score)} pts</small></span>
      <span class="history-side"><span class="badge ${gradeTone(a.avg_score)}">${formatPercent(a.avg_score)}</span><small>${a.score_count} scores</small></span>
    </a>`;
  }).join('') || emptyState('No assignment history for this selection yet.');

  return `<div class="workspace">
    ${schoolYearHead('Gradebook', 'Choose a grade and subject, pick or create an assignment, then enter scores.', selectedYear, layoutToggle)}
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
      <section class="panel gradebook-score-panel">
        <div class="panel-title inline-title"><h2>Enter Scores</h2>${panelMeta ? `<span>- ${panelMeta}</span>` : ''}</div>
        ${scoreContent}
      </section>
      <section class="ledger assignment-history-panel">
        <div class="ledger-head"><h2>Assignment History</h2><p>Select an assignment to enter or revise scores.</p></div>
        <div class="assignment-history-list">
          ${historyRows}
        </div>
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
  const allowed = !selectedGrade || teacherAllowedForSelection(user, yearId, selectedGrade, 0);

  const assignments = selectedGrade && selectedSubjectId && allowed ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
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
  const students = selectedGrade && allowed ? querySql(`SELECT st.id, st.first_name, st.last_name
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
  if (!allowed) {
    rightPanel = `<section class="family-detail assignment-editor"><div class="family-detail-head"><h2>Assignments</h2></div><div class="family-detail-body">${emptyState('This grade is not assigned to your teacher account.')}</div></section>`;
  } else if (selectedAssignment) {
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

function reportDefinitions() {
  return [
    { key: 'families', title: 'Families', description: 'Household contact list with enrolled student counts.' },
    { key: 'students', title: 'Students', description: 'Students grouped by grade, room, and teacher.' },
    { key: 'school-board', title: 'School Board', description: 'Board member roles, contact details, and terms.' },
    { key: 'birthdays', title: 'Birthdays', description: 'Student birthdays grouped by month.' },
    { key: 'grade-graph', title: 'Grade Graph', description: 'Subject averages across marking periods.' }
  ];
}

function reportPath(key, yearId, extra = '') {
  return `/reports?yearId=${asInt(yearId)}${key ? `&report=${encodeURIComponent(key)}` : ''}${extra}`;
}

function reportsNav(activeReport, yearId) {
  return `<section class="report-nav-grid">
    ${reportDefinitions().map((report) => `<a class="report-tile ${activeReport === report.key ? 'active' : ''}" href="${reportPath(report.key, yearId)}">
      <span class="report-tile-icon">${REPORT_ICONS[report.key] || REPORT_ICONS['grade-graph']}</span>
      <span class="report-tile-copy">
        <strong>${esc(report.title)}</strong>
        <span>${esc(report.description)}</span>
      </span>
    </a>`).join('')}
  </section>`;
}

function reportMeterStyle(index, ratio) {
  const width = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)));
  const color = REPORT_METER_COLORS[index % REPORT_METER_COLORS.length];
  return `--bar-value:${width}%;--bar-color:${color};`;
}

function firstNameOnly(value) {
  return cleanText(value, 120).split(/\s+/).filter(Boolean)[0] || '';
}

function familyReportName(row) {
  const parents = [firstNameOnly(row.father_name), firstNameOnly(row.mother_name)].filter(Boolean).join(' & ');
  return parents ? `${row.family_name}, ${parents}` : row.family_name;
}

function studentLastFirst(student) {
  const first = [student.first_name, student.middle_name].filter(Boolean).join(' ');
  return `${student.last_name}${first ? `, ${first}` : ''}`;
}

function monthName(index) {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][index - 1] || '';
}

function formatDateShort(value) {
  const text = cleanDate(value);
  if (!text) return '';
  const [year, month, day] = text.split('-').map(Number);
  if (!month || !day) return text;
  return `${monthName(month)} ${day}${year ? `, ${year}` : ''}`;
}

function formatDateNumeric(value) {
  const text = cleanDate(value);
  if (!text) return '';
  const [year, month, day] = text.split('-').map(Number);
  if (!month || !day || !year) return text;
  return `${month}-${String(day).padStart(2, '0')}-${year}`;
}

function boardTermLabel(row) {
  const start = cleanDate(row.term_start);
  const end = cleanDate(row.term_end);
  if (start && end) return `${formatDateShort(start)} to ${formatDateShort(end)}`;
  if (start) return `Started ${formatDateShort(start)}`;
  if (end) return `Through ${formatDateShort(end)}`;
  return 'Not set';
}

function gradeOptionsFromRows(grades, selectedGrade, allLabel = 'All grades') {
  return `<option value="">${esc(allLabel)}</option>${grades.map((grade) => `<option value="${esc(grade)}" ${grade === selectedGrade ? 'selected' : ''}>${esc(grade)}</option>`).join('')}`;
}

function printReportHead(title, selectedYear, detail = '') {
  const settings = appSettings();
  const parts = [settings.schoolName, selectedYear?.name, detail].filter(Boolean);
  return `<header class="print-report-head">
    <h1>${esc(title)}</h1>
    <p>${parts.map(esc).join(' &middot; ')}</p>
  </header>`;
}

function reportOverview(yearId, selectedYear, user) {
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const kpis = {
    families: canAccessSetup(user) ? querySql('SELECT COUNT(*) AS count FROM os_families;')[0]?.count || 0 : 0,
    students: querySql(`SELECT COUNT(*) AS count
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
        ${accessClause};`)[0]?.count || 0,
    classrooms: canAccessSetup(user) ? querySql(`SELECT COUNT(*) AS count FROM os_classrooms WHERE school_year_id=${yearId};`)[0]?.count || 0 : querySql(`SELECT COUNT(DISTINCT sy.classroom_id) AS count
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
        ${accessClause};`)[0]?.count || 0,
    board: canAccessSetup(user) ? querySql(`SELECT COUNT(*) AS count
      FROM os_person_roles pr
      JOIN os_role_groups rg ON rg.id = pr.group_id
      WHERE rg.name='Board Members';`)[0]?.count || 0 : 0
  };
  const gradeRows = querySql(`SELECT sy.grade_level AS grade_level, COUNT(*) AS count
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
      ${accessClause}
    GROUP BY sy.grade_level;`);
  const sortedGrades = sortGrades(gradeRows.map((row) => row.grade_level));
  const gradesByName = new Map(gradeRows.map((row) => [row.grade_level, Number(row.count || 0)]));
  const largestGrade = Math.max(1, ...gradeRows.map((row) => Number(row.count || 0)));
  const birthdayRows = querySql(`SELECT CAST(strftime('%m', st.birth_date) AS INTEGER) AS month, COUNT(*) AS count
    FROM os_students st
    JOIN os_student_years sy ON sy.student_id = st.id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' AND st.birth_date IS NOT NULL AND st.birth_date != ''
      ${accessClause}
    GROUP BY month;`);
  const birthdayByMonth = new Map(birthdayRows.map((row) => [Number(row.month), Number(row.count || 0)]));
  const largestMonth = Math.max(1, ...birthdayRows.map((row) => Number(row.count || 0)));

  return `<div class="workspace">
    ${schoolYearHead('Reports', `Overview for ${selectedYear.name}.`, selectedYear, '<button class="secondary-btn" type="button" onclick="window.print()">Print</button>')}
    ${printReportHead('Reports', selectedYear, 'Overview')}
    <section class="report-kpis">
      <div class="report-kpi"><span>Families</span><strong>${kpis.families}</strong></div>
      <div class="report-kpi"><span>Students</span><strong>${kpis.students}</strong></div>
      <div class="report-kpi"><span>Classrooms</span><strong>${kpis.classrooms}</strong></div>
      <div class="report-kpi"><span>Board Roles</span><strong>${kpis.board}</strong></div>
    </section>
    ${reportsNav('', yearId)}
    <div class="report-summary">
      <section class="chart-panel">
        <div class="chart-head"><h2>Students by Grade</h2><span>${kpis.students} enrolled</span></div>
        <div class="bar-list">
          ${sortedGrades.map((grade, index) => {
            const count = gradesByName.get(grade) || 0;
            return `<div class="bar-row" style="${reportMeterStyle(index, count / largestGrade)}"><b>Grade ${esc(grade)}</b><div class="bar-track"><div class="bar-fill"></div></div><span>${count}</span></div>`;
          }).join('') || emptyState('No enrolled students for this school year.')}
        </div>
      </section>
      <section class="chart-panel">
        <div class="chart-head"><h2>Birthdays by Month</h2><span>${birthdayRows.reduce((sum, row) => sum + Number(row.count || 0), 0)} dated</span></div>
        <div class="distribution">
          ${Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const count = birthdayByMonth.get(month) || 0;
            return `<div class="distribution-row" style="${reportMeterStyle(index + 2, count / largestMonth)}"><b>${monthName(month).slice(0, 3)}</b><div class="bar-track"><div class="bar-fill"></div></div><span>${count}</span></div>`;
          }).join('')}
        </div>
      </section>
    </div>
  </div>`;
}

function familiesReport(yearId, selectedYear) {
  const rows = querySql(`SELECT f.id, f.family_name, f.father_name, f.mother_name, f.father_phone, f.mother_phone, f.phone, f.address,
      cng.name AS congregation_name,
      COUNT(sy.id) AS student_count
    FROM os_families f
    LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
    LEFT JOIN os_students st ON st.family_id = f.id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId} AND sy.status='enrolled'
    GROUP BY f.id
    ORDER BY f.family_name;`);
  return `${printReportHead('Families', selectedYear, `${rows.length} families`)}
  <section class="ledger family-report">
    <div class="ledger-head"><h2>Families</h2><p>Parent names, household contact information, and enrolled student counts.</p></div>
    <div class="table-wrap"><table>
      <tr><th>Family</th><th>Congregation</th><th>Address</th><th>Contact</th><th>Students</th></tr>
      ${rows.map((row) => {
        const contact = row.father_phone || row.mother_phone || row.phone || '';
        return `<tr>
          <td>${esc(familyReportName(row))}</td>
          <td>${esc(row.congregation_name || '') || '&mdash;'}</td>
          <td>${esc(row.address || '') || '&mdash;'}</td>
          <td>${esc(contact) || '&mdash;'}</td>
          <td>${Number(row.student_count || 0)}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5">${emptyState('No families have been entered yet.')}</td></tr>`}
    </table></div>
  </section>`;
}

function studentsReport(url, yearId, selectedYear, user) {
  const selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const gradeClause = selectedGrade ? `AND sy.grade_level=${sqlValue(selectedGrade)}` : '';
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const grades = sortGrades(querySql(`SELECT DISTINCT sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
      ${accessClause};`).map((row) => row.grade_level));
  const rows = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, st.birth_date,
      sy.grade_level, c.name AS classroom_name, t.name AS teacher_name
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    LEFT JOIN os_teachers t ON t.id = c.teacher_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' ${gradeClause}
      ${accessClause}
    ORDER BY st.last_name, st.first_name;`);
  const groupedGrades = sortGrades(rows.map((row) => row.grade_level));
  return `<div class="workspace">
    <section class="panel">
      <form method="get" action="/reports" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <input type="hidden" name="report" value="students" />
        <label>Grade<select name="grade" data-auto-submit>${gradeOptionsFromRows(grades, selectedGrade)}</select></label>
      </form>
    </section>
    ${printReportHead('Student Report', selectedYear, selectedGrade ? `Grade ${selectedGrade}` : 'All grades')}
    <section class="ledger student-report">
      <div class="ledger-head"><h2>Student Report</h2><p>Students grouped by grade with room and teacher assignments.</p></div>
      <div class="family-detail-body report-section-list">
        ${groupedGrades.map((grade) => {
          const gradeRows = rows.filter((row) => row.grade_level === grade);
          const rooms = [...new Set(gradeRows.map((row) => [row.classroom_name, row.teacher_name].filter(Boolean).join(' / ')).filter(Boolean))];
          return `<section class="report-grade-section">
            <div class="report-grade-head"><h3>Grade ${esc(grade)} <span>(${gradeRows.length})</span></h3><span>${rooms.map(esc).join(', ') || 'No room assigned'}</span></div>
            <div class="table-wrap compact-table"><table>
              <tr><th>Student</th><th>Birthday</th><th>Room</th><th>Teacher</th></tr>
              ${gradeRows.map((row) => `<tr>
                <td>${esc(studentLastFirst(row))}</td>
                <td>${esc(formatDateNumeric(row.birth_date)) || '&mdash;'}</td>
                <td>${esc(row.classroom_name || '') || '&mdash;'}</td>
                <td>${esc(row.teacher_name || '') || '&mdash;'}</td>
              </tr>`).join('')}
            </table></div>
          </section>`;
        }).join('') || emptyState('No enrolled students found for this report.')}
      </div>
    </section>
  </div>`;
}

function schoolBoardReport(selectedYear) {
  const rows = querySql(`SELECT pr.*, rt.name AS role_name,
      CASE pr.person_type WHEN 'father' THEN f.father_name WHEN 'mother' THEN f.mother_name ELSE t.name END AS person_name,
      CASE pr.person_type WHEN 'father' THEN f.address WHEN 'mother' THEN f.address ELSE t.address END AS address,
      CASE pr.person_type WHEN 'father' THEN COALESCE(f.father_phone, f.phone) WHEN 'mother' THEN COALESCE(f.mother_phone, f.phone) ELSE COALESCE(t.mobile_phone, t.phone) END AS phone
    FROM os_person_roles pr
    JOIN os_role_groups rg ON rg.id = pr.group_id
    JOIN os_role_types rt ON rt.id = pr.role_type_id
    LEFT JOIN os_families f ON f.id = pr.person_id AND pr.person_type IN ('father', 'mother')
    LEFT JOIN os_teachers t ON t.id = pr.person_id AND pr.person_type = 'teacher'
    WHERE rg.name='Board Members'
    ORDER BY rt.name, person_name;`);
  return `${printReportHead('School Board', selectedYear, `${rows.length} members`)}
  <section class="ledger board-report">
    <div class="ledger-head"><h2>School Board</h2><p>Board roles are pulled from the existing Board Members role group.</p></div>
    <div class="board-report-list">
      ${rows.map((row) => `<article class="board-report-row">
        <div><strong>${esc(row.person_name || '') || '&mdash;'}</strong><span>${esc(row.address || '') || '&mdash;'}</span></div>
        <div><span>${esc(row.phone || '') || '&mdash;'}</span></div>
        <div><strong>${row.is_assistant ? 'Assistant ' : ''}${esc(row.role_name)}</strong><span>${esc(boardTermLabel(row))}</span></div>
      </article>`).join('') || emptyState('No school board roles have been assigned yet.')}
    </div>
  </section>`;
}

function birthdaysReport(yearId, selectedYear, user) {
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const rows = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, st.birth_date,
      CAST(strftime('%m', st.birth_date) AS INTEGER) AS birth_month,
      CAST(strftime('%d', st.birth_date) AS INTEGER) AS birth_day,
      sy.grade_level, c.name AS classroom_name
    FROM os_students st
    JOIN os_student_years sy ON sy.student_id = st.id
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' AND st.birth_date IS NOT NULL AND st.birth_date != ''
      ${accessClause}
    ORDER BY birth_month, birth_day, st.last_name, st.first_name;`);
  return `${printReportHead('Student Birthdays', selectedYear)}
  <section class="ledger birthday-report">
    <div class="ledger-head"><h2>Student Birthdays</h2><p>Birthdays grouped by month for the selected school year.</p></div>
    <div class="family-detail-body">
      <div class="month-grid">
        ${Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const monthRows = rows.filter((row) => Number(row.birth_month) === month);
          return `<section class="month-block">
            <h3>${monthName(month)} <span>${monthRows.length} ${monthRows.length === 1 ? 'student' : 'students'}</span></h3>
            <ul class="birthday-list">
              ${monthRows.map((row) => `<li><b>${esc(studentDisplayName(row))}</b><span class="birthday-date">${esc(formatDateNumeric(row.birth_date))}</span><span class="birthday-meta">Grade ${esc(row.grade_level)}${row.classroom_name ? ` &middot; ${esc(row.classroom_name)}` : ''}</span></li>`).join('') || `<li><span>No birthdays listed.</span></li>`}
            </ul>
          </section>`;
        }).join('')}
      </div>
    </div>
  </section>`;
}

function graphColor(index) {
  return REPORT_METER_COLORS[index % REPORT_METER_COLORS.length];
}

function gradeGraphSvg(series, periods) {
  const W = 860, H = 320;
  const padL = 42, padR = 20, padT = 22, padB = 42;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const periodCount = Math.max(1, periods.length - 1);
  const toX = (index) => (padL + (periods.length === 1 ? chartW / 2 : (index / periodCount) * chartW)).toFixed(1);
  const toY = (value) => (padT + chartH - (clampPercent(value) / 100) * chartH).toFixed(1);
  const guides = [0, 25, 50, 75, 100].map((value) => {
    const y = toY(value);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="guide" /><text x="${padL - 7}" y="${Number(y) + 4}" text-anchor="end" class="label">${value}%</text>`;
  }).join('');
  const xLabels = periods.map((period, index) => `<text x="${toX(index)}" y="${H - 12}" text-anchor="middle" class="label">${esc(period.name)}</text>`).join('');
  const lines = series.map((item, index) => {
    const points = item.values.map((value, valueIndex) => ({ value, valueIndex })).filter((point) => Number.isFinite(Number(point.value)));
    const color = graphColor(index);
    const pathData = points.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${toX(point.valueIndex)} ${toY(point.value)}`).join(' ');
    const dots = points.map((point) => `<circle cx="${toX(point.valueIndex)}" cy="${toY(point.value)}" r="4" fill="${color}" class="dot" />`).join('');
    return pathData ? `<path d="${pathData}" class="line" stroke="${color}" />${dots}` : '';
  }).join('');
  const hasPoints = series.some((item) => item.values.some((value) => Number.isFinite(Number(value))));
  return `<svg class="grade-graph-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Subject averages by marking period">
    ${guides}
    <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" class="axis" />
    ${xLabels}
    ${lines}
    ${hasPoints ? '' : `<text x="${W / 2}" y="${padT + chartH / 2}" class="empty-msg">No scores available for this graph.</text>`}
  </svg>`;
}

function miniSubjectChartSvg(item, periods) {
  const W = 420, H = 150;
  const padL = 36, padR = 14, padT = 10, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const minY = 60;
  const maxY = 100;
  const periodCount = Math.max(1, periods.length - 1);
  const toX = (index) => padL + (periods.length === 1 ? chartW / 2 : (index / periodCount) * chartW);
  const toY = (value) => {
    const bounded = Math.max(minY, Math.min(maxY, Number(value)));
    return padT + chartH - ((bounded - minY) / (maxY - minY)) * chartH;
  };
  const values = item.values.map((value) => Number.isFinite(Number(value)) ? Number(value) : null);
  const points = values.map((value, index) => ({ value, index })).filter((point) => point.value !== null);
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.index).toFixed(1)} ${toY(point.value).toFixed(1)}`).join(' ');
  const dots = points.map((point) => `<circle cx="${toX(point.index).toFixed(1)}" cy="${toY(point.value).toFixed(1)}" r="3.4" fill="${item.color}" stroke="#fff" stroke-width="1.5" />`).join('');
  const guides = [60, 70, 80, 90, 100].map((value) => {
    const y = toY(value);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#d7d7d7" stroke-width="1" /><text x="${padL - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#555" font-size="9">${value}</text>`;
  }).join('');
  const labels = periods.map((period, index) => `<text x="${toX(index).toFixed(1)}" y="${H - 17}" text-anchor="middle" fill="#555" font-size="9">${esc(period.name.replace(/^Period\s+/i, 'P'))}</text>`).join('');
  const scoreLabels = values.map((value, index) => value === null ? '' : `<text x="${toX(index).toFixed(1)}" y="${H - 5}" text-anchor="middle" fill="#555" font-size="8">${Math.round(value)}%</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${guides}
    <line x1="${padL}" y1="${(padT + chartH).toFixed(1)}" x2="${W - padR}" y2="${(padT + chartH).toFixed(1)}" stroke="#aeb7c4" stroke-width="1" />
    ${line ? `<path d="${line}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}` : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#777" font-size="11">No scores</text>`}
    ${labels}
    ${scoreLabels}
  </svg>`;
}

function gradeGraphReport(url, yearId, selectedYear, user) {
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const grades = sortGrades(querySql(`SELECT DISTINCT sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
      ${accessClause};`).map((row) => row.grade_level));
  const selectedGrade = cleanGrade(url.searchParams.get('grade')) || grades[0] || '';
  const requestedScope = cleanText(url.searchParams.get('scope'), 12);
  const scope = requestedScope === 'student' ? 'student' : 'grade';
  const students = selectedGrade ? querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' AND sy.grade_level=${sqlValue(selectedGrade)}
      ${accessClause}
    ORDER BY st.last_name, st.first_name;`) : [];
  const selectedStudentId = scope === 'student' ? (asInt(url.searchParams.get('studentId')) || asInt(students[0]?.id)) : 0;
  const selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || null;
  const graphStudentIds = scope === 'student'
    ? (selectedStudent ? [asInt(selectedStudent.id)] : [])
    : students.map((student) => asInt(student.id));
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const subjects = selectedGrade ? querySql(`SELECT DISTINCT s.id, s.name
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    WHERE a.school_year_id=${yearId} AND a.grade_level=${sqlValue(selectedGrade)}
    ORDER BY s.name;`) : [];
  const graphPeriods = periods.length ? periods : [{ id: 0, name: 'Current', start_date: '', end_date: '' }];
  const series = subjects.map((subject, index) => ({
    id: subject.id,
    name: subject.name,
    color: graphColor(index),
    values: graphPeriods.map((period) => {
      if (!graphStudentIds.length) return null;
      const result = periodAverageRows(yearId, selectedGrade, asInt(subject.id), graphStudentIds, period);
      if (scope === 'student') return result.studentAverages.get(asInt(selectedStudent?.id)) ?? null;
      return result.classAverage;
    })
  }));
  const studentOptions = students.map((student) => `<option value="${student.id}" ${asInt(student.id) === selectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)}</option>`).join('');
  return `<div class="workspace grade-graph-report">
    <section class="panel">
      <form method="get" action="/reports" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        <input type="hidden" name="report" value="grade-graph" />
        <label>Scope<select name="scope" data-auto-submit><option value="grade" ${scope === 'grade' ? 'selected' : ''}>Full grade</option><option value="student" ${scope === 'student' ? 'selected' : ''}>Individual student</option></select></label>
        <label>Grade<select name="grade" data-auto-submit>${gradeOptionsFromRows(grades, selectedGrade, 'Choose grade')}</select></label>
        <label>Student<select name="studentId" ${scope === 'student' ? 'data-auto-submit' : ''}><option value="">Choose student</option>${studentOptions}</select></label>
      </form>
    </section>
    ${printReportHead(scope === 'student' && selectedStudent ? studentDisplayName(selectedStudent) : selectedGrade ? `Grade ${selectedGrade}` : 'Grade Graph', selectedYear, 'Grade Graph')}
    <section class="chart-panel grade-graph">
      <div class="grade-graph-screen">
        <div class="chart-head"><h2>Grade Graph</h2><span>${scope === 'student' && selectedStudent ? esc(studentDisplayName(selectedStudent)) : selectedGrade ? `Grade ${esc(selectedGrade)}` : 'No grade selected'}</span></div>
      </div>
      <div class="grade-graph-print-grid ${series.length === 1 ? 'single' : ''}">
        ${series.map((item) => {
          const finalAverage = average(item.values.filter((value) => Number.isFinite(Number(value))));
          return `<section class="mini-subject-chart" style="--subject-color:${item.color}">
            <header><h3>${esc(item.name)}</h3><span>Final Average ${formatPercent(finalAverage)}</span></header>
            ${miniSubjectChartSvg(item, graphPeriods)}
          </section>`;
        }).join('') || emptyState('No subjects with scores yet.')}
      </div>
    </section>
  </div>`;
}

function studentGradeGraphPanel(student, yearId, selectedYear) {
  if (!student) return emptyState('No child is linked to this parent account for the selected school year.');
  const selectedGrade = cleanGrade(student.grade_level);
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const graphPeriods = periods.length ? periods : [{ id: 0, name: 'Current', start_date: '', end_date: '' }];
  const subjects = selectedGrade ? querySql(`SELECT DISTINCT s.id, s.name
    FROM os_assignments a
    JOIN os_subjects s ON s.id = a.subject_id
    WHERE a.school_year_id=${yearId} AND a.grade_level=${sqlValue(selectedGrade)}
    ORDER BY s.name;`) : [];
  const series = subjects.map((subject, index) => ({
    id: subject.id,
    name: subject.name,
    color: graphColor(index),
    values: graphPeriods.map((period) => {
      const result = periodAverageRows(yearId, selectedGrade, asInt(subject.id), [asInt(student.id)], period);
      return result.studentAverages.get(asInt(student.id)) ?? null;
    })
  }));
  return `<section class="chart-panel grade-graph">
    <div class="grade-graph-screen">
      <div class="chart-head"><h2>Grade Graph</h2><span>${esc(studentDisplayName(student))} / Grade ${esc(selectedGrade)}</span></div>
    </div>
    <div class="grade-graph-print-grid ${series.length === 1 ? 'single' : ''}">
      ${series.map((item) => {
        const finalAverage = average(item.values.filter((value) => Number.isFinite(Number(value))));
        return `<section class="mini-subject-chart" style="--subject-color:${item.color}">
          <header><h3>${esc(item.name)}</h3><span>Final Average ${formatPercent(finalAverage)}</span></header>
          ${miniSubjectChartSvg(item, graphPeriods)}
        </section>`;
      }).join('') || emptyState('No subjects with scores yet.')}
    </div>
  </section>`;
}

function parentPage(url, user, selectedYear) {
  const yearId = asInt(selectedYear.id);
  if (!asInt(user.parent_family_id)) {
    return `<div class="workspace">${schoolYearHead('Parent Portal', 'Your account is not linked to a family yet.', selectedYear)}${emptyState('Ask a principal or admin to link this sign-in to your family record.')}</div>`;
  }
  const children = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, sy.grade_level
    FROM os_students st
    JOIN os_student_years sy ON sy.student_id = st.id
    WHERE st.family_id=${asInt(user.parent_family_id)}
      AND sy.school_year_id=${yearId}
      AND sy.status='enrolled'
    ORDER BY st.birth_date, st.last_name, st.first_name;`);
  const selectedStudentId = asInt(url.searchParams.get('studentId')) || asInt(children[0]?.id);
  const selectedStudent = children.find((student) => asInt(student.id) === selectedStudentId) || children[0] || null;
  const graph = studentGradeGraphPanel(selectedStudent, yearId, selectedYear);
  const reportCards = reportCardsPage(url, selectedYear, user, {
    formAction: '/parent',
    title: 'Report Card',
    description: 'View printable report cards for your children.',
    childPicker: true
  });
  return `<div class="workspace">
    ${schoolYearHead('Parent Portal', 'View grades and report cards for your children.', selectedYear)}
    ${graph}
  </div>
  ${reportCards}`;
}

function reportsPage(url, selectedYear, user) {
  const yearId = asInt(selectedYear.id);
  const activeReport = reportDefinitions().some((report) => report.key === url.searchParams.get('report')) ? url.searchParams.get('report') : '';
  const title = activeReport ? reportDefinitions().find((report) => report.key === activeReport).title : 'Reports';
  if (!canAccessSetup(user) && ['families', 'school-board'].includes(activeReport)) {
    return `<div class="workspace">${schoolYearHead('Reports', 'This report is only available to principals and admins.', selectedYear)}${emptyState('Choose a student or grade report instead.')}</div>`;
  }
  let content = '';
  if (activeReport === 'families') content = familiesReport(yearId, selectedYear);
  if (activeReport === 'students') content = studentsReport(url, yearId, selectedYear, user);
  if (activeReport === 'school-board') content = schoolBoardReport(selectedYear);
  if (activeReport === 'birthdays') content = birthdaysReport(yearId, selectedYear, user);
  if (activeReport === 'grade-graph') content = gradeGraphReport(url, yearId, selectedYear, user);
  if (!activeReport) return reportOverview(yearId, selectedYear, user);

  return `<div class="workspace">
    ${schoolYearHead(title, reportDefinitions().find((report) => report.key === activeReport).description, selectedYear, '<button class="secondary-btn" type="button" onclick="window.print()">Print</button>')}
    ${reportsNav(activeReport, yearId)}
    ${content}
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

function formatAbsenceKind(kind) {
  return cleanText(kind, 20).toLowerCase() === 'tardy' ? 'Tardy' : 'Absence';
}

function absenceKindClass(kind) {
  return formatAbsenceKind(kind).toLowerCase();
}

function formatAbsenceAmount(row) {
  const amount = Number(row.amount) || 0;
  const unit = row.unit === 'hours' ? 'hour' : 'day';
  return `${formatAbsence(amount)} ${unit}${amount === 1 ? '' : 's'}`;
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

function reportCardsPage(url, selectedYear, user, options = {}) {
  const yearId = asInt(selectedYear.id);
  const settings = appSettings();
  let selectedGrade = cleanGrade(url.searchParams.get('grade'));
  const selectedStudentId = asInt(url.searchParams.get('studentId'));
  const selectedPeriodId = asInt(url.searchParams.get('markingPeriodId'));
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const allAccessibleStudents = querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
      ${accessClause}
    ORDER BY st.last_name, st.first_name;`);
  const grades = sortGrades(allAccessibleStudents.map((row) => row.grade_level));
  if (options.childPicker && !selectedStudentId && allAccessibleStudents[0]) selectedGrade = allAccessibleStudents[0].grade_level;
  if (options.childPicker && selectedStudentId) selectedGrade = allAccessibleStudents.find((student) => asInt(student.id) === selectedStudentId)?.grade_level || '';
  const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) || (options.childPicker ? periods[0] : null);
  const students = options.childPicker ? allAccessibleStudents : allAccessibleStudents.filter((student) => student.grade_level === selectedGrade);
  const selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || (options.childPicker ? students[0] : null);
  if (selectedStudent) selectedGrade = selectedStudent.grade_level;
  const effectiveSelectedStudentId = asInt(selectedStudent?.id);
  const effectiveSelectedPeriodId = asInt(selectedPeriod?.id);
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
  const studentSelect = `<select name="studentId" required data-auto-submit><option value="">Student</option>${students.map((student) => `<option value="${student.id}" ${asInt(student.id) === effectiveSelectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)}</option>`).join('')}</select>`;
  const periodSelect = `<select name="markingPeriodId" required data-auto-submit><option value="">Marking Period</option>${periods.map((period) => `<option value="${period.id}" ${asInt(period.id) === effectiveSelectedPeriodId ? 'selected' : ''}>${esc(period.name)}</option>`).join('')}</select>`;
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
    ${schoolYearHead(options.title || 'Report Cards', options.description || 'Generate printable report cards from marking periods and grade weights.', selectedYear)}
    <section class="panel">
      <form method="get" action="${esc(options.formAction || '/report-cards')}" class="filters">
        <input type="hidden" name="yearId" value="${yearId}" />
        ${options.childPicker ? '' : `<label>Grade${gradeSelect}</label>`}
        <label>Student${studentSelect}</label>
        <label>Marking Period${periodSelect}</label>
        <button type="submit">Load Report Card</button>
      </form>
    </section>
    ${selectedStudent && selectedPeriod ? `<div class="report-card-actions"><button type="button" class="page-action compact-action" data-filename="${esc(pdfFilename)}" onclick="generateReportCardPdf(this)">Generate PDF</button></div>` : ''}
    ${preview}
  </div>`;
}

function absencesPage(url, selectedYear, csrfToken, user) {
  const yearId = asInt(selectedYear.id);
  const action = cleanText(url.searchParams.get('action'), 40);
  const accessClause = studentAccessClause(user, yearId, 'st', 'sy');
  const students = querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
    FROM os_student_years sy
    JOIN os_students st ON st.id = sy.student_id
    WHERE sy.school_year_id=${yearId} AND sy.status='enrolled'
      ${accessClause}
    ORDER BY sy.grade_level, st.last_name, st.first_name;`);
  students.sort((a, b) => gradeRank(a.grade_level) - gradeRank(b.grade_level)
    || String(a.last_name).localeCompare(String(b.last_name))
    || String(a.first_name).localeCompare(String(b.first_name)));
  const grades = sortGrades(students.map((student) => student.grade_level));
  let selectedGrade = cleanGrade(url.searchParams.get('grade'));
  if (selectedGrade && !grades.includes(selectedGrade)) selectedGrade = '';
  let selectedStudentId = asInt(url.searchParams.get('studentId'));
  let selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || null;
  if (selectedStudentId && (!selectedStudent || (selectedGrade && selectedStudent.grade_level !== selectedGrade))) {
    selectedStudentId = 0;
    selectedStudent = null;
  }
  const filteredStudentOptions = selectedGrade ? students.filter((student) => student.grade_level === selectedGrade) : students;
  const gradeClause = selectedGrade ? `AND sy.grade_level=${sqlValue(selectedGrade)}` : '';
  const studentClause = selectedStudentId ? `AND st.id=${selectedStudentId}` : '';
  const absences = querySql(`SELECT a.*, st.first_name, st.last_name, sy.grade_level
    FROM os_absences a
    JOIN os_students st ON st.id = a.student_id
    JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id = a.school_year_id AND sy.status='enrolled'
    WHERE a.school_year_id=${yearId}
      ${accessClause}
      ${gradeClause}
      ${studentClause}
    ORDER BY a.absence_date DESC, st.last_name, st.first_name
    LIMIT 80;`);
  const filterParams = new URLSearchParams();
  filterParams.set('yearId', String(yearId));
  if (selectedGrade) filterParams.set('grade', selectedGrade);
  if (selectedStudentId) filterParams.set('studentId', String(selectedStudentId));
  const filterQuery = filterParams.toString();
  const listPath = `/absences${filterQuery ? `?${filterQuery}` : ''}`;
  const addPath = `/absences?action=add${filterQuery ? `&${filterQuery}` : ''}`;
  const studentOptions = students.map((student) => `<option value="${student.id}">${esc(student.last_name)}, ${esc(student.first_name)} - Grade ${esc(student.grade_level)}</option>`).join('');
  const filterStudentOptions = filteredStudentOptions.map((student) => `<option value="${student.id}" ${asInt(student.id) === selectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)} - Grade ${esc(student.grade_level)}</option>`).join('');
  const filters = `<form method="get" action="/absences" class="absence-header-filters">
    <input type="hidden" name="yearId" value="${yearId}" />
    <span class="absence-filter-label">Filter</span>
    <select name="grade" data-auto-submit aria-label="Filter by grade">${gradeOptionsFromRows(grades, selectedGrade)}</select>
    <select name="studentId" data-auto-submit aria-label="Filter by student"><option value="">All students</option>${filterStudentOptions}</select>
    ${selectedGrade || selectedStudentId ? `<a class="secondary-btn compact-action absence-clear-filter" href="/absences?yearId=${yearId}">Clear</a>` : ''}
  </form>`;
  const addForm = `<section class="family-detail">
    <div class="family-detail-head"><h2>Add Absence</h2><a class="secondary-btn compact-action" href="${listPath}">Cancel</a></div>
    <div class="family-detail-body">
      <form method="post" action="/absences" class="form-grid absence-form">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <label class="absence-date-field">Date<input type="date" name="absenceDate" required value="${new Date().toISOString().slice(0, 10)}" /></label>
        <label class="absence-student-field">Student<select name="studentId" required><option value="">Choose student</option>${studentOptions}</select></label>
        <fieldset class="choice-field">
          <legend>Type</legend>
          <div class="choice-group">
            <label class="choice-pill"><input type="radio" name="kind" value="absence" checked /><span>Absence</span></label>
            <label class="choice-pill"><input type="radio" name="kind" value="tardy" /><span>Tardy</span></label>
          </div>
        </fieldset>
        <label class="absence-amount-field">Amount<input type="number" name="amount" min="0" max="30" step="0.25" value="1" required /></label>
        <fieldset class="choice-field">
          <legend>Unit</legend>
          <div class="choice-group">
            <label class="choice-pill"><input type="radio" name="unit" value="days" checked /><span>Days</span></label>
            <label class="choice-pill"><input type="radio" name="unit" value="hours" /><span>Hours</span></label>
          </div>
        </fieldset>
        <label class="absence-notes-field">Notes<textarea name="notes" maxlength="400"></textarea></label>
        <button class="absence-submit" type="submit">Save Absence</button>
      </form>
    </div>
  </section>`;
  const list = `<section class="family-detail">
    <div class="family-detail-head absence-list-head">
      <h2>Absences</h2>
      <div class="absence-list-actions">
        ${filters}
        <span class="family-count">${absences.length}</span>
        <a class="page-action compact-action" href="${addPath}">Add</a>
      </div>
    </div>
    <div class="family-detail-body">
      <div class="table-wrap compact-table"><table class="absence-table">
        <tr><th>Date</th><th>Student</th><th>Grade</th><th>Type</th><th>Amount</th><th>Notes</th></tr>
        ${absences.map((row) => `<tr>
          <td class="absence-date-cell">${esc(row.absence_date)}</td>
          <td class="absence-student-cell">${esc(row.last_name)}, ${esc(row.first_name)}</td>
          <td class="absence-grade-cell">Grade ${esc(row.grade_level || '')}</td>
          <td class="absence-kind-cell"><span class="absence-kind ${absenceKindClass(row.kind)}">${esc(formatAbsenceKind(row.kind))}</span></td>
          <td class="absence-amount-cell">${esc(formatAbsenceAmount(row))}</td>
          <td>${esc(row.notes || '') || '&mdash;'}</td>
        </tr>`).join('') || `<tr><td colspan="6">${emptyState('No absences recorded for this school year.')}</td></tr>`}
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

async function handlePost(req, res, p, body, user, headers) {
  if (p === '/login') {
    if (!requireCsrf(req, body)) return sendText(res, 403, 'Invalid CSRF token');
    const username = cleanText(body.username, 80).toLowerCase();
    const password = String(body.password || '').slice(0, 120);
    const throttle = loginThrottleStatus(req, username);
    if (throttle) return sendText(res, 429, 'Too many sign-in attempts. Please try again later.', { 'Retry-After': String(throttle.retryAfter) });
    const row = querySql(`SELECT * FROM os_users WHERE username=${sqlValue(username)} LIMIT 1;`)[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      recordLoginFailure(req, username);
      return redirect(res, '/login?error=1', headers);
    }
    clearSession(req, headers);
    clearLoginFailures(req, username);
    createSession(row.id, headers);
    return redirect(res, '/', headers);
  }

  if (!user) return redirect(res, '/login', headers);

  if (DEMO_MODE && DEMO_HIDDEN_POST_PATHS.has(p)) {
    return p.startsWith('/system-update')
      ? sendJson(res, 404, { error: 'Not Found' }, headers)
      : sendText(res, 404, 'Not Found');
  }

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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const familyId = asInt(body.familyId);
    if (familyId) {
      runSql(`UPDATE os_families
        SET family_name=${sqlValue(cleanText(body.familyName, 120))},
            school_district_id=${asInt(body.schoolDistrictId) || 'NULL'},
            congregation_id=${asInt(body.congregationId) || 'NULL'},
            father_name=${sqlValue(firstNameOnly(body.fatherName))},
            mother_name=${sqlValue(firstNameOnly(body.motherName))},
            father_phone=${sqlValue(cleanText(body.fatherPhone, 40))},
            mother_phone=${sqlValue(cleanText(body.motherPhone, 40))},
            phone=${sqlValue(cleanText(body.fatherPhone, 40))},
            email=${sqlValue(cleanText(body.email, 160))},
            address=${sqlValue(cleanText(body.address, 220))}
        WHERE id=${familyId};`);
      return redirect(res, `/setup?section=families&familyId=${familyId}`, headers);
    }
    const newFamilyId = insertReturningId(`INSERT INTO os_families (family_name, school_district_id, congregation_id, father_name, mother_name, father_phone, mother_phone, phone, email, address)
      VALUES (${sqlValue(cleanText(body.familyName, 120))}, ${asInt(body.schoolDistrictId) || 'NULL'}, ${asInt(body.congregationId) || 'NULL'}, ${sqlValue(firstNameOnly(body.fatherName))}, ${sqlValue(firstNameOnly(body.motherName))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.motherPhone, 40))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.address, 220))})`);
    return redirect(res, `/setup?section=families&familyId=${newFamilyId}`, headers);
  }

  if (p === '/school-districts') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const districtId = asInt(body.districtId);
    if (districtId) {
      runSql(`UPDATE os_school_districts SET name=${sqlValue(cleanText(body.name, 140))} WHERE id=${districtId};`);
      return redirect(res, '/setup?section=districts', headers);
    }
    runSql(`INSERT OR IGNORE INTO os_school_districts (name) VALUES (${sqlValue(cleanText(body.name, 140))});`);
    return redirect(res, '/setup?section=districts', headers);
  }

  if (p === '/congregations') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const congregationId = asInt(body.congregationId);
    if (congregationId) {
      runSql(`UPDATE os_congregations SET name=${sqlValue(cleanText(body.name, 140))} WHERE id=${congregationId};`);
      return redirect(res, '/setup?section=congregations', headers);
    }
    runSql(`INSERT OR IGNORE INTO os_congregations (name) VALUES (${sqlValue(cleanText(body.name, 140))});`);
    return redirect(res, '/setup?section=congregations', headers);
  }

  if (p === '/students') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    runSql(`INSERT OR REPLACE INTO os_student_years (student_id, school_year_id, grade_level, classroom_id, status)
      VALUES (${asInt(body.studentId)}, ${asInt(body.schoolYearId)}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'}, 'enrolled');`);
    const family = querySql(`SELECT family_id FROM os_students WHERE id=${asInt(body.studentId)} LIMIT 1;`)[0];
    return redirect(res, `/setup?section=families&familyId=${asInt(family?.family_id)}`, headers);
  }

  if (p === '/absences') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    if (!canModifyStudentAcademicRecord(user, asInt(body.studentId), asInt(body.schoolYearId))) return sendText(res, 403, 'Forbidden');
    const kind = cleanText(body.kind, 20).toLowerCase() === 'tardy' ? 'tardy' : 'absence';
    const unit = cleanText(body.unit, 20).toLowerCase() === 'hours' ? 'hours' : 'days';
    const amount = Math.max(0, Math.min(30, Number(body.amount) || 0));
    runSql(`INSERT INTO os_absences (school_year_id, student_id, absence_date, kind, amount, unit, notes)
      VALUES (${asInt(body.schoolYearId)}, ${asInt(body.studentId)}, ${sqlValue(cleanDate(body.absenceDate))}, ${sqlValue(kind)}, ${amount}, ${sqlValue(unit)}, ${sqlValue(cleanText(body.notes, 400))});`);
    return redirect(res, '/absences', headers);
  }

  if (p === '/teachers') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    runSql(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id)
      VALUES (${asInt(body.schoolYearId)}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.subjectId)});`);
    return redirect(res, '/setup?section=subjects', headers);
  }

  if (p === '/school-years') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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
    if (!canManageSchoolUsers(user)) return sendText(res, 403, 'Forbidden');
    const role = cleanText(body.role, 20).toLowerCase();
    if (!ROLES.includes(role)) return sendText(res, 400, 'Invalid role');
    if ([ROLE_ADMIN, ROLE_PRINCIPAL].includes(role) && !canManageAdminUsers(user)) return sendText(res, 403, 'Only admins can manage admin or principal users.');
    const userId = asInt(body.userId);
    const existingUser = userId ? querySql(`SELECT id, role FROM os_users WHERE id=${userId} LIMIT 1;`)[0] : null;
    if ([ROLE_ADMIN, ROLE_PRINCIPAL].includes(existingUser?.role) && !canManageAdminUsers(user)) return sendText(res, 403, 'Only admins can manage admin or principal users.');
    const teacherId = role === ROLE_TEACHER ? asInt(body.teacherId) : 0;
    const parentFamilyId = role === ROLE_PARENT ? asInt(body.parentFamilyId) : 0;
    if (role === ROLE_TEACHER && !teacherId) return sendText(res, 400, 'Teacher users require a teacher link.');
    if (role === ROLE_PARENT && !parentFamilyId) return sendText(res, 400, 'Parent users require a family link.');
    if (userId) {
      const password = String(body.password || '').slice(0, 120);
      const passwordSql = password ? `, password_hash=${sqlValue(hashPassword(password))}` : '';
      runSql(`UPDATE os_users
        SET name=${sqlValue(cleanText(body.name, 120))},
            username=${sqlValue(cleanText(body.username, 80).toLowerCase())},
            role=${sqlValue(role)},
            teacher_id=${role === ROLE_TEACHER ? teacherId : 'NULL'},
            parent_family_id=${role === ROLE_PARENT ? parentFamilyId : 'NULL'}
            ${passwordSql}
        WHERE id=${userId};`);
      return redirect(res, '/setup?section=users', headers);
    }
    runSql(`INSERT INTO os_users (name, username, role, password_hash, teacher_id, parent_family_id)
      VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.username, 80).toLowerCase())}, ${sqlValue(role)}, ${sqlValue(hashPassword(String(body.password || '').slice(0, 120)))}, ${role === ROLE_TEACHER ? teacherId : 'NULL'}, ${role === ROLE_PARENT ? parentFamilyId : 'NULL'});`);
    return redirect(res, '/setup?section=users', headers);
  }

  if (p === '/grade-weights') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
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

  if (p === '/letter-grades') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const groupId = asInt(body.letterGroupId);
    const name = cleanText(body.name, 120) || 'Letter Grades';
    const subjectId = asInt(body.subjectId);
    const minGrade = cleanGrade(body.minGrade) || '1';
    const maxGrade = cleanGrade(body.maxGrade) || '12';
    const savedGroupId = groupId || insertReturningId(`INSERT INTO os_letter_grade_groups (school_year_id, name, min_grade, max_grade, subject_id)
      VALUES (${schoolYearId}, ${sqlValue(name)}, ${sqlValue(minGrade)}, ${sqlValue(maxGrade)}, ${subjectId || 'NULL'})`);
    if (groupId) {
      runSql(`UPDATE os_letter_grade_groups
        SET name=${sqlValue(name)},
            min_grade=${sqlValue(minGrade)},
            max_grade=${sqlValue(maxGrade)},
            subject_id=${subjectId || 'NULL'}
        WHERE id=${groupId};`);
      runSql(`DELETE FROM os_letter_grade_items WHERE group_id=${groupId};`);
    }
    Object.keys(body)
      .filter((key) => /^letter_\d+$/.test(key))
      .map((key) => Number(key.replace('letter_', '')))
      .sort((a, b) => a - b)
      .forEach((index) => {
        const letter = cleanText(body[`letter_${index}`], 12);
        const threshold = Number(body[`threshold_${index}`]);
        if (!letter || !Number.isFinite(threshold)) return;
        runSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
          VALUES (${savedGroupId}, ${sqlValue(letter)}, ${Math.max(0, Math.min(100, threshold))}, ${index});`);
      });
    const itemCount = querySql(`SELECT COUNT(*) AS count FROM os_letter_grade_items WHERE group_id=${savedGroupId};`)[0]?.count || 0;
    if (!itemCount) {
      DEFAULT_LETTER_GRADES.forEach(([letter, threshold], index) => {
        runSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
          VALUES (${savedGroupId}, ${sqlValue(letter)}, ${Number(threshold)}, ${index});`);
      });
    }
    return redirect(res, '/setup?section=letter-grades', headers);
  }

  if (p === '/system-settings') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const schoolName = cleanText(body.schoolName, 120) || DEFAULT_SCHOOL_NAME;
    setSetting('school_name', schoolName);
    const logoPath = saveUploadedImage(body.logo, 'logo');
    if (logoPath) setSetting('logo_path', logoPath);
    const faviconPath = saveUploadedImage(body.favicon, 'favicon');
    if (faviconPath) setSetting('favicon_path', faviconPath);
    return redirect(res, '/setup?section=settings', headers);
  }

  if (p === '/network-settings') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    if (process.env.HOST || process.env.PORT) return sendText(res, 400, 'Network settings are managed by HOST or PORT environment variables.');
    const bindHost = networkAccessHostForMode(body.accessMode) || '127.0.0.1';
    const port = parsePort(body.port, DEFAULT_PORT);
    setSetting('network_bind_host', bindHost);
    setSetting('network_port', String(port));
    setSetting('network_restart_required_at', new Date().toISOString());
    return redirect(res, '/setup?section=network', headers);
  }

  if (p === '/backup-settings') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    setSetting('backup_frequency', backupFrequency(body.frequency));
    return redirect(res, '/setup?section=backups', headers);
  }

  if (p === '/backup/create') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    createDatabaseBackup('manual');
    return redirect(res, '/setup?section=backups', headers);
  }

  if (p === '/backup/restore') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    createDatabaseBackup('pre-restore');
    const uploaded = body.backupFile?.data?.length ? body.backupFile : null;
    let source = '';
    if (uploaded) {
      if (!String(uploaded.filename || '').toLowerCase().endsWith('.db')) return sendText(res, 400, 'Upload a .db backup file.');
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      source = path.join(BACKUP_DIR, `oakstead-backup-${timestampForFile()}-uploaded.db`);
      fs.writeFileSync(source, uploaded.data);
    } else {
      source = backupPath(body.backupFileName);
    }
    if (!source || !fs.existsSync(source)) return sendText(res, 400, 'Backup file not found.');
    validateBackupDatabase(source);
    fs.copyFileSync(source, DB_FILE);
    setSetting('backup_last_restore_at', new Date().toISOString());
    return redirect(res, '/setup?section=backups', headers);
  }

  if (p === '/system-update/check') {
    if (!canManageSchoolSetup(user)) return sendJson(res, 403, { error: 'Forbidden' });
    try {
      return sendJson(res, 200, await checkLatestRelease(cleanText(body.channel, 20)), headers);
    } catch (error) {
      const status = writeUpdateStatus({ running: false, phase: 'check failed', percent: 0, message: error.message || 'Update check failed.', log: [updateLog(`ERROR ${error.message || error}`)] });
      return sendJson(res, 500, status, headers);
    }
  }

  if (p === '/system-update') {
    if (!canManageSchoolSetup(user)) return sendJson(res, 403, { error: 'Forbidden' });
    try {
      const status = await startSystemUpdate(cleanText(body.channel, 20));
      return sendJson(res, 202, status, headers);
    } catch (error) {
      const status = writeUpdateStatus({ running: false, phase: 'update failed', percent: 100, message: error.message || 'Update failed.', log: [updateLog(`ERROR ${error.message || error}`)] });
      return sendJson(res, 500, status, headers);
    }
  }

  if (p === '/gradebook') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    const schoolYearId = asInt(body.schoolYearId);
    const markingPeriodId = asInt(body.markingPeriodId);
    const gradeLevel = cleanGrade(body.gradeLevel);
    const subjectId = asInt(body.subjectId);
    const existingAssignmentId = asInt(body.assignmentId);
    const scoreMode = cleanScoreMode(body.scoreMode);
    if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel)) return sendText(res, 403, 'Forbidden');
    const gridRedirectTo = gradebookRedirectUrl({
      schoolYearId,
      markingPeriodId,
      gradeLevel,
      subjectId,
      scoreMode,
      gridMode: 'on'
    });
    if (body.action === 'grid-score') {
      const assignmentId = asInt(body.assignmentId);
      const studentId = asInt(body.studentId);
      if (!canModifyStudentAcademicRecord(user, studentId, schoolYearId)) return sendJson(res, 403, { ok: false, error: 'Forbidden' }, headers);
      const assignment = querySql(`SELECT id, max_score FROM os_assignments
        WHERE id=${assignmentId}
          AND school_year_id=${schoolYearId}
          AND grade_level=${sqlValue(gradeLevel)}
          AND subject_id=${subjectId}
        LIMIT 1;`)[0];
      if (!assignment || !studentId) return sendJson(res, 400, { ok: false, error: 'Invalid score cell' }, headers);
      const rawValue = String(body.scoreValue ?? '').trim();
      let percent = null;
      if (!rawValue) {
        runSql(`DELETE FROM os_scores WHERE assignment_id=${assignmentId} AND student_id=${studentId};`);
      } else {
        const maxScore = asPoints(assignment.max_score);
        const score = scoreInputToPoints(rawValue, scoreMode, maxScore);
        if (score === null) return sendJson(res, 400, { ok: false, error: 'Invalid score' }, headers);
        runSql(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
          ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score;`);
        percent = maxScore > 0 ? (score / maxScore) * 100 : null;
      }
      const scale = letterGradeScale(schoolYearId, gradeLevel, subjectId);
      const period = querySql(`SELECT * FROM os_marking_periods WHERE id=${markingPeriodId} AND school_year_id=${schoolYearId} LIMIT 1;`)[0] || null;
      const assignmentAverage = querySql(`SELECT ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
        FROM os_assignments a
        LEFT JOIN os_scores sc ON sc.assignment_id = a.id
        WHERE a.id=${assignmentId};`)[0]?.avg_score ?? null;
      const studentIds = querySql(`SELECT student_id FROM os_student_years
        JOIN os_students st ON st.id = os_student_years.student_id
        WHERE school_year_id=${schoolYearId}
          AND grade_level=${sqlValue(gradeLevel)}
          AND status='enrolled'
          ${studentAccessClause(user, schoolYearId, 'st', 'os_student_years')};`).map((row) => asInt(row.student_id)).filter(Boolean);
      const averageData = periodAverageRows(schoolYearId, gradeLevel, subjectId, studentIds, period);
      const studentAverage = averageData.studentAverages.get(studentId);
      return sendJson(res, 200, {
        ok: true,
        assignmentId,
        studentId,
        percent,
        letter: gradebookLetter(percent, scale),
        display: {
          assignmentAverage: gradebookDisplayScore(assignmentAverage, scale),
          studentAverage: gradebookDisplayScore(studentAverage, scale),
          classAverage: gradebookDisplayScore(averageData.classAverage, scale)
        }
      }, headers);
    }
    if (body.action === 'update-assignment') {
      const assignmentId = asInt(body.assignmentId);
      const assignment = querySql(`SELECT id FROM os_assignments
        WHERE id=${assignmentId}
          AND school_year_id=${schoolYearId}
          AND grade_level=${sqlValue(gradeLevel)}
          AND subject_id=${subjectId}
        LIMIT 1;`)[0];
      if (!assignment) return sendText(res, 404, 'Assignment not found');
      if (body.deleteAssignment) {
        runSql(`DELETE FROM os_assignments WHERE id=${assignmentId};`);
        return redirect(res, gridRedirectTo, headers);
      }
      runSql(`UPDATE os_assignments
        SET title=${sqlValue(cleanText(body.title, 140))},
            category=${sqlValue(normalizeCategory(body.category))},
            assignment_date=${sqlValue(cleanDate(body.assignmentDate))},
            max_score=${asPoints(body.maxScore)}
        WHERE id=${assignmentId};`);
      return redirect(res, gridRedirectTo, headers);
    }
    if (body.action === 'add-assignment') {
      const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : 'NULL';
      const maxScore = asPoints(body.maxScore);
      insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, marking_period_id, title, category, assignment_date, max_score, teacher_id)
        VALUES (${schoolYearId}, ${sqlValue(gradeLevel)}, ${subjectId}, ${markingPeriodId || 'NULL'}, ${sqlValue(cleanText(body.title, 140))}, ${sqlValue(normalizeCategory(body.category))}, ${sqlValue(cleanDate(body.assignmentDate))}, ${maxScore}, ${teacherId})`);
      return redirect(res, gridRedirectTo, headers);
    }
    if (body.action === 'grid-scores') {
      if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      const scoreEntries = gridScoreEntries(body);
      const assignmentIds = new Set(scoreEntries.map((entry) => asInt(entry.assignmentId)));
      const submittedStudentIds = scoreEntries.map((entry) => asInt(entry.studentId)).filter(Boolean);
      if (submittedStudentIds.some((studentId) => !canModifyStudentAcademicRecord(user, studentId, schoolYearId))) return sendText(res, 403, 'Forbidden');
      const allowedAssignments = assignmentIds.size ? new Map(querySql(`SELECT id, max_score FROM os_assignments
        WHERE school_year_id=${schoolYearId}
          AND grade_level=${sqlValue(gradeLevel)}
          AND subject_id=${subjectId}
          AND id IN (${[...assignmentIds].map(asInt).join(',')});`).map((row) => [asInt(row.id), asPoints(row.max_score)])) : new Map();
      scoreEntries.forEach(({ key, assignmentId, studentId }) => {
        const maxScore = allowedAssignments.get(assignmentId);
        if (!maxScore) return;
        const score = scoreInputToPoints(body[key], scoreMode, maxScore);
        if (score === null) return;
        runSql(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
          ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score;`);
      });
      return redirect(res, gridRedirectTo, headers);
    }
    const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : 'NULL';
    const maxScore = existingAssignmentId
      ? asPoints(querySql(`SELECT max_score FROM os_assignments WHERE id=${existingAssignmentId} AND school_year_id=${schoolYearId} LIMIT 1;`)[0]?.max_score)
      : asPoints(body.maxScore);
    if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    const assignmentId = existingAssignmentId || insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, marking_period_id, title, category, assignment_date, max_score, teacher_id)
      VALUES (${schoolYearId}, ${sqlValue(gradeLevel)}, ${subjectId}, ${markingPeriodId || 'NULL'}, ${sqlValue(cleanText(body.title, 140))}, ${sqlValue(normalizeCategory(body.category))}, ${sqlValue(cleanDate(body.assignmentDate))}, ${maxScore}, ${teacherId})`);
    const scoreEntries = scoreFieldEntries(body);
    const scoreStudentIds = scoreEntries.map((entry) => entry.studentId);
    if (scoreStudentIds.some((studentId) => !canModifyStudentAcademicRecord(user, studentId, schoolYearId))) return sendText(res, 403, 'Forbidden');
    scoreEntries.forEach(({ key, studentId }) => {
      if (!canModifyStudentAcademicRecord(user, studentId, schoolYearId)) return;
      const score = scoreInputToPoints(body[key], scoreMode, maxScore);
      if (score === null) return;
      runSql(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score;`);
    });
    return redirect(res, gradebookRedirectUrl({
      schoolYearId,
      markingPeriodId,
      gradeLevel,
      subjectId,
      scoreMode,
      assignmentId,
      gridMode: body.gridMode
    }), headers);
  }

  if (p === '/assignments') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
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
      const scoreEntries = scoreFieldEntries(body);
      const scoreStudentIds = scoreEntries.map((entry) => entry.studentId);
      if (scoreStudentIds.some((studentId) => !canModifyStudentAcademicRecord(user, studentId, schoolYearId))) return sendText(res, 403, 'Forbidden');
      scoreEntries.forEach(({ key, studentId }) => {
        if (!canModifyStudentAcademicRecord(user, studentId, schoolYearId)) return;
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

if (process.argv[2] === '--run-system-update') {
  ensureRuntimeDirs();
  if (UPDATE_MODE === 'installer') {
    writeUpdateStatus({
      running: false,
      phase: 'unsupported',
      percent: 100,
      message: 'Packaged installs use installer downloads instead of Git updates.',
      log: [updateLog('Git update worker was skipped in installer mode')]
    });
    return;
  }
  runSystemUpdateWorker(process.argv[3] === 'prerelease' ? 'prerelease' : 'stable');
  return;
}

if (process.argv[2] === '--network-status' || process.argv[2] === '--set-network-access') {
  ensureRuntimeDirs();
  ensureDb();
  if (process.argv[2] === '--network-status') {
    printNetworkStatus();
  } else if (!setNetworkAccessFromCli(process.argv.slice(3))) {
    process.exitCode = 1;
  }
  return;
}

ensureRuntimeDirs();
ensureDb();
ACTIVE_NETWORK = desiredNetworkConfig();
if (DEMO_MODE) {
  refreshDemoData('startup');
  setInterval(() => refreshDemoData('scheduled'), DEMO_REFRESH_HOURS * 60 * 60 * 1000).unref();
}
runScheduledBackupIfDue();

function sendAssetFile(res, filePath, missingMessage) {
  if (!fs.existsSync(filePath)) return sendText(res, 404, missingMessage);
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': 'no-cache'
  });
  return res.end(fs.readFileSync(filePath));
}

function selectedPageContext(req, url, pathname, csrfToken, user) {
  const { years, selected } = getSelectedYear(req, url);
  if (!selected) return null;
  return {
    selected,
    pageArgs: { csrfToken, user, years, selectedYear: selected, currentPath: pathname }
  };
}

function sendAppPage(res, headers, pageArgs, title, content) {
  return sendHtml(res, pageTemplate({ ...pageArgs, title, content }), headers);
}

function handleGet(req, res, url, pathname, user, csrfToken, headers) {
  if (pathname === '/login') {
    if (user) return redirect(res, '/', headers);
    return sendHtml(res, loginPage(csrfToken, url.searchParams.get('error') === '1'), headers);
  }

  if (!user) return redirect(res, '/login', headers);

  if (DEMO_MODE && pathname === '/backup/download') return sendText(res, 404, 'Not Found');
  if (DEMO_MODE && pathname === '/system-update/status') return sendJson(res, 404, { error: 'Not Found' }, headers);

  if (pathname === '/backup/download') {
    if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
    const target = backupPath(url.searchParams.get('file'));
    if (!target || !fs.existsSync(target)) return sendText(res, 404, 'Backup not found');
    const fileName = path.basename(target);
    res.writeHead(200, {
      ...securityHeaders(),
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    return fs.createReadStream(target).pipe(res);
  }

  if (pathname === '/system-update/status') {
    if (!canManageSchoolSetup(user)) return sendJson(res, 403, { error: 'Forbidden' }, headers);
    return sendJson(res, 200, readUpdateStatus(), headers);
  }

  const context = selectedPageContext(req, url, pathname, csrfToken, user);
  if (!context) return sendText(res, 500, 'No school year configured');
  const { selected, pageArgs } = context;

  if (pathname === '/') {
    if (isParent(user)) return redirect(res, '/parent', headers);
    return sendAppPage(res, headers, pageArgs, 'Dashboard', dashboardPage(selected));
  }
  if (pathname === '/parent') {
    if (!isParent(user)) return redirect(res, '/', headers);
    return sendAppPage(res, headers, pageArgs, 'Parent Portal', parentPage(url, user, selected));
  }
  if (pathname === '/families') {
    if (!canAccessSetup(user)) return sendText(res, 403, 'Forbidden');
    return redirect(res, '/setup?section=families', headers);
  }
  if (pathname === '/setup') {
    if (!canAccessSetup(user)) return sendText(res, 403, 'Forbidden');
    return sendAppPage(res, headers, pageArgs, 'School Setup', setupPage(selected, csrfToken, url, user));
  }
  if (pathname === '/gradebook') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    const markingPeriodId = asInt(url.searchParams.get('markingPeriodId'));
    if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
    const gridParam = cleanText(url.searchParams.get('grid'), 12);
    if (gridParam === 'on' || gridParam === 'off') appendSetCookie(headers, `gradebookGrid=${gridParam}; Path=/; SameSite=Strict; Max-Age=31536000`);
    return sendAppPage(res, headers, pageArgs, 'Gradebook', gradebookPage(req, url, user, selected, csrfToken));
  }
  if (pathname === '/assignments') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    return sendAppPage(res, headers, pageArgs, 'Assignments', assignmentsPage(req, url, user, selected, csrfToken));
  }
  if (pathname === '/report-cards') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    return sendAppPage(res, headers, pageArgs, 'Report Cards', reportCardsPage(url, selected, user));
  }
  if (pathname === '/absences') {
    if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
    return sendAppPage(res, headers, pageArgs, 'Absences', absencesPage(url, selected, csrfToken, user));
  }
  if (pathname === '/reports') {
    if (isParent(user)) return sendText(res, 403, 'Forbidden');
    return sendAppPage(res, headers, pageArgs, 'Reports', reportsPage(url, selected, user));
  }
  if (pathname === '/users') {
    if (!canManageSchoolUsers(user)) return sendText(res, 403, 'Forbidden');
    return redirect(res, '/setup?section=users', headers);
  }

  return sendText(res, 404, 'Not Found');
}

const server = http.createServer(async (req, res) => {
  const headers = {};
  const csrfToken = getOrCreateCsrfToken(req, headers);

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const user = currentUser(req);

    if (req.method === 'GET' && pathname === '/assets/logo') return sendAssetFile(res, logoAsset(), 'Logo not found');

    if (req.method === 'GET' && pathname === '/assets/favicon') return sendAssetFile(res, faviconAsset(), 'Favicon not found');

    if (req.method === 'POST') {
      const body = await parseBody(req);
      return await handlePost(req, res, pathname, body, user, headers);
    }

    if (req.method !== 'GET') return sendText(res, 405, 'Method Not Allowed');

    return handleGet(req, res, url, pathname, user, csrfToken, headers);
  } catch (error) {
    if (error.message === 'Payload too large') return sendText(res, 413, 'Payload too large');
    if (error.statusCode) return sendText(res, error.statusCode, error.message || 'Bad Request');
    console.error(error);
    return sendText(res, 500, 'Internal Server Error');
  }
});

server.listen(ACTIVE_NETWORK.port, ACTIVE_NETWORK.host, () => {
  const primaryUrl = ACTIVE_NETWORK.host === '0.0.0.0'
    ? `http://127.0.0.1:${ACTIVE_NETWORK.port}`
    : `http://${ACTIVE_NETWORK.host}:${ACTIVE_NETWORK.port}`;
  console.log(`Oakstead running on ${primaryUrl}`);
  if (ACTIVE_NETWORK.host === '0.0.0.0') {
    const lanUrls = networkUrls(ACTIVE_NETWORK).join(', ');
    if (lanUrls) console.log(`LAN access: ${lanUrls}`);
  }
});
