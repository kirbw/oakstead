// Frozen pre-optimization implementation from f7ceef41, used only for parity and benchmarks.
const { asInt, sqlValue, normalizeCategory } = require('../../server/input');
const { average, numericValues } = require('../../server/averages');

module.exports = function baselineGrades(querySql) {
function gradeRank(grade) {
  const text = String(grade);
  if (/^pre-?k$/i.test(text)) return -2;
  if (/^k(indergarten)?$/i.test(text)) return -1;
  const number = Number(text);
  return Number.isFinite(number) ? number : 100 + text.toLowerCase().charCodeAt(0);
}


function matchingWeightGroup(groups, grade, subjectId) {
  const rank = gradeRank(grade);
  return groups.find((group) => group.subject_id === subjectId && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || groups.find((group) => !group.subject_id && rank >= gradeRank(group.min_grade) && rank <= gradeRank(group.max_grade))
    || null;
}


function calculateWeightedAverage(scores, group, allItems) {
  const percentages = numericValues(scores.map((row) => row.percent));
  if (!percentages.length) return { average: null, breakdown: [] };
  const straight = average(percentages);
  if (!group || group.calculation_mode === 'straight') return { average: Math.round(straight), breakdown: [] };
  const items = allItems.filter((item) => item.group_id === group.id);
  let weightedTotal = 0;
  let usedWeight = 0;
  const breakdown = [];
  items.forEach((item) => {
    const categoryScores = numericValues(scores.filter((row) => normalizeCategory(row.category) === normalizeCategory(item.category)).map((row) => row.percent));
    if (!categoryScores.length) return;
    const categoryAverage = average(categoryScores);
    const weight = Number(item.weight) || 0;
    weightedTotal += categoryAverage * weight;
    usedWeight += weight;
    breakdown.push(`${normalizeCategory(item.category)} ${Math.round(categoryAverage)}% x ${weight}%`);
  });
  if (!usedWeight) return { average: Math.round(straight), breakdown: [] };
  const raw = weightedTotal / usedWeight;
  return { average: group.rounding_mode === 'round-up' ? Math.floor(raw + 0.5) : Math.round(raw), breakdown };
}


function rowInPeriod(row, period) {
  if (!period) return true;
  if (asInt(row.marking_period_id) === asInt(period.id)) return true;
  if (!row.marking_period_id && period.start_date && period.end_date && row.assignment_date) {
    return row.assignment_date >= period.start_date && row.assignment_date <= period.end_date;
  }
  return false;
}


function periodAverageRows(yearId, grade, subjectId, studentIds, period) {
  if (!grade || !subjectId || !studentIds.length || !period) return { classAverage: null, studentAverages: new Map() };
  const scoreRows = querySql(`SELECT sc.student_id, a.category, a.assignment_date, a.marking_period_id,
      ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
    FROM os_scores sc
    JOIN os_assignments a ON a.id = sc.assignment_id
    WHERE a.school_year_id=${yearId}
      AND a.grade_level=${sqlValue(grade)}
      AND a.subject_id=${subjectId}
      AND sc.student_id IN (${studentIds.map(asInt).join(',')});`);
  const weightGroups = querySql(`SELECT * FROM os_grade_weight_groups WHERE school_year_id=${yearId};`);
  const weightItems = querySql(`SELECT wi.* FROM os_grade_weight_items wi
    JOIN os_grade_weight_groups wg ON wg.id = wi.group_id
    WHERE wg.school_year_id=${yearId};`);
  const group = matchingWeightGroup(weightGroups, grade, subjectId);
  const studentAverages = new Map();
  studentIds.forEach((studentId) => {
    const rows = scoreRows.filter((row) => asInt(row.student_id) === asInt(studentId) && rowInPeriod(row, period));
    studentAverages.set(asInt(studentId), calculateWeightedAverage(rows, group, weightItems).average);
  });
  return {
    classAverage: average([...studentAverages.values()]),
    studentAverages
  };
}

return {periodAverageRows,calculateWeightedAverage};
};
