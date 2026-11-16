// Domain operations return values; only the route adapter writes HTTP responses.
const text = (status, body, headers = {}) => ({ kind: 'text', status, body, headers });
const json = (status, body, headers = {}) => ({ kind: 'json', status, body, headers });
const redirectTo = (location, headers = {}) => ({ kind: 'redirect', status: 302, location, headers });
module.exports = { text, json, redirectTo };
