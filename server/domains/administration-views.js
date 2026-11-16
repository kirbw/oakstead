function createViews({
  KPI_ICONS,
  ROLE_ADMIN,
  ROLE_TEACHER,
  actionPanel,
  asInt,
  assignmentAccessClause,
  csrfInput,
  displayCategoryShort,
  emptyState,
  esc,
  formatPercent,
  gradeTone,
  isTeacher,
  querySql,
  recentSchoolDays,
  roleLabel,
  schoolYearHead,
  sqlValue,
  studentAccessClause,
  weeklyAverageChart,
}) {
  function dashboardPage(selectedYear, user) {
    const yearId = asInt(selectedYear.id);
    const teacher = isTeacher(user);
    const studentScope = `FROM os_students st JOIN os_student_years sy ON sy.student_id=st.id
      WHERE sy.school_year_id=${yearId} AND sy.status='enrolled' ${studentAccessClause(user, yearId)}`;
    const roomScope = `WHERE school_year_id=${yearId} ${teacher ? `AND teacher_id=${asInt(user.teacher_id)}` : ''}`;
    const assignmentScope = assignmentAccessClause(user, yearId);
    const scoreScope = teacher ? `AND sc.student_id IN (SELECT st.id ${studentScope})` : '';
    const kpis = {
      families: querySql(teacher ? `SELECT COUNT(DISTINCT st.family_id) AS c ${studentScope};` : 'SELECT COUNT(*) AS c FROM os_families;')[0]?.c || 0,
      students: querySql(`SELECT COUNT(*) AS c ${studentScope};`)[0]?.c || 0,
      teachers: querySql(teacher ? `SELECT COUNT(DISTINCT teacher_id) AS c FROM os_classrooms ${roomScope};` : 'SELECT COUNT(*) AS c FROM os_teachers;')[0]?.c || 0,
      classrooms: querySql(`SELECT COUNT(*) AS c FROM os_classrooms ${roomScope};`)[0]?.c || 0,
      assignments: querySql(`SELECT COUNT(*) AS c FROM os_assignments a WHERE a.school_year_id=${yearId} ${assignmentScope};`)[0]?.c || 0
    };
    // Limit the authorized assignments before touching their scores. Aggregating
    // every historical assignment just to display eight rows blocks other requests.
    const recent = querySql(`WITH recent_assignments AS MATERIALIZED (
        SELECT a.*, s.name AS subject_name
        FROM os_assignments a JOIN os_subjects s ON s.id=a.subject_id
        WHERE a.school_year_id=${yearId} ${assignmentScope}
        ORDER BY a.assignment_date DESC, a.id DESC LIMIT 8
      ) SELECT a.title, a.category, a.grade_level, a.subject_name,
        COUNT(sc.id) AS scores, ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
      FROM recent_assignments a
      LEFT JOIN os_scores sc ON sc.assignment_id = a.id ${scoreScope}
      GROUP BY a.id
      ORDER BY a.assignment_date DESC, a.id DESC
      LIMIT 8;`);
    const schoolDays = recentSchoolDays(7);
    const weekData = querySql(`SELECT DATE(a.assignment_date) AS day,
        ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
      FROM os_assignments a
      JOIN os_scores sc ON sc.assignment_id = a.id ${scoreScope}
      WHERE a.school_year_id=${yearId} ${assignmentScope}
        AND DATE(a.assignment_date) IN (${schoolDays.map((day) => sqlValue(day.key)).join(', ')})
      GROUP BY DATE(a.assignment_date)
      ORDER BY day ASC;`);
    const chart = weeklyAverageChart(weekData, schoolDays);
    const overallLabel = chart.overallAvg !== null ? `${Number(chart.overallAvg).toFixed(1)}% school-day avg` : 'No school-day data';

    return `<div class="workspace">
      ${schoolYearHead('Dashboard', 'A compact working view for enrollment, classrooms, and grades.', selectedYear)}
      <section class="kpis">
        <article class="kpi"><div class="kpi-head"><span>Families</span><div class="kpi-icon">${KPI_ICONS.families}</div></div><strong>${kpis.families}</strong></article>
        <article class="kpi"><div class="kpi-head"><span>Students</span><div class="kpi-icon">${KPI_ICONS.students}</div></div><strong>${kpis.students}</strong></article>
        <article class="kpi"><div class="kpi-head"><span>Teachers</span><div class="kpi-icon">${KPI_ICONS.teachers}</div></div><strong>${kpis.teachers}</strong></article>
        <article class="kpi"><div class="kpi-head"><span>Classrooms</span><div class="kpi-icon">${KPI_ICONS.classrooms}</div></div><strong>${kpis.classrooms}</strong></article>
        <article class="kpi"><div class="kpi-head"><span>Assignments</span><div class="kpi-icon">${KPI_ICONS.assignments}</div></div><strong>${kpis.assignments}</strong></article>
      </section>
      <div class="split dashboard-split">
        <section class="chart-panel">
          <div class="chart-head"><h2>${teacher ? 'Your Classes' : 'School'} Average &mdash; Past 7 School Days</h2><span>${overallLabel}</span></div>
          ${chart.svg}
        </section>
        <section class="ledger">
          <div class="ledger-head"><h2>Recent Gradebook Entries</h2><p>Newest lessons, quizzes, and tests in this school year.</p></div>
          <div class="table-wrap compact-table dashboard-recent" tabindex="0" role="region" aria-label="Recent gradebook entries"><table>
            <tr><th>Assignment</th><th>Type</th><th>Gr.</th><th>Subject</th><th>Avg</th></tr>
            ${recent.map((row) => `<tr>
              <td>${esc(row.title)}</td>
              <td><span class="type-chip">${displayCategoryShort(row.category)}</span></td>
              <td>${esc(row.grade_level)}</td>
              <td>${esc(row.subject_name)}</td>
              <td><span class="badge ${gradeTone(row.avg_score)}">${formatPercent(row.avg_score)}</span></td>
            </tr>`).join('') || `<tr><td colspan="5">${emptyState('No grades have been entered for this year yet.')}</td></tr>`}
          </table></div>
        </section>
      </div>
    </div>`;
  }

  function usersPage(csrfToken) {
    const users = querySql(`SELECT u.id, u.name, u.username, u.role, t.name AS teacher_name
      FROM os_users u
      LEFT JOIN os_teachers t ON t.id = u.teacher_id
      ORDER BY u.name;`);
    const teachers = querySql('SELECT id, name FROM os_teachers ORDER BY name;');
    const teacherOptions = teachers.map((teacher) => `<option value="${teacher.id}">${esc(teacher.name)}</option>`).join('');
    return `<div class="workspace">
      <header class="page-head"><div class="page-head-copy"><h1>Users</h1><p>Create administrator and teacher sign-ins.</p></div></header>
      <div class="split">
        ${actionPanel('Create User', `<form method="post" action="/users" class="form-grid two">
          ${csrfInput(csrfToken)}
          <label>Name<input name="name" required maxlength="120" /></label>
          <label>Username<input name="username" required maxlength="80" /></label>
          <label>Role<select name="role"><option value="${ROLE_ADMIN}">Admin</option><option value="${ROLE_TEACHER}">Teacher</option></select></label>
          <label>Teacher Link<select name="teacherId"><option value="">None</option>${teacherOptions}</select></label>
          <label>Password<input type="password" name="password" required maxlength="120" /></label>
          <button type="submit">Create User</button>
        </form>`)}
        <section class="ledger">
          <div class="ledger-head"><h2>Current Users</h2><p>Teacher users can enter grades for classrooms linked to their teacher record.</p></div>
          <div class="table-wrap compact-table"><table>
            <tr><th>Name</th><th>Username</th><th>Role</th><th>Teacher</th></tr>
            ${users.map((user) => `<tr><td>${esc(user.name)}</td><td>${esc(user.username)}</td><td>${roleLabel(user.role)}</td><td>${esc(user.teacher_name || '') || '&mdash;'}</td></tr>`).join('')}
          </table></div>
        </section>
      </div>
    </div>`;
  }

  return { dashboardPage, usersPage };
}
module.exports = { createViews };
