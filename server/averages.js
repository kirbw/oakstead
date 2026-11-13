function numericValue(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericValues(values) {
  return values.map(numericValue).filter((value) => value !== null);
}

function average(values) {
  const numeric = numericValues(values);
  return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null;
}

module.exports = { numericValue, numericValues, average };
