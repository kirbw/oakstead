const references = {
  school_year_id: ['School year', 'os_school_years', 'name'],
  student_id: ['Student', 'os_students', "trim(first_name || ' ' || last_name)"],
  assignment_id: ['Assignment', 'os_assignments', 'title'],
  subject_id: ['Subject', 'os_subjects', 'name'],
  classroom_id: ['Classroom', 'os_classrooms', 'name'],
  teacher_id: ['Teacher', 'os_teachers', 'name'],
  marking_period_id: ['Marking period', 'os_marking_periods', 'name']
};

function resolveHistoryNames(querySql, records, { useDeletedAssignments = false } = {}) {
  const names = {};
  for (const [key, [, table, expression]] of Object.entries(references)) {
    const ids = [...new Set(records
      .filter(record => !record._names?.[key])
      .map(record => record[key])
      .filter(id => Number.isSafeInteger(id) && id > 0))];
    const byId = new Map();
    if (ids.length) {
      const rows = querySql(`SELECT id, ${expression} AS name FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
      for (const row of rows) if (row.name) byId.set(row.id, row.name);
    }
    names[key] = byId;
    if (key !== 'assignment_id' || !useDeletedAssignments) continue;

    const missing = ids.filter(id => !byId.has(id));
    if (!missing.length) continue;
    const rows = querySql(`SELECT assignment_id, before_json FROM os_academic_history
      WHERE id IN (
        SELECT (SELECT id FROM os_academic_history
          WHERE assignment_id = requested.value AND event_type = 'assignment' AND operation = 'delete'
          ORDER BY id DESC LIMIT 1)
        FROM json_each(?) requested
      )`, [JSON.stringify(missing)]);
    for (const row of rows) {
      const title = parseHistoryValues(row.before_json)?.title;
      if (title) byId.set(row.assignment_id, title);
    }
  }
  return names;
}

function parseHistoryValues(json) {
  try {
    const values = JSON.parse(json);
    return values && typeof values === 'object' && !Array.isArray(values) ? values : null;
  } catch { return null; }
}

function historyName(values, key, names) {
  return values._names?.[key] || names[key].get(values[key]);
}

module.exports = { references, resolveHistoryNames, parseHistoryValues, historyName };
