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
  scoreFieldEntries
};
