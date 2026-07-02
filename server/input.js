function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function cleanText(value, max = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanDate(value) {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanGrade(value) {
  return cleanText(value, 24);
}

function asScore(value) {
  if (String(value ?? '').trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1000, parsed));
}

function asPoints(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(10000, parsed));
}

function cleanScoreMode(value) {
  return value === 'wrong' ? 'wrong' : 'percent';
}

function compactNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  return parsed.toFixed(2).replace(/\.?0+$/, '');
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function scoreInputToPoints(value, mode, maxScore) {
  if (String(value ?? '').trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const points = asPoints(maxScore);
  if (cleanScoreMode(mode) === 'percent') {
    const percent = Math.max(0, Math.min(100, parsed));
    return Number(((percent / 100) * points).toFixed(2));
  }
  const wrong = Math.max(0, Math.min(points, parsed));
  return Number((points - wrong).toFixed(2));
}

function scoreValueForMode(score, maxScore, mode) {
  if (score === null || score === undefined || score === '') return '';
  const earned = Number(score);
  const points = asPoints(maxScore);
  if (!Number.isFinite(earned)) return '';
  if (cleanScoreMode(mode) === 'percent') return compactNumber((earned / points) * 100);
  return compactNumber(Math.max(0, points - earned));
}

function normalizeCategory(value) {
  const text = cleanText(value, 40).toLowerCase();
  if (text === 'lesson' || text === 'homework' || text === 'lesson / homework' || text === 'lesson/homework') return 'Lesson / Homework';
  if (text === 'quiz' || text === 'quizzes') return 'Quiz';
  if (text === 'test' || text === 'tests') return 'Test';
  return cleanText(value, 40) || 'Lesson / Homework';
}

module.exports = {
  asInt,
  asPoints,
  asScore,
  cleanDate,
  cleanGrade,
  cleanScoreMode,
  cleanText,
  compactNumber,
  esc,
  formatFileSize,
  normalizeCategory,
  scoreInputToPoints,
  scoreValueForMode,
  sqlValue
};
