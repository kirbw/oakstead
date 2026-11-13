// Both ISO expiry strings and SQLite timestamps are normalized before comparison.
// COALESCE makes unparseable timestamps expired for authentication and cleanup.
const SESSION_VALID_SQL = "COALESCE(julianday(expires_at) > julianday('now'), 0)";

module.exports = { SESSION_VALID_SQL };
