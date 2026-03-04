const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const querystring = require('querystring');
const { execFileSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'school.db');

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function sqlValue(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
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

  const hasWeights = querySql('SELECT COUNT(*) as count FROM grade_weights')[0].count;
  if (!hasWeights) {
    runSql(`INSERT INTO grade_weights (category, weight) VALUES
      ('Homework', 20), ('Lesson', 20), ('Quiz', 25), ('Test', 35);`);
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => resolve(querystring.parse(body)));
  });
}

function htmlPage(title, content) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
body{font-family:Arial,sans-serif;margin:1rem auto;max-width:1100px;line-height:1.4}
nav a{margin-right:.8rem}.card{border:1px solid #ddd;border-radius:8px;padding:.8rem 1rem;margin:1rem 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem 1rem} .grid button{grid-column:1/-1;width:fit-content}
input,select{padding:.35rem;margin:.2rem 0;width:100%;box-sizing:border-box} table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:.45rem;text-align:left}.muted{color:#666}.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem}
</style></head><body>
<h1>School Grade Tracker</h1>
<nav><a href="/">Dashboard</a><a href="/families">Families</a><a href="/gradebook">Gradebook Entry</a><a href="/settings">Settings</a></nav><hr/>
${content}</body></html>`;
}

function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function sendHtml(res, html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }

function promoteGrade(grade) {
  const n = Number(grade);
  return Number.isNaN(n) ? grade : String(n + 1);
}

ensureDb();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/') {
    const [families] = querySql('SELECT COUNT(*) as c FROM families');
    const [students] = querySql('SELECT COUNT(*) as c FROM students');
    const [teachers] = querySql('SELECT COUNT(*) as c FROM teachers');
    const [terms] = querySql('SELECT COUNT(*) as c FROM terms');
    const [assessments] = querySql('SELECT COUNT(*) as c FROM assessments');
    return sendHtml(res, htmlPage('Dashboard', `<p>SQLite-backed school CRM and gradebook.</p><div class="three"><div class="card"><b>Families</b><br/>${families.c}</div><div class="card"><b>Students</b><br/>${students.c}</div><div class="card"><b>Teachers</b><br/>${teachers.c}</div><div class="card"><b>Terms</b><br/>${terms.c}</div><div class="card"><b>Assessments</b><br/>${assessments.c}</div></div>`));
  }

  if (req.method === 'GET' && p === '/families') {
    const families = querySql('SELECT * FROM families ORDER BY id DESC');
    const students = querySql('SELECT s.*, f.family_name FROM students s JOIN families f ON f.id=s.family_id ORDER BY s.id DESC');
    const familyOptions = families.map((f) => `<option value="${f.id}">${esc(f.family_name)}</option>`).join('');
    const fRows = families.map((f) => `<tr><td>${f.id}</td><td>${esc(f.family_name)}</td><td>${esc(f.mom_name)}</td><td>${esc(f.dad_name)}</td><td>${esc(f.phone)}</td><td>${esc(f.address)}</td></tr>`).join('');
    const sRows = students.map((s) => `<tr><td>${s.id}</td><td>${esc(`${s.first_name} ${s.last_name}`)}</td><td>${esc(s.birth_date)}</td><td>${esc(s.current_grade)}</td><td>${esc(s.family_name)}</td></tr>`).join('');
    return sendHtml(res, htmlPage('Families', `<div class="card"><h2>Add Family</h2><form method="post" action="/families" class="grid"><label>Family Name<input name="familyName" required/></label><label>Phone<input name="phone"/></label><label>Mom Name<input name="momName"/></label><label>Dad Name<input name="dadName"/></label><label style="grid-column:1/-1">Address<input name="address"/></label><button type="submit">Save Family</button></form></div>
<div class="card"><h2>Add Student</h2><form method="post" action="/students" class="grid"><label>First Name<input name="firstName" required/></label><label>Last Name<input name="lastName" required/></label><label>Birth Date<input type="date" name="birthDate"/></label><label>Current Grade<input name="currentGrade" required/></label><label>Family<select name="familyId" required><option value="">Choose family</option>${familyOptions}</select></label><button type="submit">Save Student</button></form></div>
<h3>Families</h3><table><tr><th>ID</th><th>Name</th><th>Mom</th><th>Dad</th><th>Phone</th><th>Address</th></tr>${fRows}</table>
<h3>Students</h3><table><tr><th>ID</th><th>Student</th><th>Birthdate</th><th>Grade</th><th>Family</th></tr>${sRows}</table>`));
  }

  if (req.method === 'POST' && p === '/families') {
    const b = await parseBody(req);
    runSql(`INSERT INTO families (family_name, mom_name, dad_name, phone, address) VALUES (${sqlValue(b.familyName)}, ${sqlValue(b.momName)}, ${sqlValue(b.dadName)}, ${sqlValue(b.phone)}, ${sqlValue(b.address)});`);
    return redirect(res, '/families');
  }

  if (req.method === 'POST' && p === '/students') {
    const b = await parseBody(req);
    runSql(`INSERT INTO students (family_id, first_name, last_name, birth_date, current_grade) VALUES (${Number(b.familyId)}, ${sqlValue(b.firstName)}, ${sqlValue(b.lastName)}, ${sqlValue(b.birthDate)}, ${sqlValue(b.currentGrade)});`);
    return redirect(res, '/families');
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

    return sendHtml(res, htmlPage('Settings', `
      <p class="muted">Configure teachers, terms, classrooms, curriculum, and grade weights here.</p>

      <div class="card"><h2>Teachers</h2><form method="post" action="/settings/teachers" class="grid"><label>Name<input name="name" required/></label><label>Email<input type="email" name="email"/></label><button type="submit">Save Teacher</button></form>
      <table><tr><th>ID</th><th>Name</th><th>Email</th></tr>${teachers.map((t) => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.email)}</td></tr>`).join('')}</table></div>

      <div class="card"><h2>Terms</h2><form method="post" action="/settings/terms" class="grid"><label>Name<input name="name" required/></label><label>Grades Offered<input name="gradesOffered" placeholder="K,1,2,3" required/></label><label>Start Date<input type="date" name="startDate" required/></label><label>End Date<input type="date" name="endDate" required/></label><button type="submit">Save Term + Promote Students</button></form>
      <table><tr><th>ID</th><th>Name</th><th>Start</th><th>End</th><th>Grades</th></tr>${terms.map((t) => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.start_date)}</td><td>${esc(t.end_date)}</td><td>${esc(t.grades_offered)}</td></tr>`).join('')}</table></div>

      <div class="card"><h2>Classrooms</h2><form method="post" action="/settings/classrooms" class="grid"><label>Name<input name="name" required/></label><label>Grades<input name="grades" placeholder="3,4" required/></label><label>Teacher<select name="teacherId" required><option value="">Choose</option>${teacherOptions}</select></label><label>Term<select name="termId" required><option value="">Choose</option>${termOptions}</select></label><button type="submit">Save Classroom</button></form>
      <table><tr><th>ID</th><th>Name</th><th>Teacher</th><th>Grades</th><th>Term</th></tr>${classrooms.map((c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.teacher_name)}</td><td>${esc(c.grades)}</td><td>${esc(c.term_name)}</td></tr>`).join('')}</table></div>

      <div class="card"><h2>Curriculum</h2><form method="post" action="/settings/subjects" class="grid"><label>Subject Name<input name="name" required/></label><button type="submit">Add Subject</button></form>
      <form method="post" action="/settings/curriculum" class="grid"><label>Grade<input name="grade" required/></label><label>Subject<select name="subjectId" required><option value="">Choose</option>${subjectOptions}</select></label><button type="submit">Assign Subject</button></form>
      <table><tr><th>ID</th><th>Grade</th><th>Subject</th></tr>${curriculum.map((c) => `<tr><td>${c.id}</td><td>${esc(c.grade)}</td><td>${esc(c.subject_name)}</td></tr>`).join('')}</table></div>

      <div class="card"><h2>Grade Weights</h2><form method="post" action="/settings/weights" class="grid"><label>Category<input name="category" required/></label><label>Weight %<input name="weight" type="number" min="0" max="100" step="0.01" required/></label><button type="submit">Save Weight</button></form>
      <table><tr><th>ID</th><th>Category</th><th>Weight</th></tr>${weights.map((w) => `<tr><td>${w.id}</td><td>${esc(w.category)}</td><td>${w.weight}%</td></tr>`).join('')}</table></div>
    `));
  }

  if (req.method === 'POST' && p === '/settings/teachers') {
    const b = await parseBody(req);
    runSql(`INSERT INTO teachers (name, email) VALUES (${sqlValue(b.name)}, ${sqlValue(b.email)});`);
    return redirect(res, '/settings');
  }
  if (req.method === 'POST' && p === '/settings/terms') {
    const b = await parseBody(req);
    runSql(`INSERT INTO terms (name, start_date, end_date, grades_offered) VALUES (${sqlValue(b.name)}, ${sqlValue(b.startDate)}, ${sqlValue(b.endDate)}, ${sqlValue(b.gradesOffered)});`);
    const students = querySql('SELECT id, current_grade FROM students');
    students.forEach((s) => runSql(`UPDATE students SET current_grade=${sqlValue(promoteGrade(s.current_grade))} WHERE id=${s.id};`));
    return redirect(res, '/settings');
  }
  if (req.method === 'POST' && p === '/settings/classrooms') {
    const b = await parseBody(req);
    runSql(`INSERT INTO classrooms (name, teacher_id, term_id, grades) VALUES (${sqlValue(b.name)}, ${Number(b.teacherId)}, ${Number(b.termId)}, ${sqlValue(b.grades)});`);
    return redirect(res, '/settings');
  }
  if (req.method === 'POST' && p === '/settings/subjects') {
    const b = await parseBody(req);
    runSql(`INSERT OR IGNORE INTO subjects (name) VALUES (${sqlValue(b.name)});`);
    return redirect(res, '/settings');
  }
  if (req.method === 'POST' && p === '/settings/curriculum') {
    const b = await parseBody(req);
    runSql(`INSERT INTO curriculum_assignments (grade, subject_id) VALUES (${sqlValue(b.grade)}, ${Number(b.subjectId)});`);
    return redirect(res, '/settings');
  }
  if (req.method === 'POST' && p === '/settings/weights') {
    const b = await parseBody(req);
    runSql(`INSERT INTO grade_weights (category, weight) VALUES (${sqlValue(b.category)}, ${Number(b.weight)});`);
    return redirect(res, '/settings');
  }

  if (req.method === 'GET' && p === '/gradebook') {
    const termId = Number(url.searchParams.get('termId') || 0);
    const grade = url.searchParams.get('grade') || '';
    const subjectId = Number(url.searchParams.get('subjectId') || 0);

    const terms = querySql('SELECT id,name FROM terms ORDER BY id DESC');
    const subjects = querySql('SELECT id,name FROM subjects ORDER BY id DESC');
    const students = grade ? querySql(`SELECT id, first_name, last_name FROM students WHERE current_grade=${sqlValue(grade)} ORDER BY last_name`) : [];
    const assessments = querySql('SELECT a.id, a.title, a.category, a.grade, s.name as subject_name, t.name as term_name, (SELECT COUNT(*) FROM scores sc WHERE sc.assessment_id=a.id) as score_count FROM assessments a JOIN subjects s ON s.id=a.subject_id JOIN terms t ON t.id=a.term_id ORDER BY a.id DESC');

    return sendHtml(res, htmlPage('Gradebook Entry', `
      <div class="card"><h2>Load Gradebook</h2><form method="get" action="/gradebook" class="grid"><label>Term<select name="termId" required><option value="">Choose</option>${terms.map((t) => `<option ${termId===t.id?'selected':''} value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><label>Grade<input name="grade" value="${esc(grade)}" required/></label><label>Subject<select name="subjectId" required><option value="">Choose</option>${subjects.map((s) => `<option ${subjectId===s.id?'selected':''} value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><button type="submit">Load Students</button></form></div>
      <div class="card"><h2>Create Assessment + Enter Grades</h2><form method="post" action="/gradebook" class="grid"><input type="hidden" name="termId" value="${termId||''}"/><input type="hidden" name="grade" value="${esc(grade)}"/><input type="hidden" name="subjectId" value="${subjectId||''}"/><label>Assessment Title<input name="title" required/></label><label>Category<select name="category" required><option>Lesson</option><option>Quiz</option><option>Test</option><option>Homework</option></select></label>${students.length?students.map((s)=>`<label>${esc(`${s.first_name} ${s.last_name}`)}<input type="number" step="0.01" min="0" max="100" name="student_${s.id}"/></label>`).join(''):'<p class="muted">Select term, grade, and subject first.</p>'}<button type="submit">Save Assessment</button></form></div>
      <h3>Assessment History</h3><table><tr><th>ID</th><th>Title</th><th>Category</th><th>Grade</th><th>Subject</th><th>Term</th><th>Scores</th></tr>${assessments.map((a)=>`<tr><td>${a.id}</td><td>${esc(a.title)}</td><td>${esc(a.category)}</td><td>${esc(a.grade)}</td><td>${esc(a.subject_name)}</td><td>${esc(a.term_name)}</td><td>${a.score_count}</td></tr>`).join('')}</table>
    `));
  }

  if (req.method === 'POST' && p === '/gradebook') {
    const b = await parseBody(req);
    runSql(`INSERT INTO assessments (title, category, term_id, grade, subject_id) VALUES (${sqlValue(b.title)}, ${sqlValue(b.category)}, ${Number(b.termId)}, ${sqlValue(b.grade)}, ${Number(b.subjectId)});`);
    const [{ id: assessmentId }] = querySql('SELECT last_insert_rowid() as id');
    for (const key of Object.keys(b)) {
      if (key.startsWith('student_') && b[key] !== '') {
        runSql(`INSERT INTO scores (assessment_id, student_id, score) VALUES (${assessmentId}, ${Number(key.replace('student_', ''))}, ${Number(b[key])});`);
      }
    }
    return redirect(res, `/gradebook?termId=${b.termId}&grade=${encodeURIComponent(b.grade || '')}&subjectId=${b.subjectId}`);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => console.log(`School Grade Tracker running on http://localhost:${PORT}`));
