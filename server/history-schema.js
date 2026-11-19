// Deliberately no foreign keys: deleting a source record must retain its history.
const HISTORY_SCHEMA_SQL = `CREATE TABLE os_academic_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  school_year_id INTEGER,
  student_id INTEGER,
  assignment_id INTEGER,
  record_id INTEGER,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX os_history_year_id ON os_academic_history(school_year_id, id);
CREATE INDEX os_history_student_id ON os_academic_history(student_id, id);
CREATE INDEX os_history_assignment_id ON os_academic_history(assignment_id, id);`;
module.exports = { HISTORY_SCHEMA_SQL };
