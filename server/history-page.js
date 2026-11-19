const { esc } = require('./input');
const { addDays, cleanDate } = require('./dates');

const { references, resolveHistoryNames, parseHistoryValues, historyName } = require('./history-names');

function describeValues(json, values, names) {
  if (!json) return '—';
  if (!values) return '<span>Details unavailable</span>';
  const labels = { grade_level: 'Grade', assignment_date: 'Assignment date',
    max_score: 'Possible points', score: 'Earned points', absence_date: 'Attendance date', created_at: 'Created at' };
  return Object.entries(values).filter(([key]) => key !== 'id' && key !== '_names').map(([key, value]) => {
    const reference = Object.hasOwn(references, key);
    const label = reference ? references[key][0] : labels[key] || key.replaceAll('_', ' ');
    const display = reference && value != null ? historyName(values, key, names) || 'Name unavailable' : value ?? '—';
    return `<div><strong>${esc(label)}:</strong> ${esc(display)}</div>`;
  }).join('');
}

function describeChange(row, values, names) {
  return ['school_year_id', 'student_id', 'assignment_id'].filter(key => values[key] != null).map(key => {
    const name = key === 'assignment_id' && row.event_type === 'assignment' ? values.title : historyName(values, key, names);
    return `${references[key][0]}: ${esc(name || 'Name unavailable')}`;
  }).join(' · ');
}

function historyPage(querySql, url) {
  const clauses = [], parameters = [];
  const filters = url.searchParams;
  for (const [field, column] of [['yearId', 'school_year_id'], ['studentId', 'student_id'],
    ['assignmentId', 'assignment_id'], ['actorId', 'actor_id'], ['before', 'id']]) {
    const value = filters.get(field);
    if (!value) continue;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
      throw Object.assign(new Error('History IDs must be positive whole numbers.'), { statusCode: 400 });
    }
    clauses.push(`${column}${field === 'before' ? '<' : '='}?`);
    parameters.push(Number(value));
  }
  const eventType = filters.get('eventType');
  if (eventType) {
    if (!['score', 'assignment', 'attendance'].includes(eventType)) throw Object.assign(new Error('Choose a supported history event type.'), { statusCode: 400 });
    clauses.push('event_type=?'); parameters.push(eventType);
  }
  for (const field of ['from', 'to']) {
    const value = filters.get(field);
    if (!value) continue;
    if (!cleanDate(value)) throw Object.assign(new Error('Enter a valid history date.'), { statusCode: 400 });
    clauses.push(`occurred_at${field === 'from' ? '>=' : '<'}?`);
    parameters.push(`${field === 'from' ? value : addDays(value, 1)}T00:00:00.000Z`);
  }
  if (filters.get('from') && filters.get('to') && filters.get('from') > filters.get('to')) {
    throw Object.assign(new Error('The history end date must follow the start date.'), { statusCode: 400 });
  }
  const rows = querySql(`SELECT * FROM os_academic_history ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 51`, parameters);
  const page = rows.slice(0, 50).map(row => {
    const before = parseHistoryValues(row.before_json);
    const after = parseHistoryValues(row.after_json);
    return { row, before, after, summary: { ...row, ...(after || before) } };
  });
  const names = resolveHistoryNames(querySql, page.flatMap(({ before, after, summary }) =>
    [before, after, summary].filter(Boolean)), { useDeletedAssignments: true });
  const next = new URLSearchParams(filters);
  if (page.length) next.set('before', page.at(-1).row.id);
  const input = (label, name, type = 'number') => `<label>${label}<input type="${type}" name="${name}" ${type === 'number' ? 'min="1" step="1"' : ''} value="${esc(filters.get(name) || '')}"></label>`;
  return `<div class="workspace"><h1>Academic History</h1>
    <p>Changes recorded since history was installed. Dates are UTC. This is operational history, not a tamper-proof audit system. Restoring a backup restores its history too; later events remain only in the pre-restore backup.</p>
    <section class="panel"><form method="get" action="/history" class="form-grid two">
      ${input('School year ID', 'yearId')}${input('Student ID', 'studentId')}${input('Assignment ID', 'assignmentId')}${input('Actor ID', 'actorId')}
      ${input('From date (UTC)', 'from', 'date')}${input('Through date (UTC)', 'to', 'date')}
      <label>Event type<select name="eventType"><option value="">All events</option>${['score', 'assignment', 'attendance'].map(type => `<option value="${type}" ${type === eventType ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
      <div><button type="submit">Filter history</button> <a href="/history">Clear filters</a></div>
    </form></section>
    <section class="panel"><h2>Recorded changes</h2>${page.length ? `<div class="table-wrap"><table><thead><tr><th>When / who</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>${page.map(({ row, before, after, summary }) => `<tr>
      <td>${esc(row.occurred_at)}<br>${esc(row.actor_name)} (${esc(row.actor_role)})<br>Request ${esc(row.request_id)}</td>
      <td>${esc(row.event_type)} ${esc(row.operation)}<br>${describeChange(row, summary, names)}</td>
      <td>${describeValues(row.before_json, before, names)}</td>
      <td>${describeValues(row.after_json, after, names)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="notice">No changes match these filters.</p>'}
      ${rows.length > 50 ? `<a class="secondary-btn" href="/history?${esc(next.toString())}">Older changes</a>` : ''}
    </section></div>`;
}
module.exports = { historyPage };
