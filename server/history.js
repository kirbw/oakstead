const { asInt } = require('./input');
const { gridScoreEntries, scoreFieldEntries } = require('./gradebook-utils');

function createAcademicHistory(repository, { demoMode = false, now = () => new Date() } = {}) {
  const { querySql, executeSql } = repository;
  const assignments = ids => ids.length ? querySql(`SELECT id, school_year_id, grade_level,
    subject_id, classroom_id, teacher_id, title, category, assignment_date, max_score,
    marking_period_id FROM os_assignments WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids) : [];
  function scores(ids, studentIds) {
    if (!ids.length || studentIds?.length === 0) return [];
    return querySql(`SELECT sc.assignment_id, sc.student_id, sc.score,
      a.school_year_id FROM os_scores sc JOIN os_assignments a ON a.id=sc.assignment_id
      WHERE sc.assignment_id IN (${ids.map(() => '?').join(',')})
      ${studentIds ? `AND sc.student_id IN (${studentIds.map(() => '?').join(',')})` : ''}
      ORDER BY sc.assignment_id, sc.student_id`, [...ids, ...(studentIds || [])]);
  }

  function capture(path, body) {
    if (path === '/absences') return { kind: 'attendance', lastId: querySql('SELECT COALESCE(MAX(id),0) AS id FROM os_absences')[0].id };
    if (!['/gradebook', '/assignments'].includes(path)) return null;
    const createsAssignment = path === '/assignments' && body.action === 'add'
      || path === '/gradebook' && body.action === 'add-assignment';
    const ids = createsAssignment ? [] : [...new Set([asInt(body.assignmentId), ...gridScoreEntries(body).map(row => row.assignmentId)].filter(Boolean))];
    const metadata = createsAssignment || !ids.length || ['update', 'update-assignment'].includes(body.action);
    // Assignment deletion needs every affected score; ordinary score saves only
    // need the submitted students, not every student's existing grade.
    const studentIds = metadata ? null : [...new Set([asInt(body.studentId),
      ...gridScoreEntries(body).map(row => row.studentId), ...scoreFieldEntries(body).map(row => row.studentId)].filter(Boolean))];
    return { kind: 'academic', ids, metadata, studentIds,
      assignments: metadata ? assignments(ids) : [], scores: scores(ids, studentIds),
      lastId: ids.length ? null : querySql('SELECT COALESCE(MAX(id),0) AS id FROM os_assignments')[0].id };
  }

  function record(snapshot, user, requestId) {
    const timestamp = now().toISOString();
    function event(type, before, after, key) {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const row = after || before;
      executeSql(`INSERT INTO os_academic_history (occurred_at,actor_id,actor_name,actor_role,
        request_id,event_type,operation,school_year_id,student_id,assignment_id,record_id,before_json,after_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [timestamp, demoMode ? null : user.id,
        demoMode ? 'Demo' : String(user.name || ''), demoMode ? 'Demo' : String(user.role || ''),
        requestId, type, !before ? 'create' : !after ? 'delete' : 'update', row.school_year_id,
        row.student_id || null, type === 'assignment' ? row.id : row.assignment_id || null,
        key || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
    }
    function compare(type, previous, current, keyFor) {
      const oldRows = new Map(previous.map(row => [keyFor(row), row]));
      const newRows = new Map(current.map(row => [keyFor(row), row]));
      for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
        const before = oldRows.get(key) || null, after = newRows.get(key) || null;
        event(type, before, after, type === 'score' ? null : key);
      }
    }
    if (snapshot.kind === 'attendance') {
      for (const row of querySql('SELECT * FROM os_absences WHERE id>? ORDER BY id', [snapshot.lastId])) event('attendance', null, row, row.id);
      return;
    }
    const ids = snapshot.lastId === null ? snapshot.ids
      : querySql('SELECT id FROM os_assignments WHERE id>? ORDER BY id', [snapshot.lastId]).map(row => row.id);
    if (snapshot.metadata) compare('assignment', snapshot.assignments, assignments(ids), row => row.id);
    compare('score', snapshot.scores, scores(ids, snapshot.studentIds), row => `${row.assignment_id}:${row.student_id}`);
  }
  return { capture, record };
}
module.exports = { createAcademicHistory };
