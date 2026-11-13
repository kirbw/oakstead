const { asInt, sqlValue, normalizeCategory } = require('./input');
const { numericValue, average } = require('./averages');

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

function rowInPeriod(row, period) {
  if (!period) return true;
  if (asInt(row.marking_period_id) === asInt(period.id)) return true;
  return Boolean(!row.marking_period_id && period.start_date && period.end_date && row.assignment_date
    && row.assignment_date >= period.start_date && row.assignment_date <= period.end_date);
}

function assignmentPeriodClause(period) {
  if (!period) return '';
  const idClause = `a.marking_period_id=${asInt(period.id)}`;
  if (!period.start_date || !period.end_date) return `AND ${idClause}`;
  return `AND (${idClause} OR (a.marking_period_id IS NULL AND a.assignment_date >= ${sqlValue(period.start_date)} AND a.assignment_date <= ${sqlValue(period.end_date)}))`;
}

function accumulator() { return { sum: 0, count: 0, categories: new Map() }; }

function addScore(total, percent, category) {
  total.sum += percent;
  total.count++;
  let part = total.categories.get(category);
  if (!part) { part = { sum: 0, count: 0 }; total.categories.set(category, part); }
  part.sum += percent;
  part.count++;
}

function finishAverage(total, group, items) {
  if (!total?.count) return { average: null, breakdown: [] };
  const straight = total.sum / total.count;
  if (!group || group.calculation_mode === 'straight') return { average: Math.round(straight), breakdown: [] };
  let weightedTotal = 0, usedWeight = 0;
  const breakdown = [];
  for (const item of items) {
    const category = normalizeCategory(item.category);
    const part = total.categories.get(category);
    if (!part?.count) continue;
    const categoryAverage = part.sum / part.count;
    const weight = Number(item.weight) || 0;
    weightedTotal += categoryAverage * weight;
    usedWeight += weight;
    breakdown.push(`${category} ${Math.round(categoryAverage)}% x ${weight}%`);
  }
  if (!usedWeight) return { average: Math.round(straight), breakdown: [] };
  const raw = weightedTotal / usedWeight;
  return { average: group.rounding_mode === 'round-up' ? Math.floor(raw + 0.5) : Math.round(raw), breakdown };
}

function calculateWeightedAverage(scores, group, allItems) {
  const total = accumulator();
  for (const row of scores) {
    const percent = numericValue(row.percent);
    if (percent !== null) addScore(total, percent, normalizeCategory(row.category));
  }
  return finishAverage(total, group, group ? allItems.filter((item) => item.group_id === group.id) : []);
}

function summarizeGradeRows(scoreRows, { grade, subjectIds, studentIds, periods, weightGroups, weightItems }) {
  const students = new Set(studentIds.map((id) => asInt(id)));
  const subjects = new Set(subjectIds.map((id) => asInt(id)));
  const periodsById = new Map(periods.map((period) => [asInt(period.id), period]));
  const totals = new Map();
  const itemsByGroup = new Map();
  for (const item of weightItems) {
    if (!itemsByGroup.has(item.group_id)) itemsByGroup.set(item.group_id, []);
    itemsByGroup.get(item.group_id).push(item);
  }
  for (const row of scoreRows) {
    const percent = numericValue(row.percent);
    const studentId = asInt(row.student_id), subjectId = asInt(row.subject_id);
    if (percent === null || !students.has(studentId) || !subjects.has(subjectId)) continue;
    const category = normalizeCategory(row.category);
    const matchingPeriods = row.marking_period_id
      ? [periodsById.get(asInt(row.marking_period_id))].filter(Boolean)
      : periods.filter((period) => rowInPeriod(row, period));
    for (const period of matchingPeriods) {
      const key = `${subjectId}:${asInt(period.id)}`;
      if (!totals.has(key)) totals.set(key, new Map());
      const byStudent = totals.get(key);
      if (!byStudent.has(studentId)) byStudent.set(studentId, accumulator());
      addScore(byStudent.get(studentId), percent, category);
    }
  }
  const results = new Map();
  for (const subjectId of subjects) {
    const group = matchingWeightGroup(weightGroups, grade, subjectId);
    const items = itemsByGroup.get(group?.id) || [];
    for (const period of periods) {
      const key = `${subjectId}:${asInt(period.id)}`;
      const studentAverages = new Map();
      for (const studentId of students) {
        studentAverages.set(studentId, finishAverage(totals.get(key)?.get(studentId), group, items).average);
      }
      results.set(key, { classAverage: average([...studentAverages.values()]), studentAverages });
    }
  }
  return { get: (subjectId, period) => results.get(`${asInt(subjectId)}:${asInt(period?.id)}`)
    || { classAverage: null, studentAverages: new Map() } };
}

function loadGradeWeights(query, yearId) {
  return {
    weightGroups: query(`SELECT * FROM os_grade_weight_groups WHERE school_year_id=${asInt(yearId)};`),
    weightItems: query(`SELECT wi.* FROM os_grade_weight_items wi JOIN os_grade_weight_groups wg ON wg.id=wi.group_id WHERE wg.school_year_id=${asInt(yearId)};`)
  };
}

function loadGradeAverages(query, { yearId, grade, subjectIds, studentIds, periods, settings }) {
  if (!grade || !subjectIds.length || !studentIds.length || !periods.length) {
    return { get: () => ({ classAverage: null, studentAverages: new Map() }) };
  }
  const scoreRows = query(`SELECT sc.student_id, a.subject_id, a.category, a.assignment_date, a.marking_period_id,
      ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
    FROM os_assignments a JOIN os_scores sc ON sc.assignment_id=a.id
    WHERE a.school_year_id=${asInt(yearId)} AND a.grade_level=${sqlValue(grade)}
      AND a.subject_id IN (${subjectIds.map((id) => asInt(id)).join(',')})
      AND sc.student_id IN (${studentIds.map((id) => asInt(id)).join(',')})
      ${periods.length === 1 && asInt(periods[0].id) ? assignmentPeriodClause(periods[0]) : ''};`);
  return summarizeGradeRows(scoreRows, { grade, subjectIds, studentIds, periods, ...(settings || loadGradeWeights(query, yearId)) });
}

module.exports = { gradeRank, matchingWeightGroup, rowInPeriod, assignmentPeriodClause,
  calculateWeightedAverage, summarizeGradeRows, loadGradeWeights, loadGradeAverages };
