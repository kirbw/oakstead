const { sqlParameter } = require('./server/input');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
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
  compactPercent,
  esc,
  formatFileSize,
  normalizeCategory,
  parseScoreInput,
  scoreValueForMode,
} = require('./server/input');
const { createDb } = require('./server/db');
const { createOperationalMonitor, databaseReady, renderOperationalPage } = require('./server/operations');
const operations = createOperationalMonitor();
const ui = require('./server/ui');
const { createLifecycle, stopHttpServer, installShutdownSignals, restartAfterDrain } = require('./server/lifecycle');
let application;
const { addDays, daysBetween, schoolDateRange, recentSchoolDays } = require('./server/dates');
const { backupDue, createBackupScheduler } = require('./server/backups');
const { SESSION_VALID_SQL } = require('./server/sessions');
const { numericValue, numericValues, average } = require('./server/averages');
const { collectDataIntegrityIssues } = require('./server/integrity');
const { createSetupRenderer } = require('./server/setup');
const { gradeRank, assignmentPeriodClause, summarizeGradeRows, loadGradeWeights, loadGradeAverages } = require('./server/grades');
const { acceptsGzip, createHttpHelpers, safeInternalPath } = require('./server/http');
const {
  gradebookRedirectUrl,
  gridScoreEntries,
  parseScoreChanges,
  scoreWriteStatements,
  scoreFieldEntries
} = require('./server/gradebook-utils');
const { APP_STYLESHEET_VERSION, APP_CLIENT_SCRIPT_VERSION, STATIC_ASSETS } = require('./server/assets');
let activeRequests = 0;
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
} = createHttpHelpers({ escapeHtml: esc, maxBodySize: MAX_BODY_SIZE,
  // Optional compression must not add a worker wait while other requests wait.
  canCompress: () => activeRequests <= 1 });
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

const db = createDb({ dbFile: DB_FILE, onQuery: operations.recordQuery });
const { runSql, querySql, executeSql, insertReturningId } = db;
const backupStorage = require('./server/backup-storage').createBackupStorage({
  backupDir: BACKUP_DIR, dbFile: DB_FILE, checkpoint: db.checkpoint,
  withDatabaseClosed: db.withDatabaseClosed, validate: db.prepareBackupDatabase
});

function runSqlBatch(statements) {
  if (statements.length) db.transaction(() => {
    for (const statement of statements.filter(Boolean)) executeSql(statement.sql, statement.parameters);
  });
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
  try {
    const result = performDatabaseBackup(reason);
    operations.recordBackup(true);
    return result;
  } catch (error) {
    operations.recordBackup(false);
    throw error;
  }
}

function performDatabaseBackup(reason) {
  const result = backupStorage.publish(reason);
  db.transaction(() => {
    setSetting('backup_last_file', result.fileName);
    setSetting('backup_last_at', new Date().toISOString());
  });
  if (reason === 'scheduled') {
    const cleanup = backupStorage.cleanup(getSetting('backup_retention_count', '0'));
    try { setSetting('backup_cleanup_result', JSON.stringify({ ...cleanup, at: new Date().toISOString() })); }
    catch { console.error('Backup succeeded, but cleanup status could not be saved.'); }
    if (cleanup.error || cleanup.failed.length) console.error('Backup succeeded; some scheduled backups could not be cleaned up.');
    result.cleanup = cleanup;
  }
  return result;
}

function listDatabaseBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .map((fileName) => {
      const target = backupPath(fileName);
      if (!target || !fs.existsSync(target)) return null;
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      return { fileName, size: stat.size, createdAt: stat.mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
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
    env: { ...process.env, DB_FILE }
  });
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.status !== 0) console.error(`Demo data refresh failed during ${reason}.`);
  invalidateAppCaches();
  if (result.status === 0) reportDataIntegrity();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const verifyPassword = require('./server/passwords').createPasswordVerifier();

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
  db.transaction(() => {
    db.applySchemaMigrations();

    executeSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('school_name', ?);`, [sqlParameter(DEFAULT_SCHOOL_NAME)]);
    executeSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('network_bind_host', ?);`, [sqlParameter(DEFAULT_HOST)]);
    executeSql(`INSERT OR IGNORE INTO os_settings (key, value) VALUES ('network_port', ?);`, [sqlParameter(DEFAULT_PORT)]);
    createDefaultRoleGroups();
    migrateLessonHomeworkWeights();

    const yearCount = querySql('SELECT COUNT(*) AS count FROM os_school_years')[0]?.count || 0;
    if (!yearCount) {
      runSql(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
        VALUES ('2025-2026', '2025-08-15', '2026-05-31', 1);`);
    }

    const userCount = querySql('SELECT COUNT(*) AS count FROM os_users')[0]?.count || 0;
    if (!userCount) {
      executeSql(`INSERT INTO os_users (name, username, role, password_hash)
        VALUES ('System Administrator', 'admin', ?, ?);`, [ROLE_ADMIN, sqlParameter(hashPassword('ChangeMeNow!'))]);
    }

    querySql('SELECT id, name, start_date, end_date FROM os_school_years;').forEach((year) => {
      const periodCount = querySql(`SELECT COUNT(*) AS count FROM os_marking_periods WHERE school_year_id=?;`, [asInt(year.id)])[0]?.count || 0;
      if (!periodCount) createMarkingPeriods(asInt(year.id), 6, year.start_date, year.end_date);
      const weightCount = querySql(`SELECT COUNT(*) AS count FROM os_grade_weight_groups WHERE school_year_id=?;`, [asInt(year.id)])[0]?.count || 0;
      if (!weightCount) createDefaultWeightGroups(asInt(year.id));
      const letterCount = querySql(`SELECT COUNT(*) AS count FROM os_letter_grade_groups WHERE school_year_id=?;`, [asInt(year.id)])[0]?.count || 0;
      if (!letterCount) createDefaultLetterGradeGroup(asInt(year.id));
    });

    runSql(`DELETE FROM os_sessions WHERE NOT (${SESSION_VALID_SQL});`);
  });
  reportDataIntegrity();
}

function createMarkingPeriods(yearId, count, startDate = '', endDate = '') {
  runSqlBatch(markingPeriodStatements(yearId, count, startDate, endDate));
}

function markingPeriodStatements(yearId, count, startDate = '', endDate = '') {
  const periods = Math.max(1, Math.min(12, asInt(count) || 6));
  const span = daysBetween(startDate, endDate);
  return Array.from({ length: periods }, (_, index) => {
    const periodStart = span ? addDays(startDate, Math.floor((span * index) / periods)) : '';
    const periodEnd = span ? addDays(startDate, Math.floor((span * (index + 1)) / periods) - 1) : '';
    return { sql: `INSERT INTO os_marking_periods (school_year_id, period_number, name, start_date, end_date)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(school_year_id, period_number) DO UPDATE SET start_date=excluded.start_date, end_date=excluded.end_date;`,
      parameters: [yearId, index + 1, `Period ${index + 1}`, sqlParameter(periodStart), sqlParameter(periodEnd)] };
  });
}

function reportDataIntegrity() {
  const issues = collectDataIntegrityIssues(querySql);
  for (const issue of issues) console.warn(`Historical relationship needs review: ${issue.table}, row ${issue.rowId}, ${issue.relationship}. Record retained.`);
}

function dataIntegrityPage() {
  const issues = collectDataIntegrityIssues(querySql);
  return `<div class="workspace"><section class="panel">
    <h2>Data Integrity</h2><p>${issues.length} broken relationships found. Existing records have been preserved. Review these links before making repairs; no records are changed by this report.</p>
    ${issues.length ? `<div class="table-wrap"><table><tr><th>Table</th><th>Row ID</th><th>Related table</th><th>Relationship</th></tr>
      ${issues.map((issue) => `<tr><td>${esc(issue.table)}</td><td>${esc(issue.rowId)}</td><td>${esc(issue.relatedTable)}</td><td>${esc(issue.relationship)}</td></tr>`).join('')}</table></div>` : emptyState('No broken relationships were found.')}
    <a href="/setup?section=settings">Back to System Settings</a>
  </section></div>`;
}

function createWeightGroup(yearId, name, minGrade, maxGrade, weights) {
  const groupId = insertReturningId(`INSERT INTO os_grade_weight_groups (school_year_id, name, min_grade, max_grade)
    VALUES (?, ?, ?, ?)`, [yearId, sqlParameter(name), sqlParameter(minGrade), sqlParameter(maxGrade)]);
  Object.entries(weights).forEach(([category, weight]) => {
    executeSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
      VALUES (?, ?, ?);`, [groupId, sqlParameter(category), Number(weight) || 0]);
  });
}

function createDefaultWeightGroups(yearId) {
  createWeightGroup(yearId, 'Grades 1-2', '1', '2', { 'Lesson / Homework': 50, Quiz: 25, Test: 25 });
  createWeightGroup(yearId, 'Grades 3-9', '3', '9', { 'Lesson / Homework': 25, Quiz: 25, Test: 50 });
}

function createDefaultLetterGradeGroup(yearId) {
  const groupId = insertReturningId(`INSERT INTO os_letter_grade_groups (school_year_id, name, min_grade, max_grade, subject_id)
    VALUES (?, 'Default Letter Grades', '1', '12', NULL)`, [yearId]);
  DEFAULT_LETTER_GRADES.forEach(([letter, threshold], index) => {
    executeSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
      VALUES (?, ?, ?, ?);`, [groupId, sqlParameter(letter), Number(threshold), index]);
  });
}

function createDefaultRoleGroups() {
  const defaults = {
    'Board Members': ['Chairman', 'Secretary', 'Treasurer'],
    'Faculty Team': ['Teacher', 'Principal', 'Librarian', 'Nurse']
  };
  Object.entries(defaults).forEach(([groupName, roles]) => {
    const groupId = insertReturningId(`INSERT INTO os_role_groups (name) VALUES (?)
      ON CONFLICT(name) DO UPDATE SET name=excluded.name`, [sqlParameter(groupName)]);
    roles.forEach((roleName) => {
      executeSql(`INSERT OR IGNORE INTO os_role_types (group_id, name) VALUES (?, ?);`, [groupId, sqlParameter(roleName)]);
    });
  });
}

function migrateLessonHomeworkWeights() {
  querySql('SELECT DISTINCT wi.group_id FROM os_grade_weight_items wi JOIN os_grade_weight_groups wg ON wg.id=wi.group_id;').forEach((row) => {
    const groupId = asInt(row.group_id);
    const legacyItems = querySql(`SELECT category, weight FROM os_grade_weight_items
      WHERE group_id=? AND category IN ('Lesson', 'Homework', 'Lesson / Homework');`, [groupId]);
    if (!legacyItems.length) return;
    const combinedWeight = Math.min(100, legacyItems.reduce((sum, item) => sum + Number(item.weight || 0), 0));
    executeSql(`DELETE FROM os_grade_weight_items WHERE group_id=? AND category IN ('Lesson', 'Homework', 'Lesson / Homework');`, [groupId]);
    executeSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
      VALUES (?, 'Lesson / Homework', ?);`, [groupId, combinedWeight]);
  });
}

function createSession(userId, headers) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  executeSql(`INSERT INTO os_sessions (session_token, user_id, expires_at)
    VALUES (?, ?, ?);`, [sqlParameter(token), asInt(userId), sqlParameter(expiresAt)]);
  appendSetCookie(headers, `sessionToken=${cookieValue(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`);
}

function clearSession(req, headers) {
  const token = parseCookies(req).sessionToken;
  if (token) executeSql(`DELETE FROM os_sessions WHERE session_token=?;`, [sqlParameter(token)]);
  appendSetCookie(headers, 'sessionToken=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function currentUser(req) {
  if (DEMO_MODE) return { id: 0, name: 'Demo Admin', username: 'demo', role: ROLE_ADMIN, teacher_id: null, parent_family_id: null };
  const token = parseCookies(req).sessionToken;
  if (!token) return null;
  const rows = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, u.parent_family_id
    FROM os_sessions s
    JOIN os_users u ON u.id = s.user_id
    WHERE s.session_token=? AND (${SESSION_VALID_SQL})
    LIMIT 1;`, [token]);
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

function teacherStudentClause(...args) { return academicAccess.teacherStudentClause(...args); }

function studentAccessClause(...args) { return academicAccess.studentAccessClause(...args); }

function canViewStudent(...args) { return academicAccess.canViewStudent(...args); }

function canModifyStudentAcademicRecord(...args) { return academicAccess.canModifyStudentAcademicRecord(...args); }

function modifiableStudentIdSet(...args) { return academicAccess.modifiableStudentIdSet(...args); }

function setAllowsStudent(...args) { return academicAccess.setAllowsStudent(...args); }

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

// Every data mutation flows through handlePost (which invalidates), the demo
// reseeder, or a backup restore — so these read-mostly lookups are safe to
// memoize for the GET hot path.
let cachedSchoolYears = null;
let cachedAppSettings = null;

function invalidateAppCaches() {
  cachedSchoolYears = null;
  cachedAppSettings = null;
}

function getSchoolYears() {
  if (!cachedSchoolYears) cachedSchoolYears = querySql('SELECT * FROM os_school_years ORDER BY start_date DESC, id DESC;');
  return cachedSchoolYears;
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
  const row = querySql(`SELECT value FROM os_settings WHERE key=? LIMIT 1;`, [sqlParameter(key)])[0];
  return row?.value || fallback;
}

function setSetting(key, value) {
  executeSql(`INSERT INTO os_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP;`, [sqlParameter(key), sqlParameter(value)]);
  invalidateAppCaches();
}

function appSettings() {
  if (cachedAppSettings) return cachedAppSettings;
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
  cachedAppSettings = {
    schoolName,
    logoPath,
    faviconPath,
    logoUrl: `/assets/logo?v=${logoVersion}`,
    faviconUrl: `/assets/favicon?v=${faviconVersion}`,
    hasCustomLogo: Boolean(logoPath),
    hasCustomFavicon: Boolean(faviconPath)
  };
  return cachedAppSettings;
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
  const lastAt = getSetting('backup_last_at', '');
  return backupDue(frequency, lastAt, now);
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

const releaseCommands = require('./server/release-commands').createReleaseCommands({ cwd: APP_ROOT });
let releaseOperation = false;
function releaseBusy() { return Object.assign(new Error('A release check or update is already in progress.'), { statusCode: 409 }); }

function runUpdateCommand(label, command, args, options = {}) {
  writeUpdateStatus({ message: label, log: [updateLog(label)] });
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
    timeout: 120000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
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

async function checkLatestGitRelease(channel) {
  const deadline = Date.now() + 20000;
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
  await releaseCommands.run('git', ['fetch', '--tags', '--prune', 'origin'], { deadline });
  const tags = (await releaseCommands.run('git', ['tag', '--list', '--sort=-v:refname'], { deadline })).split('\n').map(tag => tag.trim());
  const stable = tags.find(tag => /^v?\d+\.\d+\.\d+$/.test(tag));
  const prerelease = tags.find(tag => /^v?\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(tag));
  const tag = (updateChannel === 'prerelease' ? prerelease || stable : stable) || '';
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
  if (releaseOperation || readUpdateStatus().running) throw releaseBusy();
  releaseOperation = true;
  try { return await (UPDATE_MODE === 'installer' ? checkLatestInstallerRelease(channel) : checkLatestGitRelease(channel)); }
  finally { releaseOperation = false; }
}

async function restartApplication() {
  writeUpdateStatus({ phase: 'restarting', percent: 98, message: 'Restarting Oakstead.', log: [updateLog('Restarting application')] });
  if (typeof process.send === 'function') {
    // The update worker asks its own parent to drain the running application.
    await new Promise((resolve, reject) => process.send({ type: 'oakstead-restart' }, error => error ? reject(error) : resolve()));
    db.close();
    process.disconnect();
    return;
  }
  if (!application) {
    db.close();
    writeUpdateStatus({ phase: 'complete', percent: 100, message: 'Update complete. Restart Oakstead to use the updated code.' });
    return;
  }
  const supervised = Boolean(process.env.INVOCATION_ID || process.env.pm_id || process.env.NODE_APP_INSTANCE);
  await restartAfterDrain({ stop: application.stop, supervised, exit: code => process.exit(code), spawnReplacement() {
    const child = spawn(process.execPath, [__filename], {
      cwd: APP_ROOT,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: process.env
    });
    child.unref();
  } });
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
  if (releaseOperation || readUpdateStatus().running) throw releaseBusy();
  releaseOperation = true;
  try { return await performSystemUpdate(channel); }
  finally { releaseOperation = false; }
}

async function performSystemUpdate(channel) {
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
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: process.env
  });
  child.on('message', (message) => {
    if (message?.type === 'oakstead-restart') void restartApplication().catch(() => console.error('Application restart failed.'));
  });
  child.unref();
  child.channel?.unref();
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
    void restartApplication().catch(() => console.error('Update restart handoff failed. Restart Oakstead manually.'));
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
  const score = numericValue(value);
  if (score === null) return '';
  const rows = [...scale]
    .map((row) => ({ letter: cleanText(row.letter, 12), threshold: Number(row.threshold) }))
    .filter((row) => row.letter && Number.isFinite(row.threshold))
    .sort((a, b) => b.threshold - a.threshold);
  return rows.find((row) => score >= row.threshold)?.letter || rows.at(-1)?.letter || '';
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
  const groups = querySql(`SELECT * FROM os_letter_grade_groups WHERE school_year_id=?;`, [yearId]);
  const group = matchingLetterGradeGroup(groups, grade, subjectId);
  if (!group) return DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
  const items = querySql(`SELECT letter, threshold FROM os_letter_grade_items WHERE group_id=? ORDER BY threshold DESC, sort_order, letter;`, [asInt(group.id)]);
  return items.length ? items : DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
}

function assignmentAccessClause(...args) { return academicAccess.assignmentAccessClause(...args); }

function authorizedAssignments(...args) { return academicAccess.authorizedAssignments(...args); }

function requireScoreStudents(...args) { return academicAccess.requireScoreStudents(...args); }

function teacherAllowedForSelection(...args) { return academicAccess.teacherAllowedForSelection(...args); }

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
  return `<a class="nav-link ${active ? 'active' : ''}" href="${pathname}"${active ? ' aria-current="page"' : ''}>${NAV_ICONS[iconKey] || ''}<span>${esc(label)}</span></a>`;
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
  return ui.emptyState(text);
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
<html lang="en" data-demo-mode="${esc(String(DEMO_MODE))}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} &middot; ${esc(settings.schoolName)}</title>
<link rel="icon" href="${settings.faviconUrl}" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css?v=${APP_STYLESHEET_VERSION}" />
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
<script src="/assets/app.js?v=${APP_CLIENT_SCRIPT_VERSION}"></script>
</body>
</html>`;
}

function loginPage(...args) { return authenticationViews.loginPage(...args); }

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

function weeklyAverageChart(weekData, schoolDays = recentSchoolDays(7)) {
  const days = schoolDays.map((day) => {
    const row = weekData.find(r => r.day === day.key);
    return { ...day, avg: row ? Number(row.avg_score) : null };
  });

  const W = 400, H = 130;
  const padL = 32, padR = 10, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const toX = (i) => (padL + (i / Math.max(days.length - 1, 1)) * chartW).toFixed(1);
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
    ? `<text x="${(W / 2).toFixed(0)}" y="${(padT + chartH / 2 + 4).toFixed(0)}" class="empty-msg">No scores recorded for these school days</text>`
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

function dashboardPage(...args) { return administrationViews.dashboardPage(...args); }

function familiesPage(...args) { return peopleViews.familiesPage(...args); }

function selectedAttr(value, selected) {
  return String(value || '') === String(selected || '') ? 'selected' : '';
}

const setupPage = createSetupRenderer({
  backupRetentionPreview: count => backupStorage.preview(count, true),
  querySql,
  appSettings,
  getSetting,
  backupFrequency,
  backupFrequencyLabel,
  networkAccessLabel,
  desiredNetworkConfig,
  networkStatus,
  listDatabaseBackups,
  readUpdateStatus,
  schoolYearHead,
  selectedAttr,
  csrfInput,
  familyReportName,
  firstNameOnly,
  studentDisplayName,
  genderIcon,
  genderOptions,
  gradeOptions,
  gradeChoices,
  roleAssignmentRows,
  roleAssignmentForm,
  roleOptionsForUser,
  roleLabel,
  canManageAdminUsers,
  isAdmin,
  sortGrades,
  displayCategory,
  emptyState,
  DEFAULT_LETTER_GRADES,
  CATEGORIES,
  ROLE_ADMIN,
  ROLE_PRINCIPAL,
  ROLE_TEACHER
});

function gradebookGridView(...args) { return academicsViews.gradebookGridView(...args); }

function gradebookPage(...args) { return academicsViews.gradebookPage(...args); }

function assignmentsPage(...args) { return academicsViews.assignmentsPage(...args); }

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

function reportOverview(...args) { return academicsViews.reportOverview(...args); }

function familiesReport(...args) { return academicsViews.familiesReport(...args); }

function studentsReport(...args) { return academicsViews.studentsReport(...args); }

function schoolBoardReport(...args) { return academicsViews.schoolBoardReport(...args); }

function birthdaysReport(...args) { return academicsViews.birthdaysReport(...args); }

function graphColor(index) {
  return REPORT_METER_COLORS[index % REPORT_METER_COLORS.length];
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
  const values = item.values.map(numericValue);
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

function gradeGraphReport(...args) { return academicsViews.gradeGraphReport(...args); }

function studentGradeGraphPanel(...args) { return academicsViews.studentGradeGraphPanel(...args); }

function parentPage(...args) { return academicsViews.parentPage(...args); }

function reportsPage(...args) { return academicsViews.reportsPage(...args); }

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
  return loadGradeAverages(querySql, { yearId, grade, subjectIds: [subjectId], studentIds, periods: [period] }).get(subjectId, period);
}

function reportCardsPage(...args) { return academicsViews.reportCardsPage(...args); }

function absencesPage(...args) { return academicsViews.absencesPage(...args); }

function usersPage(...args) { return administrationViews.usersPage(...args); }

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

const repository = require('./server/domains/repository').createRepository(db);
const academicAccess = require('./server/domains/academic-access').createAcademicAccess({ repository, asInt, isAdmin, isParent, isPrincipal, isTeacher });
const authenticationService = require('./server/domains/authentication').createService({
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
  verifyPassword,
});
const administrationOperations = require('./server/domains/administration-operations').createService({
  BACKUP_DIR,
  DEFAULT_PORT,
  DEFAULT_SCHOOL_NAME,
  backupFrequency,
  backupPath,
  canManageSchoolSetup,
  checkLatestRelease,
  cleanText,
  createDatabaseBackup,
  db,
  fs,
  invalidateAppCaches,
  networkAccessHostForMode,
  parsePort,
  path,
  reportDataIntegrity,
  saveUploadedImage,
  setSetting,
  startSystemUpdate,
  timestampForFile,
  updateLog,
  writeUpdateStatus,
});
const peopleService = require('./server/domains/people').createPeopleService({
  repository,
  asInt,
  canManageSchoolSetup,
  cleanDate,
  cleanGender,
  cleanGrade,
  cleanPersonRoleType,
  cleanText,
  firstNameOnly,
});
const academicsService = require('./server/domains/academics').createAcademicsService({
  repository,
  history: require('./server/history').createAcademicHistory(repository, { demoMode: DEMO_MODE }),
  CATEGORIES,
  DEFAULT_LETTER_GRADES,
  ROLE_TEACHER,
  appendSetCookie,
  asInt,
  asPoints,
  authorizedAssignments,
  canManageAcademicRecords,
  canManageSchoolSetup,
  canModifyStudentAcademicRecord,
  cleanDate,
  cleanGrade,
  cleanScoreMode,
  cleanText,
  cookieValue,
  createDefaultWeightGroups,
  createMarkingPeriods,
  formArray,
  gradebookDisplayScore,
  gradebookLetter,
  gradebookRedirectUrl,
  gridScoreEntries,
  letterGradeScale,
  markingPeriodStatements,
  normalizeCategory,
  parseGrades,
  parseScoreChanges,
  parseScoreInput,
  periodAverageRows,
  promoteGrade,
  reportDataIntegrity,
  requireScoreStudents,
  runSqlBatch,
  scoreFieldEntries,
  scoreWriteStatements,
  studentAccessClause,
  teacherAllowedForSelection,
});
const administrationService = require('./server/domains/administration').createAdministrationService({
  repository,
  ROLES,
  ROLE_ADMIN,
  ROLE_PARENT,
  ROLE_PRINCIPAL,
  ROLE_TEACHER,
  asInt,
  canManageAdminUsers,
  canManageSchoolUsers,
  cleanText,
  hashPassword: require('./server/passwords').createPasswordHasher(),
  currentUser,
});
const peopleViews = require('./server/domains/people-views').createViews({
  asInt,
  csrfInput,
  emptyState,
  esc,
  firstNameOnly,
  gradeOptions,
  querySql,
  roleAssignmentForm,
  schoolYearHead,
  selectedAttr,
});
const academicsViews = require('./server/domains/academics-views').createViews({
  DEFAULT_LETTER_GRADES,
  ROLE_TEACHER,
  absenceKindClass,
  appSettings,
  asInt,
  asPoints,
  assignmentAccessClause,
  assignmentPeriodClause,
  authorizedAssignments,
  average,
  boardTermLabel,
  canAccessSetup,
  categoryOptions,
  cleanGrade,
  cleanScoreMode,
  cleanText,
  compactNumber,
  csrfInput,
  displayCategoryShort,
  emptyState,
  esc,
  familyReportName,
  formatAbsence,
  formatAbsenceAmount,
  formatAbsenceKind,
  formatDateNumeric,
  formatPercent,
  gradeOptionsFromRows,
  gradeRank,
  gradeTone,
  gradebookCategoryClass,
  gradebookDisplayScore,
  gradebookLetter,
  gradebookTitle,
  graphColor,
  gridModeToggle,
  letterGradeScale,
  loadGradeAverages,
  loadGradeWeights,
  miniSubjectChartSvg,
  monthName,
  normalizeCategory,
  numericValues,
  parseCookies,
  path,
  periodAbsenceTotal,
  periodAverageRows,
  printReportHead,
  querySql,
  reportCardBooksSvg,
  reportDefinitions,
  reportMeterStyle,
  reportsNav,
  schoolYearHead,
  scoreInputControl,
  scoreModeToggle,
  scoreValueForMode,
  selectedPeriodFromRequest,
  sortGrades,
  studentAccessClause,
  studentDisplayName,
  studentLastFirst,
  summarizeGradeRows,
  teacherAllowedForSelection,
  teacherStudentClause,
});
const administrationViews = require('./server/domains/administration-views').createViews({
  KPI_ICONS,
  ROLE_ADMIN,
  ROLE_TEACHER,
  actionPanel,
  asInt,
  assignmentAccessClause,
  csrfInput,
  displayCategoryShort,
  emptyState,
  esc,
  formatPercent,
  gradeTone,
  isTeacher,
  querySql,
  recentSchoolDays,
  roleLabel,
  schoolYearHead,
  studentAccessClause,
  weeklyAverageChart,
});
const authenticationViews = require('./server/domains/authentication-views').createViews({ APP_STYLESHEET_VERSION, appSettings, csrfInput, esc, https });
const domainRoutes = require('./server/domains/routes').createDomainRoutes({
  services: [peopleService,
  academicsService,
  administrationService,
  authenticationService,
  administrationOperations],
  sendText,
  sendJson,
  redirect,
});

async function handlePost(req, res, p, body, user, headers) {
  // Every mutation flows through POST; dropping the memoized lookups here
  // keeps them trivially coherent without tracking individual write sites.
  invalidateAppCaches();
  if (p === '/login') return domainRoutes.handle(req, res, p, body, user, headers);

  if (!user) return redirect(res, '/login', headers);

  if (DEMO_MODE && DEMO_HIDDEN_POST_PATHS.has(p)) {
    return p.startsWith('/system-update')
      ? sendJson(res, 404, { error: 'Not Found' }, headers)
      : sendText(res, 404, 'Not Found');
  }

  if (!requireCsrf(req, body)) return sendText(res, 403, 'Invalid CSRF token');

  if (domainRoutes.paths.has(p)) return domainRoutes.handle(req, res, p, body, user, headers);

  return sendText(res, 404, 'Not Found');
}

function readyForRequests() {
  return databaseReady({ state: application?.state(), isOpen: db.isOpen, query: querySql });
}

function operationalPage() {
  return renderOperationalPage(operations.snapshot(), { escapeHtml: esc, version: APP_VERSION,
    ready: readyForRequests(), backupAt: getSetting('backup_last_at', ''), scheduler: backupScheduler?.status() });
}

operations.configureRoutes([...domainRoutes.paths, '/history', '/', '/parent', '/setup', '/reports', '/report-cards', '/families', '/users', '/system/diagnostics', '/system/operations', '/system-update/status', '/backup/download', '/assets/app.css', '/assets/app.js', '/assets/logo', '/assets/favicon', '/health']);

const handleGet = require('./server/routes').createPageRoutes({
  historyPage: url => require('./server/history-page').historyPage(querySql, url),
  DEMO_MODE,
  absencesPage,
  appendSetCookie,
  asInt,
  assignmentsPage,
  backupPath,
  canAccessSetup,
  canManageAcademicRecords,
  canManageSchoolSetup,
  canManageSchoolUsers,
  cleanText,
  cookieValue,
  dashboardPage,
  dataIntegrityPage,
  fs,
  gradebookPage,
  isAdmin,
  isParent,
  loginPage,
  operationalPage,
  parentPage,
  path,
  readUpdateStatus,
  redirect,
  reportCardsPage,
  reportsPage,
  securityHeaders,
  selectedPageContext,
  sendAppPage,
  sendHtml,
  sendJson,
  sendText,
  setupPage,
});

function sendAssetFile(res, filePath, missingMessage) {
  if (!fs.existsSync(filePath)) return sendText(res, 404, missingMessage);
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': contentTypeFor(filePath),
    // Logo/favicon URLs carry a ?v=<updated_at> version from appSettings, so a
    // new upload changes the URL and long-lived caching is safe.
    'Cache-Control': 'public, max-age=31536000, immutable'
  });
  return res.end(fs.readFileSync(filePath));
}

function sendStaticAsset(req, res, asset) {
  const headers = {
    ...securityHeaders(),
    'Content-Type': asset.contentType,
    // URLs carry a content-hash version query param, so long-lived caching is safe.
    'Cache-Control': 'public, max-age=31536000, immutable'
  };
  if (acceptsGzip(req)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.end(asset.gzipped);
  }
  res.writeHead(200, headers);
  return res.end(asset.body);
}

function selectedPageContext(req, url, pathname, csrfToken, user) {
  const { years, selected } = getSelectedYear(req, url);
  if (!selected) return null;
  return {
    selected,
    pageArgs: { csrfToken, user, years, selectedYear: selected, currentPath: pathname }
  };
}

function sendAppPage(req, res, headers, pageArgs, title, content) {
  return sendHtml(req, res, pageTemplate({ ...pageArgs, title, content }), headers);
}

const server = http.createServer(async (req, res) => {
  activeRequests++;
  const started = performance.now();
  let pathname = '/other';
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    activeRequests--;
    operations.recordRequest({ requestId: res.getHeader('X-Request-ID'), method: req.method, pathname,
      status: res.writableFinished ? res.statusCode : 499, durationMs: performance.now() - started });
  };
  res.once('finish', record);
  res.once('close', record);
  const headers = {};
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('Cache-Control', 'no-store');

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/health') {
      const ready = readyForRequests();
      res.writeHead(ready ? 200 : 503, { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: ready ? 'ready' : 'unavailable' }));
    }
    if (application?.state() === 'stopping') return sendText(res, 503, 'Oakstead is shutting down. Please try again shortly.');
    const csrfToken = getOrCreateCsrfToken(req, headers);
    req.allowLoginRedirect = req.method === 'POST' && pathname === '/logout';
    const user = currentUser(req);

    const bundledAsset = req.method === 'GET' ? STATIC_ASSETS.get(pathname) : undefined;
    if (bundledAsset) return sendStaticAsset(req, res, bundledAsset);

    if (req.method === 'GET' && pathname === '/assets/logo') return sendAssetFile(res, logoAsset(), 'Logo not found');

    if (req.method === 'GET' && pathname === '/assets/favicon') return sendAssetFile(res, faviconAsset(), 'Favicon not found');

    if (req.method === 'POST') {
      const body = await parseBody(req);
      return await handlePost(req, res, pathname, body, user, headers);
    }

    if (req.method !== 'GET') return sendText(res, 405, 'Method Not Allowed');

    return await handleGet(req, res, url, pathname, user, csrfToken, headers);
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    if (error.errcode === 787 || error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint failed/i.test(error.message)) {
      return sendText(res, 409, 'This change conflicts with a linked record. Check the selected records; remove or update dependent records before deleting their parent.');
    }
    if (error.message === 'Payload too large') return sendText(res, 413, 'Payload too large');
    if (/UNIQUE constraint failed/i.test(error.message)) return sendText(res, 409, 'A record with these details already exists. Review the submitted values.');
    if (error.statusCode) {
      if (/application\/json/i.test(req.headers.accept || '')) return sendJson(res, error.statusCode, { error: error.message || 'Bad Request', fields: error.fields || {} }, headers);
      return sendText(res, error.statusCode, error.message || 'Bad Request', headers);
    }
    console.error(JSON.stringify({ event: 'request.failed', requestId: res.getHeader('X-Request-ID') }));
    return sendText(res, 500, 'Internal Server Error');
  }
});

let backupScheduler;
let demoTimer;
function stopBackgroundJobs() {
  backupScheduler?.stop();
  clearInterval(demoTimer);
  return releaseCommands.stop();
}

function createApplication() {
  if (application) return application;
  application = createLifecycle([
    { name: 'database', start() {
      if (process.env.PORT && !parsePort(process.env.PORT, 0)) throw new Error('PORT must be an integer between 1 and 65535.');
      if (process.env.HOST && !cleanBindHost(process.env.HOST, '')) throw new Error('HOST must be a supported bind address.');
      ensureRuntimeDirs();
      ensureDb();
      ACTIVE_NETWORK = desiredNetworkConfig();
    }, stop() {
      try { if (db.isOpen()) db.checkpoint(); }
      finally { db.close(); invalidateAppCaches(); }
    } },
    { name: 'background jobs', start() {
      if (DEMO_MODE) {
        const loopbackHosts = new Set(['127.0.0.1', 'localhost']);
        if (!loopbackHosts.has(ACTIVE_NETWORK.host)) {
          console.warn('****************************************************************');
          console.warn('WARNING: DEMO_MODE is ON and the server is bound to a non-loopback');
          console.warn(`address (${ACTIVE_NETWORK.host}). Authentication is DISABLED — every`);
          console.warn('visitor on the network is treated as an admin with full read/write');
          console.warn('access to student PII. Set DEMO_MODE=0 for any real deployment.');
          console.warn('****************************************************************');
        }
        refreshDemoData('startup');
        demoTimer = setInterval(() => refreshDemoData('scheduled'), DEMO_REFRESH_HOURS * 60 * 60 * 1000).unref();
      }

      backupScheduler = createBackupScheduler({
        isDue: () => fs.existsSync(DB_FILE) && scheduledBackupDue(),
        createBackup: () => createDatabaseBackup('scheduled'),
        onError: () => console.error('Scheduled backup failed; it will retry on the next check.')
      });
      void backupScheduler.check();
    }, stop: stopBackgroundJobs },
    { name: 'http', start() {
      return new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListen); reject(error); };
        const onListen = () => {
          server.off('error', onError);

          const primaryUrl = ACTIVE_NETWORK.host === '0.0.0.0'
            ? `http://127.0.0.1:${ACTIVE_NETWORK.port}`
            : `http://${ACTIVE_NETWORK.host}:${ACTIVE_NETWORK.port}`;
          console.log(`Oakstead running on ${primaryUrl}`);
          if (ACTIVE_NETWORK.host === '0.0.0.0') {
            const lanUrls = networkUrls(ACTIVE_NETWORK).join(', ');
            if (lanUrls) console.log(`LAN access: ${lanUrls}`);
          }

          resolve();
        };
        server.once('error', onError);
        server.listen(ACTIVE_NETWORK.port, ACTIVE_NETWORK.host, onListen);
      });
    }, stop() { return stopHttpServer(server, { beforeDrain: stopBackgroundJobs,
      onForced: () => console.warn('Forced HTTP shutdown after 5000ms grace period.') }); } }
  ], { onError: (component) => console.error('Application cleanup failed:', component) });
  return application;
}

async function main() {
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
    db.close();
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
    db.close();
    return;
  }

  const app = createApplication();
  installShutdownSignals(app);
  await app.start();
}

module.exports = { createApplication };
if (require.main === module) void main().catch(error => {
  console.error('Oakstead startup failed:', error.message);
  process.exitCode = 1;
});
