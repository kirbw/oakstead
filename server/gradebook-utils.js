const { parseScoreInput } = require('./input');

function parseScoreChanges(body, entries, mode, maxScoreFor) {
  return entries.map((entry) => {
    const change = parseScoreInput(body[entry.key], mode, maxScoreFor(entry));
    if (change.kind === 'invalid') {
      throw Object.assign(new Error('Invalid score. Enter a number or leave the field blank to clear it.'), {
        statusCode: 400, fields: { [entry.key]: 'Enter a number, or leave blank to clear the score.' }
      });
    }
    return { ...entry, ...change };
  });
}

function scoreWriteStatements(changes, fallbackAssignmentId) {
  return changes.flatMap(({ assignmentId = fallbackAssignmentId, studentId, kind, score }) => {
    if (kind === 'unchanged') return [];
    if (kind === 'delete') return [`DELETE FROM os_scores WHERE assignment_id=${assignmentId} AND student_id=${studentId}`];
    return [`INSERT INTO os_scores (assignment_id, student_id, score) VALUES (${assignmentId}, ${studentId}, ${score})
      ON CONFLICT(assignment_id, student_id) DO UPDATE SET score=excluded.score`];
  });
}

function gradebookRedirectUrl({
  assignmentId = 0,
  gradeLevel,
  gridMode = '',
  markingPeriodId = 0,
  schoolYearId,
  scoreMode,
  subjectId
}) {
  const params = [
    `yearId=${schoolYearId}`,
    markingPeriodId ? `markingPeriodId=${markingPeriodId}` : '',
    `grade=${encodeURIComponent(gradeLevel)}`,
    `subjectId=${subjectId}`,
    `mode=${scoreMode}`,
    assignmentId ? `assignmentId=${assignmentId}` : '',
    gridMode === 'on' ? 'grid=on' : ''
  ].filter(Boolean);
  return `/gradebook?${params.join('&')}`;
}

function gridScoreEntries(body) {
  return Object.keys(body)
    .map((key) => {
      const match = key.match(/^gridscore_(\d+)_(\d+)$/);
      if (!match) return null;
      return {
        key,
        assignmentId: Number.parseInt(match[1], 10),
        studentId: Number.parseInt(match[2], 10)
      };
    })
    .filter(Boolean);
}

function scoreFieldEntries(body, prefix = 'score_') {
  return Object.keys(body)
    .map((key) => {
      if (!key.startsWith(prefix)) return null;
      const studentId = Number(key.slice(prefix.length));
      return Number.isInteger(studentId) && studentId > 0 ? { key, studentId } : null;
    })
    .filter(Boolean);
}

module.exports = {
  gradebookRedirectUrl,
  gridScoreEntries,
  parseScoreChanges,
  scoreWriteStatements,
  scoreFieldEntries
};
