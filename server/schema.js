const { DatabaseSync } = require('node:sqlite');

const SCHEMA_SQL = `
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
`;

const ADDITIVE_COLUMNS = [
  {
    "table": "os_school_years",
    "column": "school_days",
    "definition": "school_days INTEGER DEFAULT 180"
  },
  {
    "table": "os_assignments",
    "column": "marking_period_id",
    "definition": "marking_period_id INTEGER"
  },
  {
    "table": "os_families",
    "column": "school_district_id",
    "definition": "school_district_id INTEGER"
  },
  {
    "table": "os_families",
    "column": "congregation_id",
    "definition": "congregation_id INTEGER"
  },
  {
    "table": "os_families",
    "column": "father_phone",
    "definition": "father_phone TEXT"
  },
  {
    "table": "os_families",
    "column": "mother_phone",
    "definition": "mother_phone TEXT"
  },
  {
    "table": "os_students",
    "column": "middle_name",
    "definition": "middle_name TEXT"
  },
  {
    "table": "os_students",
    "column": "gender",
    "definition": "gender TEXT"
  },
  {
    "table": "os_teachers",
    "column": "mobile_phone",
    "definition": "mobile_phone TEXT"
  },
  {
    "table": "os_teachers",
    "column": "address",
    "definition": "address TEXT"
  },
  {
    "table": "os_users",
    "column": "parent_family_id",
    "definition": "parent_family_id INTEGER"
  }
];

function applyAdditiveMigrations(connection) {
  for (const { table, column, definition } of ADDITIVE_COLUMNS) {
    const columns = connection.prepare(`PRAGMA table_info(${table});`).all();
    if (!columns.some((row) => row.name === column)) connection.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  }
}

let schemaManifest;
function expectedSchema() {
  if (schemaManifest) return schemaManifest;
  const reference = new DatabaseSync(':memory:');
  try {
    reference.exec(SCHEMA_SQL);
    applyAdditiveMigrations(reference);
    schemaManifest = reference.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'os_%';").all()
      .map(({ name }) => ({ table: name, columns: reference.prepare(`PRAGMA table_info(${name});`).all().map((row) => row.name) }));
    return schemaManifest;
  } finally { reference.close(); }
}

function validateApplicationSchema(connection, { allowAdditive = false } = {}) {
  const tables = new Set(connection.prepare("SELECT name FROM sqlite_master WHERE type='table';").all().map((row) => row.name));
  for (const { table, columns } of expectedSchema()) {
    if (!tables.has(table)) throw new Error(`Backup is missing required Oakstead table ${table}.`);
    const actual = new Set(connection.prepare(`PRAGMA table_info(${table});`).all().map((row) => row.name));
    for (const column of columns) {
      if (actual.has(column)) continue;
      if (allowAdditive && ADDITIVE_COLUMNS.some((item) => item.table === table && item.column === column)) continue;
      throw new Error(`Backup is missing required Oakstead column ${table}.${column}.`);
    }
  }
}

function smokeCheck(connection) {
  validateApplicationSchema(connection);
  for (const { table } of expectedSchema()) connection.prepare(`SELECT * FROM ${table} LIMIT 0;`).all();
  for (const table of ['os_school_years', 'os_users']) {
    if (!connection.prepare(`SELECT 1 FROM ${table} LIMIT 1;`).get()) throw new Error(`Backup has no required ${table} records.`);
  }
}

module.exports = { SCHEMA_SQL, ADDITIVE_COLUMNS, applyAdditiveMigrations, validateApplicationSchema, smokeCheck };

