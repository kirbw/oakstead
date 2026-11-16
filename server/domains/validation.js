function formRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Expected form fields.'), { statusCode: 400 });
  }
  return value;
}
module.exports = { formRecord };
