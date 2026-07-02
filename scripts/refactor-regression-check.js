const assert = require('assert');

const {
  cleanBindHost,
  cleanUpdateMode,
  normalizeRepositorySlug,
  parsePort
} = require('../server/config');
const {
  asPoints,
  cleanScoreMode,
  esc,
  normalizeCategory,
  scoreInputToPoints,
  scoreValueForMode,
  sqlValue
} = require('../server/input');
const {
  gradebookRedirectUrl,
  gridScoreEntries,
  scoreFieldEntries
} = require('../server/gradebook-utils');

assert.strictEqual(parsePort('3001'), 3001);
assert.strictEqual(parsePort('bad', 3000), 3000);
assert.strictEqual(parsePort('70000', 3000), 3000);
assert.strictEqual(cleanBindHost('0.0.0.0'), '0.0.0.0');
assert.strictEqual(cleanBindHost('not a host', '127.0.0.1'), '127.0.0.1');
assert.strictEqual(cleanUpdateMode('installer'), 'installer');
assert.strictEqual(cleanUpdateMode('anything'), 'git');
assert.strictEqual(normalizeRepositorySlug('https://github.com/kirbw/oakstead.git'), 'kirbw/oakstead');

assert.strictEqual(esc('<Oakstead & "friends">'), '&lt;Oakstead &amp; &quot;friends&quot;&gt;');
assert.strictEqual(sqlValue("O'Connor"), "'O''Connor'");
assert.strictEqual(sqlValue(''), 'NULL');
assert.strictEqual(asPoints('0'), 100);
assert.strictEqual(cleanScoreMode('wrong'), 'wrong');
assert.strictEqual(cleanScoreMode('percent'), 'percent');
assert.strictEqual(scoreInputToPoints('88', 'percent', 50), 44);
assert.strictEqual(scoreInputToPoints('2', 'wrong', 20), 18);
assert.strictEqual(scoreValueForMode(18, 20, 'percent'), '90');
assert.strictEqual(scoreValueForMode(18, 20, 'wrong'), '2');
assert.strictEqual(normalizeCategory('quizzes'), 'Quiz');
assert.strictEqual(normalizeCategory('lesson/homework'), 'Lesson / Homework');

assert.strictEqual(
  gradebookRedirectUrl({
    schoolYearId: 2,
    markingPeriodId: 6,
    gradeLevel: '1',
    subjectId: 4,
    scoreMode: 'wrong',
    assignmentId: 9,
    gridMode: 'on'
  }),
  '/gradebook?yearId=2&markingPeriodId=6&grade=1&subjectId=4&mode=wrong&assignmentId=9&grid=on'
);
assert.strictEqual(
  gradebookRedirectUrl({
    schoolYearId: 2,
    gradeLevel: 'Grade 1',
    subjectId: 4,
    scoreMode: 'percent'
  }),
  '/gradebook?yearId=2&grade=Grade%201&subjectId=4&mode=percent'
);

const scoreBody = {
  score_01: '95',
  score_2: '88',
  score_3_extra: '70',
  notes: 'ignored'
};
assert.deepStrictEqual(scoreFieldEntries(scoreBody), [
  { key: 'score_01', studentId: 1 },
  { key: 'score_2', studentId: 2 }
]);

const gridBody = {
  gridscore_4_5: '90',
  gridscore_7_8: '2',
  gridscore_nope_8: '0'
};
assert.deepStrictEqual(gridScoreEntries(gridBody), [
  { key: 'gridscore_4_5', assignmentId: 4, studentId: 5 },
  { key: 'gridscore_7_8', assignmentId: 7, studentId: 8 }
]);

console.log('Refactor regression checks passed.');
