const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');
const { execFileSync } = require('child_process');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = path.join(__dirname, 'school.db');
const MAX_BODY_SIZE = 1_000_000;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function sqlValue(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function asScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function runSql(sql) {
  return execFileSync('sqlite3', [DB_FILE, sql], { encoding: 'utf8' });
}

function querySql(sql) {
  const out = execFileSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

function ensureDb() {
  runSql(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL,
  mom_name TEXT,
  dad_name TEXT,
  phone TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT,
  current_grade TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (family_id) REFERENCES families(id)
);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  grades_offered TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  teacher_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  grades TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  FOREIGN KEY (term_id) REFERENCES terms(id)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS curriculum_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
CREATE TABLE IF NOT EXISTS grade_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  weight REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  term_id INTEGER NOT NULL,
  grade TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (term_id) REFERENCES terms(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  score REAL NOT NULL,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);
`);

  const hasWeights = querySql('SELECT COUNT(*) as count FROM grade_weights')[0]?.count;
  if (!hasWeights) {
    runSql(`INSERT INTO grade_weights (category, weight) VALUES
      ('Homework', 20), ('Lesson', 20), ('Quiz', 25), ('Test', 35);`);
  }
}

function promoteGrade(grade) {
  const n = Number(grade);
  return Number.isNaN(n) ? grade : String(n + 1);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (k) acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getOrCreateCsrfToken(req, resHeaders) {
  const cookies = parseCookies(req);
  let token = cookies.csrfToken;
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    resHeaders['Set-Cookie'] = `csrfToken=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
  }
  return token;
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(querystring.parse(body)));
    req.on('error', reject);
  });
}

function sendHtml(res, html, extraHeaders = {}) {
  res.writeHead(200, {
    ...securityHeaders(),
    ...extraHeaders,
    'Content-Type': 'text/html; charset=utf-8'
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end(text);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { ...securityHeaders(), ...extraHeaders, Location: location });
  res.end();
}

function navLink(pathname, current, label) {
  const active = pathname === current ? 'active' : '';
  return `<a class="nav-link ${active}" href="${pathname}">${label}</a>`;
}

function sectionCard(title, body, subtitle = '') {
  return `<section class="card"><div class="card-head"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${body}</section>`;
}

function pageTemplate({ title, currentPath, content, csrfToken }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · Oakstead</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f4f7ff;
  --panel: rgba(255, 255, 255, 0.88);
  --panel-soft: #ffffff;
  --text: #121824;
  --muted: #60708f;
  --line: #dce3f1;
  --brand: #4f46e5;
  --brand-2: #2563eb;
  --success: #0f766e;
  --radius: 18px;
  --shadow: 0 16px 40px rgba(13, 23, 49, 0.08);
}
[data-theme="dark"] {
  --bg: #0b1020;
  --panel: rgba(18, 26, 48, 0.9);
  --panel-soft: #121a30;
  --text: #ebf0ff;
  --muted: #98a6c6;
  --line: #253150;
  --brand: #7c8cff;
  --brand-2: #4f7cff;
  --success: #2dd4bf;
  --shadow: 0 18px 40px rgba(2, 6, 18, 0.5);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.2), transparent 40%), var(--bg);
  color: var(--text);
}
.container { width: min(1120px, 100% - 1.2rem); margin: 1rem auto 2.8rem; }
.app-shell { background: var(--panel); border: 1px solid var(--line); border-radius: 26px; box-shadow: var(--shadow); overflow: hidden; backdrop-filter: blur(12px); }
.topbar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; padding: .85rem 1rem; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: .8rem; min-width: 0; }
.brand-logo { width: clamp(126px, 26vw, 210px); height: auto; display: block; object-fit: contain; filter: drop-shadow(0 5px 10px rgba(22, 38, 18, 0.16)); }
.brand-copy { min-width: 0; }
.brand h1 { margin: 0; font-size: 1.08rem; letter-spacing: .2px; }
.brand p { margin: .25rem 0 0; color: var(--muted); font-size: .8rem; }
.theme-btn { border: 1px solid var(--line); border-radius: 999px; padding: .45rem .8rem; background: var(--panel-soft); color: var(--text); font-weight: 600; cursor: pointer; }
.layout { display: grid; grid-template-columns: 1fr; }
.sidebar { padding: 1rem; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .5rem; }
.nav-link { text-decoration: none; color: var(--text); background: var(--panel-soft); border: 1px solid var(--line); border-radius: 12px; padding: .65rem .7rem; text-align: center; font-weight: 600; font-size: .9rem; }
.nav-link.active { border-color: transparent; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; }
.main { padding: 1rem; }
.hero { margin-bottom: 1rem; }
.hero h2 { margin: 0; font-size: 1.35rem; }
.hero p { margin: .5rem 0 0; color: var(--muted); }
.kpi-grid { display: grid; gap: .8rem; grid-template-columns: repeat(2, minmax(0,1fr)); margin-top: 1rem; }
.kpi { background: var(--panel-soft); border: 1px solid var(--line); border-radius: 14px; padding: .85rem; }
.kpi .label { color: var(--muted); font-size: .82rem; margin-bottom: .25rem; }
.kpi .value { font-size: 1.45rem; font-weight: 700; }
.stack { display: grid; gap: .85rem; }
.card { background: var(--panel-soft); border: 1px solid var(--line); border-radius: var(--radius); padding: .95rem; }
.card-head h2 { margin: 0; font-size: 1rem; }
.card-head p { margin: .35rem 0 .8rem; font-size: .86rem; color: var(--muted); }
.form-grid { display: grid; grid-template-columns: 1fr; gap: .65rem; }
label { font-size: .85rem; color: var(--muted); display: block; }
input, select { width: 100%; margin-top: .35rem; background: var(--panel); border: 1px solid var(--line); border-radius: 11px; padding: .62rem .7rem; color: var(--text); font: inherit; }
button[type="submit"], .button { display:inline-flex; align-items:center; justify-content:center; border: none; border-radius: 12px; padding: .68rem .95rem; font-weight: 700; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; cursor: pointer; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; margin-top: .9rem; }
table { width: 100%; border-collapse: collapse; min-width: 640px; }
th, td { padding: .6rem .65rem; border-bottom: 1px solid var(--line); font-size: .86rem; text-align: left; }
th { color: var(--muted); font-weight: 600; }
.muted { color: var(--muted); font-size: .86rem; }
input[type="hidden"] { display:none; }
@media (min-width: 760px) {
  .container { width: min(1200px, 100% - 2rem); margin-top: 1.4rem; }
  .layout { grid-template-columns: 220px 1fr; }
  .sidebar { border-bottom: 0; border-right: 1px solid var(--line); display: flex; flex-direction: column; align-content: start; }
  .main { padding: 1.2rem; }
  .form-grid.cols-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .kpi-grid { grid-template-columns: repeat(5, minmax(0,1fr)); }
}
</style>
</head>
<body>
<div class="container">
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <img class="brand-logo" src="/assets/oakstead-logo.svg" alt="Oakstead logo" />
        <div class="brand-copy"><h1>Oakstead</h1><p>Rooted Records for Growing Minds.</p></div>
      </div>
      <button id="themeToggle" class="theme-btn" type="button" aria-label="Toggle dark mode">Toggle theme</button>
    </header>
    <div class="layout">
      <nav class="sidebar" aria-label="Primary navigation">
        ${navLink('/', currentPath, 'Dashboard')}
        ${navLink('/families', currentPath, 'Families')}
        ${navLink('/gradebook', currentPath, 'Gradebook')}
        ${navLink('/settings', currentPath, 'Settings')}
      </nav>
      <main class="main">
        ${content}
      </main>
    </div>
  </div>
</div>
<script>
(function(){
  const root = document.documentElement;
  const key = 'school-theme';
  const saved = localStorage.getItem(key);
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  const button = document.getElementById('themeToggle');
  const updateLabel = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    button.textContent = dark ? 'Switch to light' : 'Switch to dark';
  };
  updateLabel();
  button.addEventListener('click', function() {
    const dark = root.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(key, next);
    updateLabel();
  });
})();
</script>
${csrfToken ? `<!-- csrf:${csrfToken.slice(0, 8)} -->` : ''}
</body>
</html>`;
}

function csrfInput(token) {
  return `<input type="hidden" name="csrfToken" value="${token}" />`;
}

function requireCsrf(req, body) {
  const cookies = parseCookies(req);
  return Boolean(body.csrfToken && cookies.csrfToken && body.csrfToken === cookies.csrfToken);
}

ensureDb();

const server = http.createServer(async (req, res) => {
  const resHeaders = {};
  const csrfToken = getOrCreateCsrfToken(req, resHeaders);

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (req.method === 'GET' && p === '/assets/oakstead-logo.svg') {
      const logoPath = path.join(__dirname, 'assets', 'oakstead-logo.svg');
      if (!fs.existsSync(logoPath)) return sendText(res, 404, 'Not Found');
      const logo = fs.readFileSync(logoPath, 'utf8');
      res.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(logo);
    }

    if (req.method === 'GET' && p === '/') {
      const [families] = querySql('SELECT COUNT(*) as c FROM families');
      const [students] = querySql('SELECT COUNT(*) as c FROM students');
      const [teachers] = querySql('SELECT COUNT(*) as c FROM teachers');
      const [terms] = querySql('SELECT COUNT(*) as c FROM terms');
      const [assessments] = querySql('SELECT COUNT(*) as c FROM assessments');
      const content = `
        <section class="hero"><h2>Overview</h2><p>Secure, internet-ready workflow for enrollment, classrooms, and grading.</p></section>
        <div class="kpi-grid">
          <article class="kpi"><div class="label">Families</div><div class="value">${families.c}</div></article>
          <article class="kpi"><div class="label">Students</div><div class="value">${students.c}</div></article>
          <article class="kpi"><div class="label">Teachers</div><div class="value">${teachers.c}</div></article>
          <article class="kpi"><div class="label">Terms</div><div class="value">${terms.c}</div></article>
          <article class="kpi"><div class="label">Assessments</div><div class="value">${assessments.c}</div></article>
        </div>
      `;
      return sendHtml(res, pageTemplate({ title: 'Dashboard', currentPath: p, content, csrfToken }), resHeaders);
    }

    if (req.method === 'GET' && p === '/families') {
      const families = querySql('SELECT * FROM families ORDER BY id DESC');
      const students = querySql('SELECT s.*, f.family_name FROM students s JOIN families f ON f.id=s.family_id ORDER BY s.id DESC');
      const familyOptions = families.map((f) => `<option value="${f.id}">${esc(f.family_name)}</option>`).join('');
      const familiesTable = `<div class="table-wrap"><table><tr><th>ID</th><th>Family</th><th>Mom</th><th>Dad</th><th>Phone</th><th>Address</th></tr>${families.map((f) => `<tr><td>${f.id}</td><td>${esc(f.family_name)}</td><td>${esc(f.mom_name)}</td><td>${esc(f.dad_name)}</td><td>${esc(f.phone)}</td><td>${esc(f.address)}</td></tr>`).join('')}</table></div>`;
      const studentsTable = `<div class="table-wrap"><table><tr><th>ID</th><th>Student</th><th>Birth Date</th><th>Grade</th><th>Family</th></tr>${students.map((s) => `<tr><td>${s.id}</td><td>${esc(`${s.first_name} ${s.last_name}`)}</td><td>${esc(s.birth_date)}</td><td>${esc(s.current_grade)}</td><td>${esc(s.family_name)}</td></tr>`).join('')}</table></div>`;

      const content = `<section class="hero"><h2>Families & Enrollment</h2><p>Capture household profiles and student records with optimized mobile forms.</p></section>
      <div class="stack">
      ${sectionCard('Add Family', `<form method="post" action="/families" class="form-grid cols-2">${csrfInput(csrfToken)}
        <label>Family Name<input name="familyName" required maxlength="120" /></label>
        <label>Phone<input name="phone" maxlength="32" /></label>
        <label>Mom Name<input name="momName" maxlength="120" /></label>
        <label>Dad Name<input name="dadName" maxlength="120" /></label>
        <label style="grid-column:1/-1">Address<input name="address" maxlength="180" /></label>
        <button type="submit">Save Family</button>
      </form>`)}
      ${sectionCard('Add Student', `<form method="post" action="/students" class="form-grid cols-2">${csrfInput(csrfToken)}
        <label>First Name<input name="firstName" required maxlength="80" /></label>
        <label>Last Name<input name="lastName" required maxlength="80" /></label>
        <label>Birth Date<input type="date" name="birthDate" /></label>
        <label>Current Grade<input name="currentGrade" required maxlength="16" /></label>
        <label style="grid-column:1/-1">Family<select name="familyId" required><option value="">Choose family</option>${familyOptions}</select></label>
        <button type="submit">Save Student</button>
      </form>`)}
      ${sectionCard('Family Directory', familiesTable)}
      ${sectionCard('Student Directory', studentsTable)}
      </div>`;

      return sendHtml(res, pageTemplate({ title: 'Families', currentPath: p, content, csrfToken }), resHeaders);
    }

    if (req.method === 'GET' && p === '/settings') {
      const teachers = querySql('SELECT * FROM teachers ORDER BY id DESC');
      const terms = querySql('SELECT * FROM terms ORDER BY id DESC');
      const classrooms = querySql('SELECT c.*, t.name as teacher_name, tr.name as term_name FROM classrooms c JOIN teachers t ON t.id=c.teacher_id JOIN terms tr ON tr.id=c.term_id ORDER BY c.id DESC');
      const subjects = querySql('SELECT * FROM subjects ORDER BY id DESC');
      const curriculum = querySql('SELECT c.id, c.grade, s.name as subject_name FROM curriculum_assignments c JOIN subjects s ON s.id=c.subject_id ORDER BY c.id DESC');
      const weights = querySql('SELECT * FROM grade_weights ORDER BY id DESC');

      const teacherOptions = teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
      const termOptions = terms.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
      const subjectOptions = subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

      const content = `<section class="hero"><h2>Settings</h2><p>Manage staffing, calendars, curriculum maps, and grade strategy.</p></section>
      <div class="stack">
      ${sectionCard('Teachers', `<form method="post" action="/settings/teachers" class="form-grid cols-2">${csrfInput(csrfToken)}
          <label>Name<input name="name" required maxlength="120"/></label>
          <label>Email<input type="email" name="email" maxlength="160"/></label>
          <button type="submit">Save Teacher</button>
      </form><div class="table-wrap"><table><tr><th>ID</th><th>Name</th><th>Email</th></tr>${teachers.map((t) => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.email)}</td></tr>`).join('')}</table></div>`)}

      ${sectionCard('Terms', `<form method="post" action="/settings/terms" class="form-grid cols-2">${csrfInput(csrfToken)}
          <label>Name<input name="name" required maxlength="120"/></label>
          <label>Grades Offered<input name="gradesOffered" placeholder="K,1,2,3" required maxlength="80"/></label>
          <label>Start Date<input type="date" name="startDate" required/></label>
          <label>End Date<input type="date" name="endDate" required/></label>
          <button type="submit">Save Term & Promote Students</button>
      </form><div class="table-wrap"><table><tr><th>ID</th><th>Name</th><th>Start</th><th>End</th><th>Grades</th></tr>${terms.map((t) => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.start_date)}</td><td>${esc(t.end_date)}</td><td>${esc(t.grades_offered)}</td></tr>`).join('')}</table></div>`)}

      ${sectionCard('Classrooms', `<form method="post" action="/settings/classrooms" class="form-grid cols-2">${csrfInput(csrfToken)}
          <label>Name<input name="name" required maxlength="120"/></label>
          <label>Grades<input name="grades" placeholder="3,4" required maxlength="80"/></label>
          <label>Teacher<select name="teacherId" required><option value="">Choose</option>${teacherOptions}</select></label>
          <label>Term<select name="termId" required><option value="">Choose</option>${termOptions}</select></label>
          <button type="submit">Save Classroom</button>
      </form><div class="table-wrap"><table><tr><th>ID</th><th>Name</th><th>Teacher</th><th>Grades</th><th>Term</th></tr>${classrooms.map((c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.teacher_name)}</td><td>${esc(c.grades)}</td><td>${esc(c.term_name)}</td></tr>`).join('')}</table></div>`)}

      ${sectionCard('Curriculum', `<form method="post" action="/settings/subjects" class="form-grid cols-2">${csrfInput(csrfToken)}
          <label>Subject Name<input name="name" required maxlength="120"/></label>
          <button type="submit">Add Subject</button>
      </form>
      <form method="post" action="/settings/curriculum" class="form-grid cols-2" style="margin-top:.8rem;">${csrfInput(csrfToken)}
          <label>Grade<input name="grade" required maxlength="16"/></label>
          <label>Subject<select name="subjectId" required><option value="">Choose</option>${subjectOptions}</select></label>
          <button type="submit">Assign Subject</button>
      </form>
      <div class="table-wrap"><table><tr><th>ID</th><th>Grade</th><th>Subject</th></tr>${curriculum.map((c) => `<tr><td>${c.id}</td><td>${esc(c.grade)}</td><td>${esc(c.subject_name)}</td></tr>`).join('')}</table></div>`)}

      ${sectionCard('Grade Weights', `<form method="post" action="/settings/weights" class="form-grid cols-2">${csrfInput(csrfToken)}
          <label>Category<input name="category" required maxlength="64"/></label>
          <label>Weight %<input name="weight" type="number" min="0" max="100" step="0.01" required/></label>
          <button type="submit">Save Weight</button>
      </form><div class="table-wrap"><table><tr><th>ID</th><th>Category</th><th>Weight</th></tr>${weights.map((w) => `<tr><td>${w.id}</td><td>${esc(w.category)}</td><td>${w.weight}%</td></tr>`).join('')}</table></div>`)}
      </div>`;

      return sendHtml(res, pageTemplate({ title: 'Settings', currentPath: p, content, csrfToken }), resHeaders);
    }

    if (req.method === 'GET' && p === '/gradebook') {
      const termId = asInt(url.searchParams.get('termId'));
      const grade = String(url.searchParams.get('grade') || '').slice(0, 16);
      const subjectId = asInt(url.searchParams.get('subjectId'));

      const terms = querySql('SELECT id,name FROM terms ORDER BY id DESC');
      const subjects = querySql('SELECT id,name FROM subjects ORDER BY id DESC');
      const students = grade ? querySql(`SELECT id, first_name, last_name FROM students WHERE current_grade=${sqlValue(grade)} ORDER BY last_name`) : [];
      const assessments = querySql('SELECT a.id, a.title, a.category, a.grade, s.name as subject_name, t.name as term_name, (SELECT COUNT(*) FROM scores sc WHERE sc.assessment_id=a.id) as score_count FROM assessments a JOIN subjects s ON s.id=a.subject_id JOIN terms t ON t.id=a.term_id ORDER BY a.id DESC');

      const content = `<section class="hero"><h2>Gradebook</h2><p>Create assessments quickly and score every learner in one flow.</p></section><div class="stack">
      ${sectionCard('Load Gradebook', `<form method="get" action="/gradebook" class="form-grid cols-2">
        <label>Term<select name="termId" required><option value="">Choose</option>${terms.map((t) => `<option ${termId === t.id ? 'selected' : ''} value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <label>Grade<input name="grade" value="${esc(grade)}" required maxlength="16"/></label>
        <label style="grid-column:1/-1">Subject<select name="subjectId" required><option value="">Choose</option>${subjects.map((s) => `<option ${subjectId === s.id ? 'selected' : ''} value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <button type="submit">Load Students</button>
      </form>`)}
      ${sectionCard('Create Assessment & Enter Scores', `<form method="post" action="/gradebook" class="form-grid cols-2">${csrfInput(csrfToken)}
        <input type="hidden" name="termId" value="${termId || ''}" />
        <input type="hidden" name="grade" value="${esc(grade)}" />
        <input type="hidden" name="subjectId" value="${subjectId || ''}" />
        <label>Assessment Title<input name="title" required maxlength="140"/></label>
        <label>Category<select name="category" required><option>Lesson</option><option>Quiz</option><option>Test</option><option>Homework</option></select></label>
        ${students.length ? students.map((s) => `<label>${esc(`${s.first_name} ${s.last_name}`)}<input type="number" step="0.01" min="0" max="100" name="student_${s.id}"/></label>`).join('') : '<p class="muted" style="grid-column:1/-1">Choose term, grade, and subject first.</p>'}
        <button type="submit">Save Assessment</button>
      </form>`)}
      ${sectionCard('Assessment History', `<div class="table-wrap"><table><tr><th>ID</th><th>Title</th><th>Category</th><th>Grade</th><th>Subject</th><th>Term</th><th>Scores</th></tr>${assessments.map((a) => `<tr><td>${a.id}</td><td>${esc(a.title)}</td><td>${esc(a.category)}</td><td>${esc(a.grade)}</td><td>${esc(a.subject_name)}</td><td>${esc(a.term_name)}</td><td>${a.score_count}</td></tr>`).join('')}</table></div>`)}
      </div>`;

      return sendHtml(res, pageTemplate({ title: 'Gradebook', currentPath: p, content, csrfToken }), resHeaders);
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      if (!requireCsrf(req, body)) return sendText(res, 403, 'Invalid CSRF token');

      if (p === '/families') {
        runSql(`INSERT INTO families (family_name, mom_name, dad_name, phone, address) VALUES (${sqlValue(String(body.familyName || '').slice(0, 120))}, ${sqlValue(String(body.momName || '').slice(0, 120))}, ${sqlValue(String(body.dadName || '').slice(0, 120))}, ${sqlValue(String(body.phone || '').slice(0, 32))}, ${sqlValue(String(body.address || '').slice(0, 180))});`);
        return redirect(res, '/families', resHeaders);
      }
      if (p === '/students') {
        runSql(`INSERT INTO students (family_id, first_name, last_name, birth_date, current_grade) VALUES (${asInt(body.familyId)}, ${sqlValue(String(body.firstName || '').slice(0, 80))}, ${sqlValue(String(body.lastName || '').slice(0, 80))}, ${sqlValue(String(body.birthDate || '').slice(0, 12))}, ${sqlValue(String(body.currentGrade || '').slice(0, 16))});`);
        return redirect(res, '/families', resHeaders);
      }
      if (p === '/settings/teachers') {
        runSql(`INSERT INTO teachers (name, email) VALUES (${sqlValue(String(body.name || '').slice(0, 120))}, ${sqlValue(String(body.email || '').slice(0, 160))});`);
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/settings/terms') {
        runSql(`INSERT INTO terms (name, start_date, end_date, grades_offered) VALUES (${sqlValue(String(body.name || '').slice(0, 120))}, ${sqlValue(String(body.startDate || '').slice(0, 12))}, ${sqlValue(String(body.endDate || '').slice(0, 12))}, ${sqlValue(String(body.gradesOffered || '').slice(0, 80))});`);
        const students = querySql('SELECT id, current_grade FROM students');
        students.forEach((s) => runSql(`UPDATE students SET current_grade=${sqlValue(promoteGrade(s.current_grade))} WHERE id=${s.id};`));
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/settings/classrooms') {
        runSql(`INSERT INTO classrooms (name, teacher_id, term_id, grades) VALUES (${sqlValue(String(body.name || '').slice(0, 120))}, ${asInt(body.teacherId)}, ${asInt(body.termId)}, ${sqlValue(String(body.grades || '').slice(0, 80))});`);
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/settings/subjects') {
        runSql(`INSERT OR IGNORE INTO subjects (name) VALUES (${sqlValue(String(body.name || '').slice(0, 120))});`);
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/settings/curriculum') {
        runSql(`INSERT INTO curriculum_assignments (grade, subject_id) VALUES (${sqlValue(String(body.grade || '').slice(0, 16))}, ${asInt(body.subjectId)});`);
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/settings/weights') {
        const weight = asScore(body.weight);
        runSql(`INSERT INTO grade_weights (category, weight) VALUES (${sqlValue(String(body.category || '').slice(0, 64))}, ${weight === null ? 0 : weight});`);
        return redirect(res, '/settings', resHeaders);
      }
      if (p === '/gradebook') {
        runSql(`INSERT INTO assessments (title, category, term_id, grade, subject_id) VALUES (${sqlValue(String(body.title || '').slice(0, 140))}, ${sqlValue(String(body.category || '').slice(0, 32))}, ${asInt(body.termId)}, ${sqlValue(String(body.grade || '').slice(0, 16))}, ${asInt(body.subjectId)});`);
        const [{ id: assessmentId }] = querySql('SELECT last_insert_rowid() as id');
        Object.keys(body).forEach((key) => {
          if (!key.startsWith('student_') || body[key] === '') return;
          const studentId = asInt(key.replace('student_', ''));
          const score = asScore(body[key]);
          if (studentId && score !== null) {
            runSql(`INSERT INTO scores (assessment_id, student_id, score) VALUES (${assessmentId}, ${studentId}, ${score});`);
          }
        });
        return redirect(res, `/gradebook?termId=${asInt(body.termId)}&grade=${encodeURIComponent(String(body.grade || ''))}&subjectId=${asInt(body.subjectId)}`, resHeaders);
      }

      return sendText(res, 404, 'Not Found');
    }

    return sendText(res, 404, 'Not Found');
  } catch (error) {
    if (error.message === 'Payload too large') {
      return sendText(res, 413, 'Payload too large');
    }
    console.error(error);
    return sendText(res, 500, 'Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Oakstead running on http://localhost:${PORT}`);
});
