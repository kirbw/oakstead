const DAY_MS = 86400000;

function cleanDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000-')) return '';
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}

function addDays(value, days) {
  const text = cleanDate(value);
  if (!text || !Number.isInteger(days)) return '';
  const date = new Date(`${text}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isFinite(date.getTime()) ? cleanDate(date.toISOString().slice(0, 10)) : '';
}

function daysBetween(startValue, endValue) {
  const start = cleanDate(startValue), end = cleanDate(endValue);
  if (!start || !end || end < start) return 0;
  return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS + 1;
}

function schoolDateRange(startValue, endValue) {
  const startDate = cleanDate(startValue), endDate = cleanDate(endValue);
  if ((String(startValue ?? '').trim() && !startDate) || (String(endValue ?? '').trim() && !endDate)) {
    throw Object.assign(new Error('Enter valid school-year dates in YYYY-MM-DD format.'), { statusCode: 400 });
  }
  if (startDate && endDate && startDate > endDate) {
    throw Object.assign(new Error('The school-year end date must be on or after its start date.'), { statusCode: 400 });
  }
  return { startDate, endDate };
}

module.exports = { addDays, cleanDate, daysBetween, schoolDateRange };
