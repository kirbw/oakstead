const { execFileSync } = require('child_process');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'school.db');
const SHOULD_RESET = process.argv.includes('--reset');

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function run(sql) {
  execFileSync('sqlite3', [DB_FILE, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function runStatementsInChunks(statements, chunkSize = 300) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    run(['BEGIN;', ...statements.slice(index, index + chunkSize), 'COMMIT;'].join('\n'));
  }
}

function query(sql) {
  const out = execFileSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).trim();
  return out ? JSON.parse(out) : [];
}

function insertReturningId(sql) {
  return query(`${sql} RETURNING id;`)[0].id;
}

function findOne(sql) {
  return query(`${sql} LIMIT 1;`)[0] || null;
}

function resetData() {
  run(`
PRAGMA foreign_keys=OFF;
DELETE FROM os_scores;
DELETE FROM os_assignments;
DELETE FROM os_grade_subjects;
DELETE FROM os_grade_weight_items;
DELETE FROM os_grade_weight_groups;
DELETE FROM os_marking_periods;
DELETE FROM os_absences;
DELETE FROM os_student_years;
DELETE FROM os_classroom_grades;
DELETE FROM os_classrooms;
DELETE FROM os_person_roles;
DELETE FROM os_role_types;
DELETE FROM os_role_groups;
DELETE FROM os_emergency_contacts;
DELETE FROM os_students;
DELETE FROM os_families;
DELETE FROM os_congregations;
DELETE FROM os_school_districts;
DELETE FROM os_teachers;
DELETE FROM os_subjects;
DELETE FROM os_sessions;
DELETE FROM os_users;
DELETE FROM os_school_years;
DELETE FROM os_settings;
DELETE FROM sqlite_sequence WHERE name LIKE 'os_%';
PRAGMA foreign_keys=ON;
`);
}

function ensureYear() {
  const existing = findOne(`SELECT * FROM os_school_years WHERE name='2025-2026'`);
  const yearId = existing ? existing.id : insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active, school_days)
    VALUES ('2025-2026', '2025-08-15', '2026-05-31', 1, 180)`);
  run(`UPDATE os_school_years SET is_active=CASE WHEN id=${yearId} THEN 1 ELSE 0 END;`);
  const periods = [
    ['Period 1', '2025-08-15', '2025-10-01'],
    ['Period 2', '2025-10-02', '2025-11-18'],
    ['Period 3', '2025-11-19', '2026-01-06'],
    ['Period 4', '2026-01-07', '2026-02-23'],
    ['Period 5', '2026-02-24', '2026-04-12'],
    ['Period 6', '2026-04-13', '2026-05-31']
  ];
  periods.forEach((period, index) => {
    run(`INSERT OR REPLACE INTO os_marking_periods (school_year_id, period_number, name, start_date, end_date)
      VALUES (${yearId}, ${index + 1}, ${sqlValue(period[0])}, ${sqlValue(period[1])}, ${sqlValue(period[2])});`);
  });
  return yearId;
}

function ensureBasics() {
  run(`INSERT OR REPLACE INTO os_settings (key, value, updated_at)
    VALUES ('school_name', 'Oakstead School', CURRENT_TIMESTAMP);`);
  run(`INSERT INTO os_users (name, username, role, password_hash)
    VALUES ('Demo Admin', 'admin', 'admin', 'demo-mode-disabled-login');`);
  const groups = {
    'Board Members': ['Chairman', 'Secretary', 'Treasurer'],
    'Faculty Team': ['Teacher', 'Principal', 'Librarian', 'Nurse']
  };
  Object.entries(groups).forEach(([groupName, roles]) => {
    const groupId = insertReturningId(`INSERT INTO os_role_groups (name) VALUES (${sqlValue(groupName)})
      ON CONFLICT(name) DO UPDATE SET name=excluded.name`);
    roles.forEach((roleName) => run(`INSERT OR IGNORE INTO os_role_types (group_id, name) VALUES (${groupId}, ${sqlValue(roleName)});`));
  });
}

function subjectId(name) {
  const existing = findOne(`SELECT id FROM os_subjects WHERE name=${sqlValue(name)}`);
  return existing ? existing.id : insertReturningId(`INSERT INTO os_subjects (name) VALUES (${sqlValue(name)})`);
}

function teacherId(name, phone, email, address) {
  const existing = findOne(`SELECT id FROM os_teachers WHERE name=${sqlValue(name)}`);
  if (existing) return existing.id;
  return insertReturningId(`INSERT INTO os_teachers (name, email, mobile_phone, phone, address)
    VALUES (${sqlValue(name)}, ${sqlValue(email)}, ${sqlValue(phone)}, ${sqlValue(phone)}, ${sqlValue(address)})`);
}

function namedRecordId(tableName, name) {
  const existing = findOne(`SELECT id FROM ${tableName} WHERE name=${sqlValue(name)}`);
  if (existing) return existing.id;
  return insertReturningId(`INSERT INTO ${tableName} (name) VALUES (${sqlValue(name)})`);
}

function classroomId(yearId, grade, teacher) {
  const roomName = `Room ${grade}`;
  const existing = findOne(`SELECT id FROM os_classrooms WHERE school_year_id=${yearId} AND name=${sqlValue(roomName)}`);
  const id = existing ? existing.id : insertReturningId(`INSERT INTO os_classrooms (school_year_id, name, teacher_id)
    VALUES (${yearId}, ${sqlValue(roomName)}, ${teacher})`);
  run(`UPDATE os_classrooms SET teacher_id=${teacher} WHERE id=${id};`);
  run(`INSERT OR IGNORE INTO os_classroom_grades (classroom_id, grade_level) VALUES (${id}, ${sqlValue(String(grade))});`);
  return id;
}

function familyId(family, schoolDistrictId, congregationId) {
  const existing = findOne(`SELECT id FROM os_families WHERE family_name=${sqlValue(family.last)} AND father_name=${sqlValue(family.father)} AND mother_name=${sqlValue(family.mother)}`);
  if (existing) {
    run(`UPDATE os_families
      SET school_district_id=${schoolDistrictId || 'NULL'},
          congregation_id=${congregationId || 'NULL'}
      WHERE id=${existing.id};`);
    return existing.id;
  }
  return insertReturningId(`INSERT INTO os_families (family_name, school_district_id, congregation_id, father_name, mother_name, father_phone, mother_phone, phone, email, address)
    VALUES (${sqlValue(family.last)}, ${schoolDistrictId || 'NULL'}, ${congregationId || 'NULL'}, ${sqlValue(family.father)}, ${sqlValue(family.mother)}, ${sqlValue(family.phone)}, ${sqlValue(family.motherPhone || '')}, ${sqlValue(family.phone)}, ${sqlValue(family.email)}, ${sqlValue(family.address)})`);
}

function studentId(familyIdValue, student) {
  const existing = findOne(`SELECT id FROM os_students WHERE family_id=${familyIdValue} AND first_name=${sqlValue(student.first)} AND last_name=${sqlValue(student.last)} AND birth_date=${sqlValue(student.birth)}`);
  if (existing) return existing.id;
  return insertReturningId(`INSERT INTO os_students (family_id, first_name, middle_name, last_name, birth_date, gender)
    VALUES (${familyIdValue}, ${sqlValue(student.first)}, ${sqlValue(student.middle || '')}, ${sqlValue(student.last)}, ${sqlValue(student.birth)}, ${sqlValue(student.gender || '')})`);
}

function assignmentDate(period, offset) {
  const start = new Date(`${period.start_date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + offset);
  return start.toISOString().slice(0, 10);
}

if (SHOULD_RESET) resetData();

const yearId = ensureYear();
ensureBasics();

const teachers = [
  teacherId('Ellen Martin', '(717) 555-0110', 'ellen.martin@example.test', '102 Oak Lane, Carlisle, PA 17015'),
  teacherId('Marcus Weaver', '(717) 555-0120', 'marcus.weaver@example.test', '204 Maple Road, Carlisle, PA 17015'),
  teacherId('Nicole Fisher', '(717) 555-0130', 'nicole.fisher@example.test', '88 Pine Street, Carlisle, PA 17015'),
  teacherId('Daniel Ebersole', '(717) 555-0140', 'daniel.ebersole@example.test', '412 Meadow Drive, Carlisle, PA 17015'),
  teacherId('Rachel Brubaker', '(717) 555-0150', 'rachel.brubaker@example.test', '39 Creek Road, Carlisle, PA 17015')
];

const roomsByGrade = new Map();
for (let grade = 1; grade <= 10; grade += 1) roomsByGrade.set(String(grade), classroomId(yearId, grade, teachers[(grade - 1) % teachers.length]));

const subjects = ['Bible', 'Math', 'Reading', 'English', 'Spelling', 'Science', 'Social Studies', 'Penmanship', 'Music', 'Art'];
const subjectIds = subjects.map((name) => [name, subjectId(name)]);
for (let grade = 1; grade <= 10; grade += 1) {
  subjectIds.forEach(([, id]) => run(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id) VALUES (${yearId}, ${sqlValue(String(grade))}, ${id});`));
}

const schoolDistricts = [
  'Carlisle Area School District',
  'Big Spring School District',
  'Cumberland Valley School District',
  'Shippensburg Area School District',
  'Mechanicsburg Area School District'
];
const congregations = [
  'Oak Grove Mennonite Church',
  'Meadow View Fellowship',
  'Maple Run Church',
  'Cedar Springs Congregation',
  'Pleasant Valley Church',
  'Bethel Christian Fellowship'
];
const schoolDistrictIds = schoolDistricts.map((name) => namedRecordId('os_school_districts', name));
const congregationIds = congregations.map((name) => namedRecordId('os_congregations', name));

[
  ['Grades 1-2', '1', '2', [['Lesson / Homework', 50], ['Quiz', 25], ['Test', 25]]],
  ['Grades 3-10', '3', '10', [['Lesson / Homework', 25], ['Quiz', 25], ['Test', 50]]]
].forEach(([name, minGrade, maxGrade, weights]) => {
  const groupId = insertReturningId(`INSERT INTO os_grade_weight_groups (school_year_id, name, min_grade, max_grade)
    VALUES (${yearId}, ${sqlValue(name)}, ${sqlValue(minGrade)}, ${sqlValue(maxGrade)})`);
  weights.forEach(([category, weight]) => run(`INSERT INTO os_grade_weight_items (group_id, category, weight) VALUES (${groupId}, ${sqlValue(category)}, ${weight});`));
});

const families = [
  { last: 'Brubaker', father: 'Aaron', mother: 'Lydia', phone: '717-555-2101', email: 'brubaker@example.test', address: '118 Mill Road, Carlisle, PA 17015' },
  { last: 'Ebersole', father: 'Caleb', mother: 'Miriam', phone: '717-555-2102', email: 'ebersole@example.test', address: '42 Ridge Avenue, Newville, PA 17241' },
  { last: 'Fisher', father: 'Derek', mother: 'Anita', phone: '717-555-2103', email: 'fisher@example.test', address: '309 Walnut Bottom Road, Carlisle, PA 17015' },
  { last: 'Good', father: 'Jonas', mother: 'Rachel', phone: '717-555-2104', email: 'good@example.test', address: '76 Spring Lane, Shippensburg, PA 17257' },
  { last: 'Hoover', father: 'Matthew', mother: 'Elaine', phone: '717-555-2105', email: 'hoover@example.test', address: '551 Schoolhouse Road, Newburg, PA 17240' },
  { last: 'King', father: 'Nathan', mother: 'Priscilla', phone: '717-555-2106', email: 'king@example.test', address: '17 Orchard View Drive, Carlisle, PA 17015' },
  { last: 'Martin', father: 'Samuel', mother: 'Grace', phone: '717-555-2107', email: 'martin@example.test', address: '904 Creek Bend Road, Newville, PA 17241' },
  { last: 'Miller', father: 'Philip', mother: 'Joanna', phone: '717-555-2108', email: 'miller@example.test', address: '63 Meadow Brook Lane, Carlisle, PA 17015' },
  { last: 'Stoltzfus', father: 'Isaac', mother: 'Naomi', phone: '717-555-2109', email: 'stoltzfus@example.test', address: '225 Stone Church Road, Carlisle, PA 17015' },
  { last: 'Yoder', father: 'Benjamin', mother: 'Kara', phone: '717-555-2110', email: 'yoder@example.test', address: '810 Locust Point Road, Mechanicsburg, PA 17050' }
];

const children = [
  ['Brubaker', [['Hannah', 'Marie', 'female', '2016-01-18', '4'], ['Levi', 'James', 'male', '2018-03-22', '2'], ['Clara', 'Rose', 'female', '2019-09-07', '1'], ['Miles', 'Aaron', 'male', '2014-11-13', '6']]],
  ['Ebersole', [['Owen', 'Ray', 'male', '2012-02-05', '8'], ['Bethany', 'Anne', 'female', '2015-07-19', '5'], ['Micah', 'Lee', 'male', '2017-12-03', '3']]],
  ['Fisher', [['Naomi', 'Joy', 'female', '2013-04-14', '7'], ['Titus', 'Allen', 'male', '2016-08-27', '4'], ['Sadie', 'Lynn', 'female', '2018-06-11', '2'], ['Joel', 'Mark', 'male', '2011-10-30', '9']]],
  ['Good', [['Elijah', 'Paul', 'male', '2015-05-21', '5'], ['Moriah', 'Faith', 'female', '2017-01-09', '3'], ['Silas', 'John', 'male', '2019-02-16', '1']]],
  ['Hoover', [['Emma', 'Kate', 'female', '2010-09-25', '10'], ['Austin', 'Dale', 'male', '2013-12-12', '7'], ['Lena', 'Mae', 'female', '2016-04-02', '4'], ['Calvin', 'Ross', 'male', '2018-11-23', '2']]],
  ['King', [['Jared', 'Wesley', 'male', '2012-06-04', '8'], ['Alivia', 'Hope', 'female', '2014-02-18', '6'], ['Grant', 'Edward', 'male', '2017-05-28', '3'], ['Kendra', 'Ruth', 'female', '2019-08-08', '1']]],
  ['Martin', [['Trevor', 'Shane', 'male', '2011-08-29', '9'], ['Brielle', 'Kay', 'female', '2013-03-17', '7'], ['Wyatt', 'Cole', 'male', '2015-10-06', '5'], ['Megan', 'Leigh', 'female', '2018-01-31', '2']]],
  ['Miller', [['Kaitlyn', 'Sue', 'female', '2010-12-20', '10'], ['Brandon', 'Lee', 'male', '2014-07-15', '6'], ['Natalie', 'Jane', 'female', '2016-11-04', '4']]],
  ['Stoltzfus', [['Logan', 'Keith', 'male', '2012-01-26', '8'], ['Avery', 'Grace', 'female', '2015-09-09', '5'], ['Dylan', 'Jay', 'male', '2017-04-20', '3'], ['Marissa', 'Beth', 'female', '2019-06-12', '1']]],
  ['Yoder', [['Isaiah', 'Luke', 'male', '2011-03-05', '9'], ['Julia', 'Ann', 'female', '2013-10-18', '7'], ['Ethan', 'Blake', 'male', '2016-02-24', '4'], ['Olivia', 'Claire', 'female', '2018-05-16', '2']]]
];

const familyIdByLast = new Map();
families.forEach((family, index) => {
  const schoolDistrictId = schoolDistrictIds[(index * 7 + family.last.length) % schoolDistrictIds.length];
  const congregationId = congregationIds[(index * 5 + family.father.length) % congregationIds.length];
  familyIdByLast.set(family.last, familyId(family, schoolDistrictId, congregationId));
});

const studentsByGrade = new Map();
children.forEach(([last, kids]) => {
  const fid = familyIdByLast.get(last);
  kids.forEach(([first, middle, gender, birth, grade]) => {
    const sid = studentId(fid, { first, middle, last, gender, birth });
    run(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id, status)
      VALUES (${sid}, ${yearId}, ${sqlValue(grade)}, ${roomsByGrade.get(grade)}, 'enrolled')
      ON CONFLICT(student_id, school_year_id) DO UPDATE SET grade_level=excluded.grade_level, classroom_id=excluded.classroom_id, status='enrolled';`);
    if (!studentsByGrade.has(grade)) studentsByGrade.set(grade, []);
    studentsByGrade.get(grade).push(sid);
  });
});

const periods = query(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
const assignmentTemplates = [
  ['Lesson 1', 'Lesson / Homework', 5],
  ['Lesson 2', 'Lesson / Homework', 13],
  ['Quiz 1', 'Quiz', 23],
  ['Test 1', 'Test', 35]
];
const scoreStatements = [];
let assignmentCount = 0;
let scoreCount = 0;
for (let grade = 1; grade <= 10; grade += 1) {
  const gradeText = String(grade);
  const studentIds = studentsByGrade.get(gradeText) || [];
  for (const [, subjectIdValue] of subjectIds) {
    for (const period of periods) {
      assignmentTemplates.forEach(([title, category, offset], templateIndex) => {
        const assignmentId = insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, classroom_id, marking_period_id, title, category, assignment_date, max_score)
          VALUES (${yearId}, ${sqlValue(gradeText)}, ${subjectIdValue}, ${roomsByGrade.get(gradeText)}, ${period.id}, ${sqlValue(title)}, ${sqlValue(category)}, ${sqlValue(assignmentDate(period, offset))}, 100)`);
        assignmentCount += 1;
        studentIds.forEach((studentIdValue, studentIndex) => {
          const score = Math.max(58, Math.min(100, 72 + ((grade * 3 + subjectIdValue * 2 + period.period_number * 4 + templateIndex * 5 + studentIndex * 3) % 26)));
          scoreStatements.push(`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentIdValue}, ${score});`);
          scoreCount += 1;
        });
      });
    }
  }
}
runStatementsInChunks(scoreStatements);

console.log(`Demo seed complete: ${families.length} families, ${[...studentsByGrade.values()].reduce((sum, list) => sum + list.length, 0)} students, ${subjects.length} subjects, ${assignmentCount} assignments, ${scoreCount} scores.`);
