const { asInt } = require('./input');

const SECTION_DATA = {
  families: ['districts', 'congregations', 'roleGroups', 'roleTypes', 'personRoles', 'classrooms', 'families', 'students'],
  districts: ['districts'],
  congregations: ['congregations'],
  teachers: ['teachers', 'roleGroups', 'roleTypes', 'personRoles'],
  classrooms: ['classrooms', 'teachers'],
  subjects: ['subjects', 'gradeSubjects'],
  years: ['schoolYears', 'markingPeriods'],
  weights: ['weightGroups', 'weightItems', 'subjects'],
  'letter-grades': ['letterGroups', 'letterItems', 'subjects'],
  users: ['users', 'teachers', 'families'],
  settings: [],
  network: [],
  backups: [],
  updates: []
};

function loadSetupCounts(query, yearId) {
  return query(`SELECT
    (SELECT COUNT(*) FROM os_families) AS families,
    (SELECT COUNT(*) FROM os_school_districts) AS districts,
    (SELECT COUNT(*) FROM os_congregations) AS congregations,
    (SELECT COUNT(*) FROM os_teachers) AS teachers,
    (SELECT COUNT(*) FROM os_classrooms WHERE school_year_id=${asInt(yearId)}) AS classrooms,
    (SELECT COUNT(*) FROM os_subjects) AS subjects,
    (SELECT COUNT(*) FROM os_school_years) AS schoolYears,
    (SELECT COUNT(*) FROM os_grade_weight_groups WHERE school_year_id=${asInt(yearId)}) AS weightGroups,
    (SELECT COUNT(*) FROM os_letter_grade_groups WHERE school_year_id=${asInt(yearId)}) AS letterGroups,
    (SELECT COUNT(*) FROM os_users) AS users`)[0];
}

function loadSetupSection(query, yearId, section, requestedFamilyId = 0) {
  yearId = asInt(yearId);
  const data = {};
  const selectedFamily = () => data.families?.find((row) => row.id === asInt(requestedFamilyId)) || data.families?.[0];
  const loaders = {
    teachers: () => query('SELECT * FROM os_teachers ORDER BY name;'),
    subjects: () => query('SELECT * FROM os_subjects ORDER BY name;'),
    districts: () => query('SELECT * FROM os_school_districts ORDER BY name;'),
    congregations: () => query('SELECT * FROM os_congregations ORDER BY name;'),
    roleGroups: () => query('SELECT * FROM os_role_groups ORDER BY name;'),
    roleTypes: () => query('SELECT rt.*, rg.name AS group_name FROM os_role_types rt JOIN os_role_groups rg ON rg.id = rt.group_id ORDER BY rg.name, rt.name;'),
    personRoles: () => query(`SELECT pr.*, rg.name AS group_name, rt.name AS role_name
    FROM os_person_roles pr
    JOIN os_role_groups rg ON rg.id = pr.group_id
    JOIN os_role_types rt ON rt.id = pr.role_type_id
    ORDER BY pr.term_start DESC, rg.name, rt.name;`),
    schoolYears: () => query('SELECT * FROM os_school_years ORDER BY is_active DESC, name DESC;'),
    markingPeriods: () => query(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`),
    classrooms: () => query(`SELECT c.*, t.name AS teacher_name,
      GROUP_CONCAT(cg.grade_level, ', ') AS grades
    FROM os_classrooms c
    LEFT JOIN os_teachers t ON t.id = c.teacher_id
    LEFT JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${yearId}
    GROUP BY c.id
    ORDER BY c.name;`),
    gradeSubjects: () => query(`SELECT gs.grade_level, gs.subject_id, s.name AS subject_name
    FROM os_grade_subjects gs
    JOIN os_subjects s ON s.id = gs.subject_id
    WHERE gs.school_year_id=${yearId}
    ORDER BY gs.grade_level, s.name;`),
    families: () => query(`SELECT f.*, sd.name AS school_district_name, cng.name AS congregation_name,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_school_districts sd ON sd.id = f.school_district_id
    LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`),
    students: () => query(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    WHERE st.family_id=${asInt(selectedFamily()?.id)}
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`),
    users: () => query(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, u.parent_family_id, t.name AS teacher_name, f.family_name AS parent_family_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    LEFT JOIN os_families f ON f.id = u.parent_family_id
    ORDER BY u.name;`),
    weightGroups: () => query(`SELECT wg.*, s.name AS subject_name
    FROM os_grade_weight_groups wg
    LEFT JOIN os_subjects s ON s.id = wg.subject_id
    WHERE wg.school_year_id=${yearId}
    ORDER BY CAST(wg.min_grade AS INTEGER), wg.name;`),
    weightItems: () => query(`SELECT * FROM os_grade_weight_items
    WHERE group_id IN (SELECT id FROM os_grade_weight_groups WHERE school_year_id=${yearId})
    ORDER BY category;`),
    letterGroups: () => query(`SELECT lg.*, s.name AS subject_name
    FROM os_letter_grade_groups lg
    LEFT JOIN os_subjects s ON s.id = lg.subject_id
    WHERE lg.school_year_id=${yearId}
    ORDER BY CAST(lg.min_grade AS INTEGER), lg.name;`),
    letterItems: () => query(`SELECT * FROM os_letter_grade_items
    WHERE group_id IN (SELECT id FROM os_letter_grade_groups WHERE school_year_id=${yearId})
    ORDER BY threshold DESC, sort_order, letter;`)
  };
  for (const name of SECTION_DATA[section] || []) data[name] = loaders[name]();
  if (section === 'families') {
    const family = selectedFamily();
    data.emergencyContacts = family ? query(`SELECT * FROM os_emergency_contacts WHERE family_id=${asInt(family.id)} ORDER BY priority, name;`) : [];
  }
  return data;
}

module.exports = { loadSetupCounts, loadSetupSection };
