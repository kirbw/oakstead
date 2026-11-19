const { sqlParameter } = require('../input');
const ui = require('../ui');

function createViews({
  DEFAULT_LETTER_GRADES,
  ROLE_TEACHER,
  absenceKindClass,
  appSettings,
  asInt,
  asPoints,
  assignmentAccessClause,
  assignmentPeriodClause,
  authorizedAssignments,
  average,
  boardTermLabel,
  canAccessSetup,
  categoryOptions,
  cleanGrade,
  cleanScoreMode,
  cleanText,
  compactNumber,
  csrfInput,
  displayCategoryShort,
  emptyState,
  esc,
  familyReportName,
  formatAbsence,
  formatAbsenceAmount,
  formatAbsenceKind,
  formatDateNumeric,
  formatPercent,
  gradeOptionsFromRows,
  gradeRank,
  gradeTone,
  gradebookCategoryClass,
  gradebookDisplayScore,
  gradebookLetter,
  gradebookTitle,
  graphColor,
  gridModeToggle,
  letterGradeScale,
  loadGradeAverages,
  loadGradeWeights,
  miniSubjectChartSvg,
  monthName,
  normalizeCategory,
  numericValues,
  parseCookies,
  path,
  periodAbsenceTotal,
  periodAverageRows,
  printReportHead,
  querySql,
  reportCardBooksSvg,
  reportDefinitions,
  reportMeterStyle,
  reportsNav,
  schoolYearHead,
  scoreInputControl,
  scoreModeToggle,
  scoreValueForMode,
  selectedPeriodFromRequest,
  sortGrades,
  studentAccessClause,
  studentDisplayName,
  studentLastFirst,
  summarizeGradeRows,
  teacherAllowedForSelection,
  teacherStudentClause,
}) {
  function gradebookGridView({
    selectedYear,
    yearId,
    periods,
    selectedPeriodId,
    selectedGrade,
    selectedSubjectId,
    scoreMode,
    allGrades,
    subjects,
    subject,
    allowed,
    students,
    assignments,
    averageData,
    letterScale,
    classAverageBlock,
    csrfToken
  }) {
    const gridAssignments = [...assignments].sort((a, b) => {
      const dateCompare = String(a.assignment_date || '').localeCompare(String(b.assignment_date || ''));
      return dateCompare || Number(a.id) - Number(b.id);
    });
    const assignmentIds = gridAssignments.map((assignment) => asInt(assignment.id)).filter(Boolean);
    const studentIds = students.map((student) => asInt(student.id)).filter(Boolean);
    const scoreRows = assignmentIds.length && studentIds.length
      ? querySql(`SELECT sc.assignment_id, sc.student_id, sc.score,
          ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
        FROM os_scores sc
        JOIN os_assignments a ON a.id = sc.assignment_id
        WHERE sc.assignment_id IN (${assignmentIds.map(() => '?').join(',')})
          AND sc.student_id IN (${studentIds.map(() => '?').join(',')});`, [...assignmentIds, ...studentIds])
      : [];
    const scoresByCell = new Map(scoreRows.map((row) => [`${asInt(row.assignment_id)}:${asInt(row.student_id)}`, row]));
    const periodSelect = `<select name="markingPeriodId" required data-auto-submit>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.period_number)}</option>`).join('')}</select>`;
    const gradeSelect = `<select name="grade" required data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
    const subjectSelect = `<select name="subjectId" required data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
    const modeSelect = `<select name="mode" data-auto-submit><option value="wrong" ${scoreMode === 'wrong' ? 'selected' : ''}>Errors</option><option value="percent" ${scoreMode === 'percent' ? 'selected' : ''}>Percentages</option></select>`;
    const subjectLabel = subject ? esc(subject.name) : 'Subject';

    const editIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V21h3.75L18.81 9.94l-3.75-3.75L4 17.25Zm16.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0l-1.48 1.48 3.75 3.75 1.65-1.31Z"/></svg>';
    const addIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    const headerOverlayWidth = (gridAssignments.length + 1) * 54;
    const headerLines = Array.from({length: gridAssignments.length + 1}, (_, i) =>
      `<line x1="${i * 54}" y1="96" x2="${i * 54 + 80}" y2="10"></line>`
    ).join('');
    const headerLabels = gridAssignments.map((assignment, index) =>
      `<text transform="translate(${index * 54 + 57} 64) rotate(-47)" text-anchor="middle">${esc(gradebookTitle(assignment.category, assignment.title))}</text>`
    ).join('');
    const headerOverlay = `<svg class="gb-header-svg" viewBox="0 0 ${headerOverlayWidth} 126" aria-hidden="true">${headerLines}${headerLabels}</svg>`;
    const headerCells = gridAssignments.map((assignment, index) => {
      const categoryClass = gradebookCategoryClass(assignment.category);
      return `<th class="gb-grid-assignment gb-type-${categoryClass}" style="--gb-header-z:${gridAssignments.length - index + 10}" title="${esc(assignment.title)}">
      </th>`;
    }).join('');

    const classAverageCells = gridAssignments.map((assignment) => `<td class="gb-grid-average gb-type-${gradebookCategoryClass(assignment.category)}" data-grid-assignment-average="${assignment.id}">${gradebookDisplayScore(assignment.avg_score, letterScale)}</td>`).join('');
    const pointsCells = gridAssignments.map((assignment) => `<td>${compactNumber(assignment.max_score)}</td>`).join('');
    const emptyAssignmentCells = gridAssignments.map(() => '<td></td>').join('');

    const studentRows = students.map((student) => {
      const studentAverage = averageData.studentAverages.get(asInt(student.id));
      const cells = gridAssignments.map((assignment) => {
        const key = `${asInt(assignment.id)}:${asInt(student.id)}`;
        const row = scoresByCell.get(key);
        const displayPercent = row?.percent;
        const value = scoreValueForMode(row?.score, assignment.max_score, scoreMode);
        const categoryClass = gradebookCategoryClass(assignment.category);
        const letter = gradebookLetter(displayPercent, letterScale);
        return `<td class="gb-grid-score-cell gb-type-${categoryClass}">
          <input data-score-input data-grid-score-input data-score-points="${compactNumber(asPoints(assignment.max_score))}" data-score-mode="${scoreMode}" data-assignment-id="${assignment.id}" data-student-id="${student.id}" data-original-value="${esc(value)}" name="gridscore_${assignment.id}_${student.id}" type="number" inputmode="decimal" min="0" max="${scoreMode === 'percent' ? '100' : compactNumber(asPoints(assignment.max_score))}" step="0.01" value="${esc(value)}" aria-label="${esc(student.first_name)} ${esc(student.last_name)} ${esc(assignment.title)}" autocomplete="off" />
          <span class="gb-cell-letter">${esc(letter)}</span>
          <span class="gb-cell-status" data-grid-save-status></span>
        </td>`;
      }).join('');
      return `<tr>
        <th class="gb-grid-student">${esc(student.first_name)} <span data-grid-student-average="${student.id}">${gradebookDisplayScore(studentAverage, letterScale)}</span></th>
        ${cells}
      </tr>`;
    }).join('');

    const assignmentDialogs = gridAssignments.map((assignment) => {
      const category = normalizeCategory(assignment.category);
      return `<dialog class="assignment-dialog" id="assignment-dialog-${assignment.id}">
        <form method="post" action="/gradebook" class="assignment-dialog-form">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="action" value="update-assignment" />
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
          <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
          <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
          <input type="hidden" name="assignmentId" value="${assignment.id}" />
          <input type="hidden" name="scoreMode" value="${scoreMode}" />
          <div class="assignment-dialog-head">
            <span>${editIcon}</span>
            <h3>Edit Assignment</h3>
          </div>
          <div class="assignment-dialog-body">
            <label>Title<input name="title" required maxlength="140" value="${esc(assignment.title)}" /></label>
            <div class="assignment-dialog-grid">
              <label>Type<select name="category">${categoryOptions(assignment.category)}</select></label>
              <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="${compactNumber(assignment.max_score)}" required /></label>
              <label>Date<input type="date" name="assignmentDate" value="${esc(assignment.assignment_date || '')}" /></label>
            </div>
          </div>
          <div class="assignment-dialog-actions">
            <button class="secondary-btn danger-action" type="submit" name="deleteAssignment" value="1">Delete</button>
            <button class="secondary-btn" type="button" data-dialog-close>Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      </dialog>`;
    }).join('');

    let gridBody = '';
    if (!allowed) {
      gridBody = `<div class="panel">${emptyState('This grade is not assigned to your teacher account.')}</div>`;
    } else if (!selectedGrade || !selectedSubjectId) {
      gridBody = `<div class="panel">${emptyState('Select a grade and subject to begin.')}</div>`;
    } else if (!gridAssignments.length) {
      gridBody = `<div class="panel">${emptyState('No assignments found for this period. Switch Grid off to add the first assignment, or use Assignments to create several at once.')}</div>`;
    } else {
      gridBody = `<div class="gb-grid-form" data-grid-autosave data-action="/gradebook">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="action" value="grid-scores" />
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
        <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
        <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
        <input type="hidden" name="scoreMode" value="${scoreMode}" />
        <input type="hidden" name="gridMode" value="on" />
        ${gridAssignments.map((assignment) => `<input type="hidden" name="assignmentMax_${assignment.id}" value="${compactNumber(asPoints(assignment.max_score))}" />`).join('')}
        <div class="gb-grid-scroll">
          <div class="gb-grid-stage" style="--gb-assignment-count:${gridAssignments.length}">
          <div class="gb-grid-header-overlay">${headerOverlay}</div>
          <table class="gb-grid-table">
            <colgroup>
              <col class="gb-grid-student-col" />
              ${gridAssignments.map(() => '<col class="gb-grid-score-col" />').join('')}
            </colgroup>
            <thead>
              <tr class="gb-grid-top-row">
                <th class="gb-grid-year" rowspan="2">
                  <button class="gb-grid-add-btn" type="button" data-dialog-target="add-assignment-dialog" title="Add assignment" aria-label="Add assignment">+</button>
                </th>
                ${headerCells}
              </tr>
              <tr class="gb-grid-icon-row">
                ${gridAssignments.map((assignment) => `<th class="gb-type-${gradebookCategoryClass(assignment.category)}"><button class="gb-edit-icon" type="button" data-dialog-target="assignment-dialog-${assignment.id}" aria-label="Edit ${esc(assignment.title)}">${editIcon}</button></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr class="gb-grid-class-row">
                <th>Class Average <span data-grid-class-average>${gradebookDisplayScore(averageData.classAverage, letterScale)}</span></th>
                ${classAverageCells}
              </tr>
              <tr class="gb-grid-points-row">
                <th>Points</th>
                ${pointsCells}
              </tr>
              ${students.length ? studentRows : `<tr><th>No Students</th>${emptyAssignmentCells}</tr>`}
            </tbody>
          </table>
          </div>
        </div>
        <div class="gb-grid-footer">
          <span>${students.length} students / ${gridAssignments.length} assignments / ${subjectLabel}</span>
          <span data-grid-autosave-status role="status" aria-live="polite">Autosaves changes</span>
          ${ui.button({label:'Retry saves',attributes:{'data-grid-retry':'',hidden:true}})}
          ${ui.button({label:'Discard unsaved edits',attributes:{'data-grid-discard':'',hidden:true}})}
        </div>
        ${assignmentDialogs}
        <dialog class="assignment-dialog" id="add-assignment-dialog">
          <form method="post" action="/gradebook" class="assignment-dialog-form">
            ${csrfInput(csrfToken)}
            <input type="hidden" name="action" value="add-assignment" />
            <input type="hidden" name="schoolYearId" value="${yearId}" />
            <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
            <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
            <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
            <input type="hidden" name="scoreMode" value="${scoreMode}" />
            <div class="assignment-dialog-head">
              <span>${addIcon}</span>
              <h3>Add Assignment</h3>
            </div>
            <div class="assignment-dialog-body">
              <label>Title<input name="title" placeholder="${subject ? `e.g. Lesson 24 – ${esc(subject.name)}` : 'e.g. Lesson 24'}" required maxlength="140" /></label>
              <div class="assignment-dialog-grid">
                <label>Type<select name="category">${categoryOptions()}</select></label>
                <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
                <label>Date<input type="date" name="assignmentDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
              </div>
            </div>
            <div class="assignment-dialog-actions">
              <button class="secondary-btn" type="button" data-dialog-close>Cancel</button>
              <button type="submit">Add Assignment</button>
            </div>
          </form>
        </dialog>
      </div>`;
    }

    return `<section class="gb-grid-shell">
      <form method="get" action="/gradebook" class="gb-grid-toolbar">
        <input type="hidden" name="yearId" value="${yearId}" />
        <input type="hidden" name="grid" value="on" />
        <label>Period${periodSelect}</label>
        <label>Grade${gradeSelect}</label>
        <label>Subject${subjectSelect}</label>
        <div class="gb-type-legend" aria-label="Grade type legend">
          <b>Legend</b>
          <span><i class="legend-box lesson"></i> Homework</span>
          <span><i class="legend-box quiz"></i> Quiz</span>
          <span><i class="legend-box test"></i> Test</span>
        </div>
        <label>Enter As${modeSelect}</label>
        <label class="gb-toolbar-check"><span>Display</span><span class="check-row"><input type="checkbox" data-grid-letters-toggle checked /> Letters</span></label>
      </form>
      ${gridBody}
    </section>`;
  }

  function gradebookPage(req, url, user, selectedYear, csrfToken) {
    const yearId = asInt(selectedYear.id);
    const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=? ORDER BY period_number;`, [yearId]);
    const selectedPeriod = selectedPeriodFromRequest(req, url, periods);
    const selectedPeriodId = asInt(selectedPeriod?.id);
    const selectedGrade = cleanGrade(url.searchParams.get('grade'));
    const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
    const requestedAssignmentId = asInt(url.searchParams.get('assignmentId'));
    const showNewAssignment = url.searchParams.get('action') === 'add';
    const scoreMode = cleanScoreMode(url.searchParams.get('mode'));
    const gridParam = cleanText(url.searchParams.get('grid'), 12);
    const savedGridMode = parseCookies(req).gradebookGrid;
    const gridMode = gridParam ? gridParam !== 'off' : (savedGridMode ? savedGridMode === 'on' : true);
    const allGrades = sortGrades([
      ...querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=?;`, [yearId]).map((row) => row.grade_level),
      ...querySql(`SELECT grade_level FROM os_grade_subjects WHERE school_year_id=?;`, [yearId]).map((row) => row.grade_level)
    ]);
    const subjects = selectedGrade
      ? querySql(`SELECT s.id, s.name FROM os_grade_subjects gs JOIN os_subjects s ON s.id=gs.subject_id WHERE gs.school_year_id=? AND gs.grade_level=? ORDER BY s.name;`, [yearId, sqlParameter(selectedGrade)])
      : querySql('SELECT id, name FROM os_subjects ORDER BY name;');
    const subject = subjects.find((row) => row.id === selectedSubjectId);
    const allowed = !selectedGrade || teacherAllowedForSelection(user, yearId, selectedGrade, 0);
    const teacherParameters = user.role === ROLE_TEACHER ? [asInt(user.teacher_id), yearId] : [];
    const teacherStudentClause = user.role === ROLE_TEACHER ? 'AND sy.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=? AND school_year_id=?)' : '';
    const students = selectedGrade && allowed ? querySql(`SELECT st.id, st.first_name, st.last_name
        FROM os_student_years sy
        JOIN os_students st ON st.id = sy.student_id
        WHERE sy.school_year_id=?
          AND sy.grade_level=?
          AND sy.status='enrolled'
          ${teacherStudentClause}
        ORDER BY st.last_name, st.first_name;`, [yearId, sqlParameter(selectedGrade), ...teacherParameters]) : [];
    const periodParameters = [];
    const periodScope = assignmentPeriodClause(selectedPeriod, periodParameters);
    const assignmentParameters = [];
    const assignmentScope = assignmentAccessClause(user, yearId, assignmentParameters);
    const assignments = selectedGrade && selectedSubjectId && allowed ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
        COUNT(sc.id) AS score_count,
        ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
      FROM os_assignments a
      LEFT JOIN os_scores sc ON sc.assignment_id = a.id
      WHERE a.school_year_id=?
        AND a.grade_level=?
        AND a.subject_id=?
        ${assignmentScope}
        ${periodScope}
      GROUP BY a.id
      ORDER BY a.assignment_date DESC, a.id DESC;`, [yearId, sqlParameter(selectedGrade), selectedSubjectId, ...assignmentParameters, ...periodParameters]) : [];
    const selectedAssignmentId = showNewAssignment ? 0 : (requestedAssignmentId || asInt(assignments[0]?.id));
    const selectedAssignment = selectedAssignmentId
      ? authorizedAssignments(user, yearId, selectedGrade, selectedSubjectId, [selectedAssignmentId]).get(selectedAssignmentId)
      : null;
    const existingScores = selectedAssignment ? Object.fromEntries(
      querySql(`SELECT student_id, score FROM os_scores WHERE assignment_id=?;`, [selectedAssignment.id]).map((r) => [r.student_id, r.score])
    ) : {};

    const periodParam = selectedPeriodId ? `&markingPeriodId=${selectedPeriodId}` : '';
    const baseParams = `yearId=${yearId}${periodParam}${selectedGrade ? `&grade=${encodeURIComponent(selectedGrade)}` : ''}${selectedSubjectId ? `&subjectId=${selectedSubjectId}` : ''}&mode=${scoreMode}`;
    const gridOffUrl = `/gradebook?${baseParams}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}&grid=off`;
    const gridOnUrl = `/gradebook?${baseParams}${selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : ''}&grid=on`;
    const layoutToggle = gridModeToggle(gridOffUrl, gridOnUrl, gridMode);
    const periodSelect = `<select name="markingPeriodId" required data-auto-submit>${periods.map((period) => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${esc(period.period_number)}</option>`).join('')}</select>`;
    const gradeSelect = `<select name="grade" required data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
    const subjectSelect = `<select name="subjectId" required data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
    const assignmentModeParam = showNewAssignment ? '&action=add' : (selectedAssignmentId ? `&assignmentId=${selectedAssignmentId}` : '');
    const percentUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=percent')}${assignmentModeParam}`;
    const wrongUrl = `/gradebook?${baseParams.replace(`mode=${scoreMode}`, 'mode=wrong')}${assignmentModeParam}`;
    const scoreModeControl = scoreModeToggle(percentUrl, wrongUrl, scoreMode);
    const averageData = selectedGrade && selectedSubjectId && selectedPeriod
      ? periodAverageRows(yearId, selectedGrade, selectedSubjectId, students.map((student) => student.id), selectedPeriod)
      : { classAverage: null, studentAverages: new Map() };
    const scale = selectedGrade && selectedSubjectId ? letterGradeScale(yearId, selectedGrade, selectedSubjectId) : DEFAULT_LETTER_GRADES.map(([letter, threshold]) => ({ letter, threshold }));
    const classAverageBlock = selectedGrade && selectedSubjectId && selectedPeriod
      ? `<div class="class-average-callout"><span>Class average</span><b>${formatPercent(averageData.classAverage)}</b></div>`
      : '';

    if (gridMode) {
      return `<div class="workspace gradebook-grid-workspace">
        ${schoolYearHead('Gradebook', 'Grid entry with students down the side and assignments across the top.', selectedYear, layoutToggle)}
        ${gradebookGridView({
          selectedYear,
          yearId,
          periods,
          selectedPeriodId,
          selectedGrade,
          selectedSubjectId,
          scoreMode,
          allGrades,
          subjects,
          subject,
          allowed,
          students,
          assignments,
          averageData,
          letterScale: scale,
          classAverageBlock,
          csrfToken
        })}
      </div>`;
    }

    // Score entry panel
    let scoreContent = '';
    if (!allowed) {
      scoreContent = emptyState('This grade is not assigned to your teacher account.');
    } else if (!selectedGrade || !selectedSubjectId) {
      scoreContent = emptyState('Select a grade and subject to begin.');
    } else {
      const assignmentPicker = `<label class="assignment-picker">Assignment<select name="assignmentId" data-assignment-select data-base-url="/gradebook?${baseParams}">
        <option value="__new__" ${!selectedAssignment ? 'selected' : ''}>New assignment</option>
        ${assignments.map((a) => `<option value="${a.id}" ${a.id === selectedAssignmentId ? 'selected' : ''}>${esc(a.title)} · ${compactNumber(a.max_score)} pts${a.assignment_date ? ` · ${esc(a.assignment_date)}` : ''}</option>`).join('')}
      </select></label>`;

      const today = new Date().toISOString().slice(0, 10);
      const defaultAssignmentDate = selectedPeriod?.start_date && selectedPeriod.start_date > today ? selectedPeriod.start_date : today;
      const newFields = !selectedAssignment ? `<div class="form-grid four">
        <label>Title<input name="title" placeholder="Lesson 24" required maxlength="140" /></label>
        <label>Type<select name="category">${categoryOptions()}</select></label>
        <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
        <label>Date<input type="date" name="assignmentDate" value="${defaultAssignmentDate}" /></label>
      </div>` : '';

      const maxScore = asPoints(selectedAssignment?.max_score);
      const scoreRows = students.map((st) => {
        const existing = existingScores[st.id];
        const val = scoreValueForMode(existing, maxScore, scoreMode);
        const studentAverage = averageData.studentAverages.get(st.id);
        return `<div class="score-row">
          <div class="score-student-label"><b>${esc(`${st.last_name}, ${st.first_name}`)}</b><span class="student-period-avg">${formatPercent(studentAverage)}</span></div>
          ${scoreInputControl(st.id, val, maxScore, scoreMode)}
        </div>`;
      }).join('') || emptyState('No enrolled students found for this grade.');

      scoreContent = `<form method="post" action="/gradebook" class="form-grid">
        ${csrfInput(csrfToken)}
        <input type="hidden" name="schoolYearId" value="${yearId}" />
        <input type="hidden" name="markingPeriodId" value="${selectedPeriodId}" />
        <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
        <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
        <input type="hidden" name="scoreMode" value="${scoreMode}" />
        ${assignmentPicker}
        ${newFields}
        ${scoreModeControl}
        <p class="score-help">${scoreMode === 'percent' ? 'Enter each student score as a percentage.' : `Enter how many points were marked wrong${selectedAssignment ? ` out of ${compactNumber(maxScore)}` : ''}.`}</p>
        <div class="score-sheet">${scoreRows}</div>
        <button class="score-save-btn" type="submit">Save Scores</button>
      </form>`;
    }

    const panelMeta = subject ? `Grade ${esc(selectedGrade)} - ${esc(subject.name)}` : '';

    const historyRows = assignments.map((a) => {
      const active = a.id === selectedAssignmentId;
      return `<a class="history-link ${active ? 'active' : ''}" href="/gradebook?${baseParams}&assignmentId=${a.id}">
        <span class="history-main"><b>${esc(a.title)}</b><small>${esc(a.assignment_date || '') || 'No date'} · ${displayCategoryShort(a.category)} · ${compactNumber(a.max_score)} pts</small></span>
        <span class="history-side"><span class="badge ${gradeTone(a.avg_score)}">${formatPercent(a.avg_score)}</span><small>${a.score_count} scores</small></span>
      </a>`;
    }).join('') || emptyState('No assignment history for this selection yet.');

    return `<div class="workspace">
      ${schoolYearHead('Gradebook', 'Choose a grade and subject, pick or create an assignment, then enter scores.', selectedYear, layoutToggle)}
      <section class="panel">
        <form method="get" action="/gradebook" class="filters compact-filters">
          <input type="hidden" name="yearId" value="${yearId}" />
          <input type="hidden" name="mode" value="${scoreMode}" />
          <label>Period${periodSelect}</label>
          <label>Grade${gradeSelect}</label>
          <label>Subject${subjectSelect}</label>
          ${classAverageBlock}
        </form>
      </section>
      <div class="split gradebook-split">
        <section class="panel gradebook-score-panel">
          <div class="panel-title inline-title"><h2>Enter Scores</h2>${panelMeta ? `<span>- ${panelMeta}</span>` : ''}</div>
          ${scoreContent}
        </section>
        <section class="ledger assignment-history-panel">
          <div class="ledger-head"><h2>Assignment History</h2><p>Select an assignment to enter or revise scores.</p></div>
          <div class="assignment-history-list">
            ${historyRows}
          </div>
        </section>
      </div>
    </div>`;
  }

  function assignmentsPage(req, url, user, selectedYear, csrfToken) {
    const yearId = asInt(selectedYear.id);
    const selectedGrade = cleanGrade(url.searchParams.get('grade'));
    const selectedSubjectId = asInt(url.searchParams.get('subjectId'));
    const selectedAssignmentId = asInt(url.searchParams.get('assignmentId'));
    const scoreMode = cleanScoreMode(url.searchParams.get('mode'));
    const showAdd = !selectedAssignmentId || url.searchParams.get('action') === 'add';

    const allGrades = sortGrades([
      ...querySql(`SELECT grade_level FROM os_student_years WHERE school_year_id=?;`, [yearId]).map((r) => r.grade_level),
      ...querySql(`SELECT grade_level FROM os_grade_subjects WHERE school_year_id=?;`, [yearId]).map((r) => r.grade_level)
    ]);
    const subjects = selectedGrade
      ? querySql(`SELECT s.id, s.name FROM os_grade_subjects gs JOIN os_subjects s ON s.id=gs.subject_id WHERE gs.school_year_id=? AND gs.grade_level=? ORDER BY s.name;`, [yearId, sqlParameter(selectedGrade)])
      : querySql('SELECT id, name FROM os_subjects ORDER BY name;');
    const subject = subjects.find((s) => s.id === selectedSubjectId);
    const allowed = !selectedGrade || teacherAllowedForSelection(user, yearId, selectedGrade, 0);

    const assignmentParameters = [];
    const assignmentScope = assignmentAccessClause(user, yearId, assignmentParameters);
    const assignments = selectedGrade && selectedSubjectId && allowed ? querySql(`SELECT a.id, a.title, a.category, a.assignment_date, a.max_score,
        COUNT(sc.id) AS score_count,
        ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
      FROM os_assignments a
      LEFT JOIN os_scores sc ON sc.assignment_id = a.id
      WHERE a.school_year_id=?
        AND a.grade_level=?
        AND a.subject_id=?
        ${assignmentScope}
      GROUP BY a.id
      ORDER BY a.assignment_date DESC, a.id DESC;`, [yearId, sqlParameter(selectedGrade), selectedSubjectId, ...assignmentParameters]) : [];

    const selectedAssignment = selectedAssignmentId && !showAdd
      ? authorizedAssignments(user, yearId, selectedGrade, selectedSubjectId, [selectedAssignmentId]).get(selectedAssignmentId)
      : null;

    const teacherParameters = user.role === ROLE_TEACHER ? [asInt(user.teacher_id), yearId] : [];
    const teacherStudentClause = user.role === ROLE_TEACHER ? 'AND sy.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=? AND school_year_id=?)' : '';
    const students = selectedGrade && allowed ? querySql(`SELECT st.id, st.first_name, st.last_name
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=?
        AND sy.grade_level=?
        AND sy.status='enrolled'
        ${teacherStudentClause}
      ORDER BY st.last_name, st.first_name;`, [yearId, sqlParameter(selectedGrade), ...teacherParameters]) : [];

    const existingScores = selectedAssignment ? Object.fromEntries(
      querySql(`SELECT student_id, score FROM os_scores WHERE assignment_id=?;`, [selectedAssignment.id]).map((r) => [r.student_id, r.score])
    ) : {};

    const baseParams = `yearId=${yearId}${selectedGrade ? `&grade=${encodeURIComponent(selectedGrade)}` : ''}${selectedSubjectId ? `&subjectId=${selectedSubjectId}` : ''}&mode=${scoreMode}`;
    const gradeSelect = `<select name="grade" data-auto-submit><option value="">Grade</option>${allGrades.map((g) => `<option value="${esc(g)}" ${g === selectedGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>`;
    const subjectSelect = `<select name="subjectId" data-auto-submit><option value="">Subject</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === selectedSubjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
    const modeBaseParams = baseParams.replace(`mode=${scoreMode}`, 'mode=');

    const assignmentList = assignments.length > 0
      ? assignments.map((a) => {
          const active = !showAdd && a.id === selectedAssignmentId;
          return `<a class="family-link asgn-link ${active ? 'active' : ''}" href="/assignments?${baseParams}&assignmentId=${a.id}">
            <span class="asgn-title">${esc(a.title)}</span>
            <span class="asgn-meta">${displayCategoryShort(a.category)} &middot; ${esc(a.assignment_date || '—')}</span>
            <span class="badge ${gradeTone(a.avg_score)}">${formatPercent(a.avg_score)}</span>
          </a>`;
        }).join('')
      : `<div style="padding:.9rem">${emptyState(selectedGrade && selectedSubjectId ? 'No assignments yet.' : 'Select a grade and subject.')}</div>`;

    let rightPanel = '';
    if (!allowed) {
      rightPanel = `<section class="family-detail assignment-editor"><div class="family-detail-head"><h2>Assignments</h2></div><div class="family-detail-body">${emptyState('This grade is not assigned to your teacher account.')}</div></section>`;
    } else if (selectedAssignment) {
      const maxScore = asPoints(selectedAssignment.max_score);
      const scoreModeControl = scoreModeToggle(
        `/assignments?${modeBaseParams}percent&assignmentId=${selectedAssignment.id}`,
        `/assignments?${modeBaseParams}wrong&assignmentId=${selectedAssignment.id}`,
        scoreMode
      );
      const scoreRows = students.map((st) => {
        const existing = existingScores[st.id];
        const val = scoreValueForMode(existing, maxScore, scoreMode);
        return `<div class="score-row">
          <div><b>${esc(`${st.last_name}, ${st.first_name}`)}</b></div>
          ${scoreInputControl(st.id, val, maxScore, scoreMode)}
        </div>`;
      }).join('') || emptyState('No enrolled students in this grade.');

      rightPanel = `<section class="family-detail assignment-editor">
        <div class="family-detail-head">
          <h2>${esc(selectedAssignment.title)}</h2>
          <a class="secondary-btn compact-action" href="/assignments?${baseParams}&action=add">+ New</a>
        </div>
        <div class="family-detail-body">
          <form method="post" action="/assignments" class="form-grid" style="margin-bottom:1.25rem">
            ${csrfInput(csrfToken)}
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="assignmentId" value="${selectedAssignment.id}" />
            <input type="hidden" name="schoolYearId" value="${yearId}" />
            <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
            <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
            <div class="form-grid four">
              <label>Title<input name="title" value="${esc(selectedAssignment.title)}" required maxlength="140" /></label>
              <label>Type<select name="category">${categoryOptions(selectedAssignment.category)}</select></label>
              <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="${compactNumber(maxScore)}" required /></label>
              <label>Date<input type="date" name="assignmentDate" value="${esc(selectedAssignment.assignment_date || '')}" /></label>
            </div>
            <button type="submit">Save Details</button>
          </form>
          <div style="border-top:1px solid var(--line);padding-top:1.1rem">
            <p style="margin:0 0 .75rem;font-size:.9rem;font-weight:720">Student Scores</p>
            <form method="post" action="/assignments" class="form-grid">
              ${csrfInput(csrfToken)}
              <input type="hidden" name="action" value="scores" />
              <input type="hidden" name="assignmentId" value="${selectedAssignment.id}" />
              <input type="hidden" name="schoolYearId" value="${yearId}" />
              <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
              <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
              <input type="hidden" name="scoreMode" value="${scoreMode}" />
              ${scoreModeControl}
              <p class="score-help">${scoreMode === 'percent' ? 'Enter each student score as a percentage.' : `Enter how many points were marked wrong out of ${compactNumber(maxScore)}.`}</p>
              <div class="score-sheet">${scoreRows}</div>
              <button type="submit">Save Scores</button>
            </form>
          </div>
        </div>
      </section>`;
    } else {
      const placeholder = subject ? `e.g. Lesson 24 – ${subject.name}` : 'e.g. Lesson 24';
      rightPanel = `<section class="family-detail assignment-editor">
        <div class="family-detail-head"><h2>Add Assignment</h2></div>
        <div class="family-detail-body">
          ${selectedGrade && selectedSubjectId ? `<form method="post" action="/assignments" class="form-grid">
            ${csrfInput(csrfToken)}
            <input type="hidden" name="action" value="add" />
            <input type="hidden" name="schoolYearId" value="${yearId}" />
            <input type="hidden" name="gradeLevel" value="${esc(selectedGrade)}" />
            <input type="hidden" name="subjectId" value="${selectedSubjectId}" />
            <label>Title<input name="title" placeholder="${esc(placeholder)}" required maxlength="140" /></label>
            <label>Type<select name="category">${categoryOptions()}</select></label>
            <label>Points<input name="maxScore" type="number" inputmode="decimal" min="1" step="0.5" value="100" required /></label>
            <label>Date<input type="date" name="assignmentDate" value="${new Date().toISOString().slice(0, 10)}" /></label>
            <button type="submit">Add Assignment</button>
          </form>` : `<p class="empty">Select a grade and subject to add an assignment.</p>`}
        </div>
      </section>`;
    }

    return `<div class="workspace">
      ${schoolYearHead('Assignments', 'Create and edit assignments for a grade and subject.', selectedYear)}
      <section class="panel">
        <form method="get" action="/assignments" class="filters compact-filters">
          <input type="hidden" name="yearId" value="${yearId}" />
          <input type="hidden" name="mode" value="${scoreMode}" />
          <label>Grade${gradeSelect}</label>
          <label>Subject${subjectSelect}</label>
        </form>
      </section>
      <div class="assignments-layout">
        <section class="family-list">
          <div class="family-list-head">
            <h2>Assignments</h2>
            <div class="module-actions"><span class="family-count">${assignments.length}</span></div>
          </div>
          ${assignmentList}
        </section>
        ${rightPanel}
      </div>
    </div>`;
  }

  function reportOverview(yearId, selectedYear, user) {
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const kpis = {
      families: canAccessSetup(user) ? querySql('SELECT COUNT(*) AS count FROM os_families;')[0]?.count || 0 : 0,
      students: querySql(`SELECT COUNT(*) AS count
        FROM os_student_years sy
        JOIN os_students st ON st.id = sy.student_id
        WHERE sy.school_year_id=? AND sy.status='enrolled'
          ${accessClause};`, [yearId, ...accessParameters])[0]?.count || 0,
      classrooms: canAccessSetup(user) ? querySql(`SELECT COUNT(*) AS count FROM os_classrooms WHERE school_year_id=?;`, [yearId])[0]?.count || 0 : querySql(`SELECT COUNT(DISTINCT sy.classroom_id) AS count
        FROM os_student_years sy
        JOIN os_students st ON st.id = sy.student_id
        WHERE sy.school_year_id=? AND sy.status='enrolled'
          ${accessClause};`, [yearId, ...accessParameters])[0]?.count || 0,
      board: canAccessSetup(user) ? querySql(`SELECT COUNT(*) AS count
        FROM os_person_roles pr
        JOIN os_role_groups rg ON rg.id = pr.group_id
        WHERE rg.name='Board Members';`)[0]?.count || 0 : 0
    };
    const gradeRows = querySql(`SELECT sy.grade_level AS grade_level, COUNT(*) AS count
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled'
        ${accessClause}
      GROUP BY sy.grade_level;`, [yearId, ...accessParameters]);
    const sortedGrades = sortGrades(gradeRows.map((row) => row.grade_level));
    const gradesByName = new Map(gradeRows.map((row) => [row.grade_level, Number(row.count || 0)]));
    const largestGrade = Math.max(1, ...gradeRows.map((row) => Number(row.count || 0)));
    const birthdayRows = querySql(`SELECT CAST(strftime('%m', st.birth_date) AS INTEGER) AS month, COUNT(*) AS count
      FROM os_students st
      JOIN os_student_years sy ON sy.student_id = st.id
      WHERE sy.school_year_id=? AND sy.status='enrolled' AND st.birth_date IS NOT NULL AND st.birth_date != ''
        ${accessClause}
      GROUP BY month;`, [yearId, ...accessParameters]);
    const birthdayByMonth = new Map(birthdayRows.map((row) => [Number(row.month), Number(row.count || 0)]));
    const largestMonth = Math.max(1, ...birthdayRows.map((row) => Number(row.count || 0)));

    return `<div class="workspace">
      ${schoolYearHead('Reports', `Overview for ${selectedYear.name}.`, selectedYear, '<button class="secondary-btn" type="button" data-print-page>Print</button>')}
      ${printReportHead('Reports', selectedYear, 'Overview')}
      <section class="report-kpis">
        <div class="report-kpi"><span>Families</span><strong>${kpis.families}</strong></div>
        <div class="report-kpi"><span>Students</span><strong>${kpis.students}</strong></div>
        <div class="report-kpi"><span>Classrooms</span><strong>${kpis.classrooms}</strong></div>
        <div class="report-kpi"><span>Board Roles</span><strong>${kpis.board}</strong></div>
      </section>
      ${reportsNav('', yearId)}
      <div class="report-summary">
        <section class="chart-panel">
          <div class="chart-head"><h2>Students by Grade</h2><span>${kpis.students} enrolled</span></div>
          <div class="bar-list">
            ${sortedGrades.map((grade, index) => {
              const count = gradesByName.get(grade) || 0;
              return `<div class="bar-row" style="${reportMeterStyle(index, count / largestGrade)}"><b>Grade ${esc(grade)}</b><div class="bar-track"><div class="bar-fill"></div></div><span>${count}</span></div>`;
            }).join('') || emptyState('No enrolled students for this school year.')}
          </div>
        </section>
        <section class="chart-panel">
          <div class="chart-head"><h2>Birthdays by Month</h2><span>${birthdayRows.reduce((sum, row) => sum + Number(row.count || 0), 0)} dated</span></div>
          <div class="distribution">
            ${Array.from({ length: 12 }, (_, index) => {
              const month = index + 1;
              const count = birthdayByMonth.get(month) || 0;
              return `<div class="distribution-row" style="${reportMeterStyle(index + 2, count / largestMonth)}"><b>${monthName(month).slice(0, 3)}</b><div class="bar-track"><div class="bar-fill"></div></div><span>${count}</span></div>`;
            }).join('')}
          </div>
        </section>
      </div>
    </div>`;
  }

  function familiesReport(yearId, selectedYear) {
    const rows = querySql(`SELECT f.id, f.family_name, f.father_name, f.mother_name, f.father_phone, f.mother_phone, f.phone, f.address,
        cng.name AS congregation_name,
        COUNT(sy.id) AS student_count
      FROM os_families f
      LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
      LEFT JOIN os_students st ON st.family_id = f.id
      LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=? AND sy.status='enrolled'
      GROUP BY f.id
      ORDER BY f.family_name;`, [yearId]);
    return `${printReportHead('Families', selectedYear, `${rows.length} families`)}
    <section class="ledger family-report">
      <div class="ledger-head"><h2>Families</h2><p>Parent names, household contact information, and enrolled student counts.</p></div>
      <div class="table-wrap"><table>
        <tr><th>Family</th><th>Congregation</th><th>Address</th><th>Contact</th><th>Students</th></tr>
        ${rows.map((row) => {
          const contact = row.father_phone || row.mother_phone || row.phone || '';
          return `<tr>
            <td>${esc(familyReportName(row))}</td>
            <td>${esc(row.congregation_name || '') || '&mdash;'}</td>
            <td>${esc(row.address || '') || '&mdash;'}</td>
            <td>${esc(contact) || '&mdash;'}</td>
            <td>${Number(row.student_count || 0)}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="5">${emptyState('No families have been entered yet.')}</td></tr>`}
      </table></div>
    </section>`;
  }

  function studentsReport(url, yearId, selectedYear, user) {
    const selectedGrade = cleanGrade(url.searchParams.get('grade'));
    const gradeClause = selectedGrade ? 'AND sy.grade_level=?' : '';
    const gradeParameters = selectedGrade ? [sqlParameter(selectedGrade)] : [];
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const grades = sortGrades(querySql(`SELECT DISTINCT sy.grade_level
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled'
        ${accessClause};`, [yearId, ...accessParameters]).map((row) => row.grade_level));
    const rows = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, st.birth_date,
        sy.grade_level, c.name AS classroom_name, t.name AS teacher_name
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
      LEFT JOIN os_teachers t ON t.id = c.teacher_id
      WHERE sy.school_year_id=? AND sy.status='enrolled' ${gradeClause}
        ${accessClause}
      ORDER BY st.last_name, st.first_name;`, [yearId, ...gradeParameters, ...accessParameters]);
    const groupedGrades = sortGrades(rows.map((row) => row.grade_level));
    return `<div class="workspace">
      <section class="panel">
        <form method="get" action="/reports" class="filters">
          <input type="hidden" name="yearId" value="${yearId}" />
          <input type="hidden" name="report" value="students" />
          <label>Grade<select name="grade" data-auto-submit>${gradeOptionsFromRows(grades, selectedGrade)}</select></label>
        </form>
      </section>
      ${printReportHead('Student Report', selectedYear, selectedGrade ? `Grade ${selectedGrade}` : 'All grades')}
      <section class="ledger student-report">
        <div class="ledger-head"><h2>Student Report</h2><p>Students grouped by grade with room and teacher assignments.</p></div>
        <div class="family-detail-body report-section-list">
          ${groupedGrades.map((grade) => {
            const gradeRows = rows.filter((row) => row.grade_level === grade);
            const rooms = [...new Set(gradeRows.map((row) => [row.classroom_name, row.teacher_name].filter(Boolean).join(' / ')).filter(Boolean))];
            return `<section class="report-grade-section">
              <div class="report-grade-head"><h3>Grade ${esc(grade)} <span>(${gradeRows.length})</span></h3><span>${rooms.map(esc).join(', ') || 'No room assigned'}</span></div>
              <div class="table-wrap compact-table"><table>
                <tr><th>Student</th><th>Birthday</th><th>Room</th><th>Teacher</th></tr>
                ${gradeRows.map((row) => `<tr>
                  <td>${esc(studentLastFirst(row))}</td>
                  <td>${esc(formatDateNumeric(row.birth_date)) || '&mdash;'}</td>
                  <td>${esc(row.classroom_name || '') || '&mdash;'}</td>
                  <td>${esc(row.teacher_name || '') || '&mdash;'}</td>
                </tr>`).join('')}
              </table></div>
            </section>`;
          }).join('') || emptyState('No enrolled students found for this report.')}
        </div>
      </section>
    </div>`;
  }

  function schoolBoardReport(selectedYear) {
    const rows = querySql(`SELECT pr.*, rt.name AS role_name,
        CASE pr.person_type WHEN 'father' THEN f.father_name WHEN 'mother' THEN f.mother_name ELSE t.name END AS person_name,
        CASE pr.person_type WHEN 'father' THEN f.address WHEN 'mother' THEN f.address ELSE t.address END AS address,
        CASE pr.person_type WHEN 'father' THEN COALESCE(f.father_phone, f.phone) WHEN 'mother' THEN COALESCE(f.mother_phone, f.phone) ELSE COALESCE(t.mobile_phone, t.phone) END AS phone
      FROM os_person_roles pr
      JOIN os_role_groups rg ON rg.id = pr.group_id
      JOIN os_role_types rt ON rt.id = pr.role_type_id
      LEFT JOIN os_families f ON f.id = pr.person_id AND pr.person_type IN ('father', 'mother')
      LEFT JOIN os_teachers t ON t.id = pr.person_id AND pr.person_type = 'teacher'
      WHERE rg.name='Board Members'
      ORDER BY rt.name, person_name;`);
    return `${printReportHead('School Board', selectedYear, `${rows.length} members`)}
    <section class="ledger board-report">
      <div class="ledger-head"><h2>School Board</h2><p>Board roles are pulled from the existing Board Members role group.</p></div>
      <div class="board-report-list">
        ${rows.map((row) => `<article class="board-report-row">
          <div><strong>${esc(row.person_name || '') || '&mdash;'}</strong><span>${esc(row.address || '') || '&mdash;'}</span></div>
          <div><span>${esc(row.phone || '') || '&mdash;'}</span></div>
          <div><strong>${row.is_assistant ? 'Assistant ' : ''}${esc(row.role_name)}</strong><span>${esc(boardTermLabel(row))}</span></div>
        </article>`).join('') || emptyState('No school board roles have been assigned yet.')}
      </div>
    </section>`;
  }

  function birthdaysReport(yearId, selectedYear, user) {
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const rows = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, st.birth_date,
        CAST(strftime('%m', st.birth_date) AS INTEGER) AS birth_month,
        CAST(strftime('%d', st.birth_date) AS INTEGER) AS birth_day,
        sy.grade_level, c.name AS classroom_name
      FROM os_students st
      JOIN os_student_years sy ON sy.student_id = st.id
      LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
      WHERE sy.school_year_id=? AND sy.status='enrolled' AND st.birth_date IS NOT NULL AND st.birth_date != ''
        ${accessClause}
      ORDER BY birth_month, birth_day, st.last_name, st.first_name;`, [yearId, ...accessParameters]);
    return `${printReportHead('Student Birthdays', selectedYear)}
    <section class="ledger birthday-report">
      <div class="ledger-head"><h2>Student Birthdays</h2><p>Birthdays grouped by month for the selected school year.</p></div>
      <div class="family-detail-body">
        <div class="month-grid">
          ${Array.from({ length: 12 }, (_, index) => {
            const month = index + 1;
            const monthRows = rows.filter((row) => Number(row.birth_month) === month);
            return `<section class="month-block">
              <h3>${monthName(month)} <span>${monthRows.length} ${monthRows.length === 1 ? 'student' : 'students'}</span></h3>
              <ul class="birthday-list">
                ${monthRows.map((row) => `<li><b>${esc(studentDisplayName(row))}</b><span class="birthday-date">${esc(formatDateNumeric(row.birth_date))}</span><span class="birthday-meta">Grade ${esc(row.grade_level)}${row.classroom_name ? ` &middot; ${esc(row.classroom_name)}` : ''}</span></li>`).join('') || `<li><span>No birthdays listed.</span></li>`}
              </ul>
            </section>`;
          }).join('')}
        </div>
      </div>
    </section>`;
  }

  function gradeGraphReport(url, yearId, selectedYear, user) {
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const grades = sortGrades(querySql(`SELECT DISTINCT sy.grade_level
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled'
        ${accessClause};`, [yearId, ...accessParameters]).map((row) => row.grade_level));
    const selectedGrade = cleanGrade(url.searchParams.get('grade')) || grades[0] || '';
    const requestedScope = cleanText(url.searchParams.get('scope'), 12);
    const scope = requestedScope === 'student' ? 'student' : 'grade';
    const students = selectedGrade ? querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled' AND sy.grade_level=?
        ${accessClause}
      ORDER BY st.last_name, st.first_name;`, [yearId, sqlParameter(selectedGrade), ...accessParameters]) : [];
    const selectedStudentId = scope === 'student' ? (asInt(url.searchParams.get('studentId')) || asInt(students[0]?.id)) : 0;
    const selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || null;
    const graphStudentIds = scope === 'student'
      ? (selectedStudent ? [asInt(selectedStudent.id)] : [])
      : students.map((student) => asInt(student.id));
    const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=? ORDER BY period_number;`, [yearId]);
    const subjects = selectedGrade ? querySql(`SELECT DISTINCT s.id, s.name
      FROM os_assignments a
      JOIN os_subjects s ON s.id = a.subject_id
      WHERE a.school_year_id=? AND a.grade_level=?
      ORDER BY s.name;`, [yearId, sqlParameter(selectedGrade)]) : [];
    const graphPeriods = periods.length ? periods : [{ id: 0, name: 'Current', start_date: '', end_date: '' }];
    const averages = loadGradeAverages(querySql, { yearId, grade: selectedGrade, subjectIds: subjects.map((subject) => subject.id), studentIds: graphStudentIds, periods: graphPeriods });
    const series = subjects.map((subject, index) => ({
      id: subject.id,
      name: subject.name,
      color: graphColor(index),
      values: graphPeriods.map((period) => {
        if (!graphStudentIds.length) return null;
        const result = averages.get(subject.id, period);
        if (scope === 'student') return result.studentAverages.get(asInt(selectedStudent?.id)) ?? null;
        return result.classAverage;
      })
    }));
    const studentOptions = students.map((student) => `<option value="${student.id}" ${asInt(student.id) === selectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)}</option>`).join('');
    return `<div class="workspace grade-graph-report">
      <section class="panel">
        <form method="get" action="/reports" class="filters">
          <input type="hidden" name="yearId" value="${yearId}" />
          <input type="hidden" name="report" value="grade-graph" />
          <label>Scope<select name="scope" data-auto-submit><option value="grade" ${scope === 'grade' ? 'selected' : ''}>Full grade</option><option value="student" ${scope === 'student' ? 'selected' : ''}>Individual student</option></select></label>
          <label>Grade<select name="grade" data-auto-submit>${gradeOptionsFromRows(grades, selectedGrade, 'Choose grade')}</select></label>
          <label>Student<select name="studentId" ${scope === 'student' ? 'data-auto-submit' : ''}><option value="">Choose student</option>${studentOptions}</select></label>
        </form>
      </section>
      ${printReportHead(scope === 'student' && selectedStudent ? studentDisplayName(selectedStudent) : selectedGrade ? `Grade ${selectedGrade}` : 'Grade Graph', selectedYear, 'Grade Graph')}
      <section class="chart-panel grade-graph">
        <div class="grade-graph-screen">
          <div class="chart-head"><h2>Grade Graph</h2><span>${scope === 'student' && selectedStudent ? esc(studentDisplayName(selectedStudent)) : selectedGrade ? `Grade ${esc(selectedGrade)}` : 'No grade selected'}</span></div>
        </div>
        <div class="grade-graph-print-grid ${series.length === 1 ? 'single' : ''}">
          ${series.map((item) => {
            const finalAverage = average(item.values);
            return `<section class="mini-subject-chart" style="--subject-color:${item.color}">
              <header><h3>${esc(item.name)}</h3><span>Final Average ${formatPercent(finalAverage)}</span></header>
              ${miniSubjectChartSvg(item, graphPeriods)}
            </section>`;
          }).join('') || emptyState('No subjects with scores yet.')}
        </div>
      </section>
    </div>`;
  }

  function studentGradeGraphPanel(student, yearId, selectedYear, gradeSettings) {
    if (!student) return emptyState('No child is linked to this parent account for the selected school year.');
    const selectedGrade = cleanGrade(student.grade_level);
    const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=? ORDER BY period_number;`, [yearId]);
    const graphPeriods = periods.length ? periods : [{ id: 0, name: 'Current', start_date: '', end_date: '' }];
    const subjects = selectedGrade ? querySql(`SELECT DISTINCT s.id, s.name
      FROM os_assignments a
      JOIN os_subjects s ON s.id = a.subject_id
      WHERE a.school_year_id=? AND a.grade_level=?
      ORDER BY s.name;`, [yearId, sqlParameter(selectedGrade)]) : [];
    const averages = loadGradeAverages(querySql, {
      yearId,
      grade: selectedGrade,
      subjectIds: subjects.map((subject) => subject.id),
      studentIds: [asInt(student.id)],
      periods: graphPeriods,
      settings: gradeSettings,
    });
    const series = subjects.map((subject, index) => ({
      id: subject.id,
      name: subject.name,
      color: graphColor(index),
      values: graphPeriods.map((period) => {
        const result = averages.get(subject.id, period);
        return result.studentAverages.get(asInt(student.id)) ?? null;
      })
    }));
    return `<section class="chart-panel grade-graph">
      <div class="grade-graph-screen">
        <div class="chart-head"><h2>Grade Graph</h2><span>${esc(studentDisplayName(student))} / Grade ${esc(selectedGrade)}</span></div>
      </div>
      <div class="grade-graph-print-grid ${series.length === 1 ? 'single' : ''}">
        ${series.map((item) => {
          const finalAverage = average(item.values);
          return `<section class="mini-subject-chart" style="--subject-color:${item.color}">
            <header><h3>${esc(item.name)}</h3><span>Final Average ${formatPercent(finalAverage)}</span></header>
            ${miniSubjectChartSvg(item, graphPeriods)}
          </section>`;
        }).join('') || emptyState('No subjects with scores yet.')}
      </div>
    </section>`;
  }

  function parentPage(url, user, selectedYear) {
    const yearId = asInt(selectedYear.id);
    if (!asInt(user.parent_family_id)) {
      return `<div class="workspace">${schoolYearHead('Parent Portal', 'Your account is not linked to a family yet.', selectedYear)}${emptyState('Ask a principal or admin to link this sign-in to your family record.')}</div>`;
    }
    const children = querySql(`SELECT st.id, st.first_name, st.middle_name, st.last_name, sy.grade_level
      FROM os_students st
      JOIN os_student_years sy ON sy.student_id = st.id
      WHERE st.family_id=?
        AND sy.school_year_id=?
        AND sy.status='enrolled'
      ORDER BY st.birth_date, st.last_name, st.first_name;`, [asInt(user.parent_family_id), yearId]);
    const selectedStudentId = asInt(url.searchParams.get('studentId')) || asInt(children[0]?.id);
    const selectedStudent = children.find((student) => asInt(student.id) === selectedStudentId) || children[0] || null;
    const gradeSettings = loadGradeWeights(querySql, yearId);
    const graph = studentGradeGraphPanel(selectedStudent, yearId, selectedYear, gradeSettings);
    const reportCards = reportCardsPage(url, selectedYear, user, {
      formAction: '/parent',
      gradeSettings,
      title: 'Report Card',
      description: 'View printable report cards for your children.',
      childPicker: true
    });
    return `<div class="workspace">
      ${schoolYearHead('Parent Portal', 'View grades and report cards for your children.', selectedYear)}
      ${graph}
    </div>
    ${reportCards}`;
  }

  function reportsPage(url, selectedYear, user) {
    const yearId = asInt(selectedYear.id);
    const activeReport = reportDefinitions().some((report) => report.key === url.searchParams.get('report')) ? url.searchParams.get('report') : '';
    const title = activeReport ? reportDefinitions().find((report) => report.key === activeReport).title : 'Reports';
    if (!canAccessSetup(user) && ['families', 'school-board'].includes(activeReport)) {
      return `<div class="workspace">${schoolYearHead('Reports', 'This report is only available to principals and admins.', selectedYear)}${emptyState('Choose a student or grade report instead.')}</div>`;
    }
    let content = '';
    if (activeReport === 'families') content = familiesReport(yearId, selectedYear);
    if (activeReport === 'students') content = studentsReport(url, yearId, selectedYear, user);
    if (activeReport === 'school-board') content = schoolBoardReport(selectedYear);
    if (activeReport === 'birthdays') content = birthdaysReport(yearId, selectedYear, user);
    if (activeReport === 'grade-graph') content = gradeGraphReport(url, yearId, selectedYear, user);
    if (!activeReport) return reportOverview(yearId, selectedYear, user);

    return `<div class="workspace">
      ${schoolYearHead(title, reportDefinitions().find((report) => report.key === activeReport).description, selectedYear, '<button class="secondary-btn" type="button" data-print-page>Print</button>')}
      ${reportsNav(activeReport, yearId)}
      ${content}
    </div>`;
  }

  function reportCardsPage(url, selectedYear, user, options = {}) {
    const yearId = asInt(selectedYear.id);
    const settings = appSettings();
    let selectedGrade = cleanGrade(url.searchParams.get('grade'));
    const selectedStudentId = asInt(url.searchParams.get('studentId'));
    const selectedPeriodId = asInt(url.searchParams.get('markingPeriodId'));
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const allAccessibleStudents = querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled'
        ${accessClause}
      ORDER BY st.last_name, st.first_name;`, [yearId, ...accessParameters]);
    const grades = sortGrades(allAccessibleStudents.map((row) => row.grade_level));
    if (options.childPicker && !selectedStudentId && allAccessibleStudents[0]) selectedGrade = allAccessibleStudents[0].grade_level;
    if (options.childPicker && selectedStudentId) selectedGrade = allAccessibleStudents.find((student) => asInt(student.id) === selectedStudentId)?.grade_level || '';
    const periods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=? ORDER BY period_number;`, [yearId]);
    const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) || (options.childPicker ? periods[0] : null);
    const students = options.childPicker ? allAccessibleStudents : allAccessibleStudents.filter((student) => student.grade_level === selectedGrade);
    const selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || (options.childPicker ? students[0] : null);
    if (selectedStudent) selectedGrade = selectedStudent.grade_level;
    const effectiveSelectedStudentId = asInt(selectedStudent?.id);
    const effectiveSelectedPeriodId = asInt(selectedPeriod?.id);
    const subjects = selectedGrade ? querySql(`SELECT s.id, s.name
      FROM os_grade_subjects gs
      JOIN os_subjects s ON s.id = gs.subject_id
      WHERE gs.school_year_id=? AND gs.grade_level=?
      ORDER BY s.name;`, [yearId, sqlParameter(selectedGrade)]) : [];
    const { weightGroups, weightItems } = options.gradeSettings || loadGradeWeights(querySql, yearId);
    const scoreRows = selectedStudent ? querySql(`SELECT sc.student_id, a.subject_id, s.name AS subject_name, a.category, a.assignment_date, a.marking_period_id,
        ROUND((sc.score / NULLIF(a.max_score, 0)) * 100, 1) AS percent
      FROM os_scores sc
      JOIN os_assignments a ON a.id = sc.assignment_id
      JOIN os_subjects s ON s.id = a.subject_id
      WHERE a.school_year_id=?
        AND a.grade_level=?
        AND sc.student_id=?;`, [yearId, sqlParameter(selectedGrade), selectedStudent.id]) : [];
    const absenceRows = selectedStudent ? querySql(`SELECT * FROM os_absences
      WHERE school_year_id=?
        AND student_id=?
        AND kind='absence'
      ORDER BY absence_date;`, [yearId, selectedStudent.id]) : [];
    const reportAverages = summarizeGradeRows(scoreRows, {
      grade: selectedGrade,
      subjectIds: subjects.map((subject) => subject.id),
      studentIds: selectedStudent ? [effectiveSelectedStudentId] : [],
      periods,
      weightGroups,
      weightItems,
    });
    const subjectPeriodRows = subjects.map((subject) => ({
      subject,
      periodScores: periods.map((period) => reportAverages.get(subject.id, period).studentAverages.get(effectiveSelectedStudentId) ?? null)
    }));
    const gradeSelect = `<select name="grade" data-auto-submit required><option value="">Grade</option>${grades.map((grade) => `<option value="${esc(grade)}" ${grade === selectedGrade ? 'selected' : ''}>${esc(grade)}</option>`).join('')}</select>`;
    const studentSelect = `<select name="studentId" required data-auto-submit><option value="">Student</option>${students.map((student) => `<option value="${student.id}" ${asInt(student.id) === effectiveSelectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)}</option>`).join('')}</select>`;
    const periodSelect = `<select name="markingPeriodId" required data-auto-submit><option value="">Marking Period</option>${periods.map((period) => `<option value="${period.id}" ${asInt(period.id) === effectiveSelectedPeriodId ? 'selected' : ''}>${esc(period.name)}</option>`).join('')}</select>`;
    const periodHeaders = periods.map((period) => `<th>${esc(period.period_number)}</th>`).join('');
    const subjectPeriodHeaders = `${periodHeaders}<th class="average-col">Avg</th>`;
    const conductSectionStarts = new Set([0, 5, 11, 19, 22]);
    const conductRows = Array.from({ length: 28 }, (_, index) => `<tr class="${conductSectionStarts.has(index) ? 'conduct-section-row' : ''}">${periods.map(() => '<td></td>').join('')}</tr>`).join('');
    const subjectTableRows = subjectPeriodRows.map((row) => {
      const scores = numericValues(row.periodScores);
      const avg = scores.length ? Math.round(average(scores)) : null;
      return `<tr>${row.periodScores.map((score) => `<td>${score === null || score === undefined ? '' : Math.round(Number(score))}</td>`).join('')}<td class="average-col">${avg === null ? '' : avg}</td></tr>`;
    }).join('');
    const subjectLabels = subjectPeriodRows.map((row) => `<span>${esc(row.subject.name)}</span>`).join('') || '<span>No subjects</span>';
    const absenceByPeriod = periods.map((period) => periodAbsenceTotal(absenceRows, period));
    const absenceTotal = absenceByPeriod.reduce((sum, value) => sum + value, 0);
    const presentDays = Math.max(0, (asInt(selectedYear.school_days) || 180) - absenceTotal);
    const preview = selectedStudent && selectedPeriod ? `<div class="report-card-document">
      <section class="report-card-spread cover-spread">
        <div class="report-page parent-page">
          <p class="parent-note"><em>To the parent:</em></p>
          <p class="parent-note">Please sign your name to show that you have read this report and return the report to school promptly.</p>
          <div class="signature-line">Signature</div>
          <div class="generated-note">Generated by<br>Oakstead</div>
        </div>
        <div class="report-spine"></div>
        <div class="report-page cover-page">
          <img class="cover-leaf" src="${settings.logoUrl}" alt="${esc(settings.schoolName)}" />
          <h2>Report Card</h2>
          <div class="cover-of">of</div>
          <div class="script-line">${esc(selectedStudent.first_name)} ${esc(selectedStudent.last_name)}</div>
          <div class="cover-meta">Grade <span class="blank-line">${esc(selectedGrade)}</span> <span>School Year ${esc(selectedYear.name)}</span></div>
          <div class="school-name-line">${esc(settings.schoolName)}</div>
          ${reportCardBooksSvg()}
          <div class="verse">"The fear of the Lord is the beginning<br>of wisdom." Psalm 111:10</div>
          <div class="parents-copy">
            <em>To the Parents:</em>
            <p>This report is to inform you of your child's performance in their studies and conduct at school. Please read it carefully and discuss it with your child.</p>
            <p>The school requests your support so that your child does their best at school. We invite you to visit school and observe your child at work. We also encourage you to discuss your child's progress with their teacher.</p>
            <p class="board-signoff">The School Board and Teachers</p>
          </div>
        </div>
      </section>
      <section class="report-card-spread inside-spread">
        <div>
          <div class="period-grid-wrap">
            <div class="subject-list"><strong>REPORT PERIODS</strong>${subjectLabels}</div>
            <table class="period-table">
              <tr>${subjectPeriodHeaders}</tr>
              ${subjectTableRows || `<tr>${periods.map(() => '<td></td>').join('')}<td class="average-col"></td></tr>`}
            </table>
          </div>
          <div class="key-subject">
            <h3>Key to Subject Grades</h3>
            <div class="key-row"><span>A</span><span>(94-100)</span><span>Excellent Work</span></div>
            <div class="key-row"><span>B</span><span>(86-93)</span><span>Good Work</span></div>
            <div class="key-row"><span>C</span><span>(76-85)</span><span>Fair Work</span></div>
            <div class="key-row"><span>D</span><span>(70-75)</span><span>Poor Work</span></div>
            <div class="key-row"><span>E</span><span>(63-69)</span><span>Failing Work--Needs Improvement to Pass</span></div>
            <div class="key-row"><span>F</span><span>(62 and below)</span><span>Failing Work--Needs Great Improvement to Pass</span></div>
          </div>
        </div>
        <div>
          <div class="conduct-panel">
            <div class="conduct-list">
              <h3>Conduct Grades</h3>
              <div class="conduct-section"><strong>Classroom Behaviour</strong><span>Avoids disturbing others</span><span>Has good posture</span><span>Pays attention in class</span><span>Speaks with good volume and enunciation</span></div>
              <div class="conduct-section"><strong>Interpersonal Relationships</strong><span>Is mannerly</span><span>Is thoughtful and gracious</span><span>Respects others' feelings</span><span>Respects others' property</span><span>Works and plays well with others</span></div>
              <div class="conduct-section"><strong>Spiritual & Moral Traits</strong><span>Accepts direction cheerfully</span><span>Is honest & trustworthy</span><span>Is respectful</span><span>Obeys school rules</span><span>Shows interest in spiritual matters</span><span>Shows self-control</span><span>Uses wholesome speech</span></div>
              <div class="conduct-section"><strong>Stewardship</strong><span>Cares for school property</span><span>Keeps desk and books tidy</span></div>
              <div class="conduct-section"><strong>Work Habits</strong><span>Enjoys study</span><span>Follows directions</span><span>Shows effort and perseverance</span><span>Stays current with assignments</span><span>Uses time well</span><span>Works carefully</span></div>
            </div>
            <table class="conduct-table"><tr>${periodHeaders}</tr>${conductRows}</table>
          </div>
          <div class="conduct-keys">
            <div><strong>Key to Conduct Grades<br>(and First Grades Subjects)</strong><br>S &nbsp;&nbsp; Satisfactory<br>N &nbsp;&nbsp; Needs Improvement<br>U &nbsp;&nbsp; Unsatisfactory</div>
            <div><strong>Key to Subheading Marks</strong><br>(+) &nbsp;&nbsp; Commendable<br>(no mark) &nbsp;&nbsp; Satisfactory<br>(-) &nbsp;&nbsp; Needs Improvement</div>
          </div>
          <div class="attendance">
            <div class="attendance-labels"><h3>ATTENDANCE</h3><div>Absence</div><strong>Total Days Present</strong></div>
            <table class="attendance-table">
              <tr>${periodHeaders}<th>Total</th></tr>
              <tr>${absenceByPeriod.map((value) => `<td>${formatAbsence(value)}</td>`).join('')}<td>${formatAbsence(absenceTotal)}</td></tr>
              <tr>${periods.map(() => '<td></td>').join('')}<td>${formatAbsence(presentDays)}</td></tr>
            </table>
          </div>
        </div>
      </section>
    </div>` : emptyState('Select a grade, student, and marking period to build a report card.');

    return `<div class="workspace">
      ${schoolYearHead(options.title || 'Report Cards', options.description || 'Generate printable report cards from marking periods and grade weights.', selectedYear)}
      <section class="panel">
        <form method="get" action="${esc(options.formAction || '/report-cards')}" class="filters">
          <input type="hidden" name="yearId" value="${yearId}" />
          ${options.childPicker ? '' : `<label>Grade${gradeSelect}</label>`}
          <label>Student${studentSelect}</label>
          <label>Marking Period${periodSelect}</label>
          <button type="submit">Load Report Card</button>
        </form>
      </section>
      ${selectedStudent && selectedPeriod ? `<div class="report-card-actions"><button type="button" class="page-action compact-action" data-generate-pdf>Generate PDF</button></div>` : ''}
      ${preview}
    </div>`;
  }

  function absencesPage(url, selectedYear, csrfToken, user) {
    const yearId = asInt(selectedYear.id);
    const action = cleanText(url.searchParams.get('action'), 40);
    const accessParameters = [];
    const accessClause = studentAccessClause(user, yearId, 'st', 'sy', accessParameters);
    const students = querySql(`SELECT st.id, st.first_name, st.last_name, sy.grade_level
      FROM os_student_years sy
      JOIN os_students st ON st.id = sy.student_id
      WHERE sy.school_year_id=? AND sy.status='enrolled'
        ${accessClause}
      ORDER BY sy.grade_level, st.last_name, st.first_name;`, [yearId, ...accessParameters]);
    students.sort((a, b) => gradeRank(a.grade_level) - gradeRank(b.grade_level)
      || String(a.last_name).localeCompare(String(b.last_name))
      || String(a.first_name).localeCompare(String(b.first_name)));
    const grades = sortGrades(students.map((student) => student.grade_level));
    let selectedGrade = cleanGrade(url.searchParams.get('grade'));
    if (selectedGrade && !grades.includes(selectedGrade)) selectedGrade = '';
    let selectedStudentId = asInt(url.searchParams.get('studentId'));
    let selectedStudent = students.find((student) => asInt(student.id) === selectedStudentId) || null;
    if (selectedStudentId && (!selectedStudent || (selectedGrade && selectedStudent.grade_level !== selectedGrade))) {
      selectedStudentId = 0;
      selectedStudent = null;
    }
    const filteredStudentOptions = selectedGrade ? students.filter((student) => student.grade_level === selectedGrade) : students;
    const gradeClause = selectedGrade ? 'AND sy.grade_level=?' : '';
    const gradeParameters = selectedGrade ? [sqlParameter(selectedGrade)] : [];
    const studentClause = selectedStudentId ? 'AND st.id=?' : '';
    const studentParameters = selectedStudentId ? [selectedStudentId] : [];
    const absences = querySql(`SELECT a.*, st.first_name, st.last_name, sy.grade_level
      FROM os_absences a
      JOIN os_students st ON st.id = a.student_id
      JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id = a.school_year_id AND sy.status='enrolled'
      WHERE a.school_year_id=?
        ${accessClause}
        ${gradeClause}
        ${studentClause}
      ORDER BY a.absence_date DESC, st.last_name, st.first_name
      LIMIT 80;`, [yearId, ...accessParameters, ...gradeParameters, ...studentParameters]);
    const filterParams = new URLSearchParams();
    filterParams.set('yearId', String(yearId));
    if (selectedGrade) filterParams.set('grade', selectedGrade);
    if (selectedStudentId) filterParams.set('studentId', String(selectedStudentId));
    const filterQuery = filterParams.toString();
    const listPath = `/absences${filterQuery ? `?${filterQuery}` : ''}`;
    const addPath = `/absences?action=add${filterQuery ? `&${filterQuery}` : ''}`;
    const studentOptions = students.map((student) => `<option value="${student.id}">${esc(student.last_name)}, ${esc(student.first_name)} - Grade ${esc(student.grade_level)}</option>`).join('');
    const filterStudentOptions = filteredStudentOptions.map((student) => `<option value="${student.id}" ${asInt(student.id) === selectedStudentId ? 'selected' : ''}>${esc(student.last_name)}, ${esc(student.first_name)} - Grade ${esc(student.grade_level)}</option>`).join('');
    const filters = `<form method="get" action="/absences" class="absence-header-filters">
      <input type="hidden" name="yearId" value="${yearId}" />
      <span class="absence-filter-label">Filter</span>
      <select name="grade" data-auto-submit aria-label="Filter by grade">${gradeOptionsFromRows(grades, selectedGrade)}</select>
      <select name="studentId" data-auto-submit aria-label="Filter by student"><option value="">All students</option>${filterStudentOptions}</select>
      ${selectedGrade || selectedStudentId ? `<a class="secondary-btn compact-action absence-clear-filter" href="/absences?yearId=${yearId}">Clear</a>` : ''}
    </form>`;
    const addForm = `<section class="family-detail">
      <div class="family-detail-head"><h2>Add Absence</h2><a class="secondary-btn compact-action" href="${listPath}">Cancel</a></div>
      <div class="family-detail-body">
        <form method="post" action="/absences" class="form-grid absence-form">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <label class="absence-date-field">Date<input type="date" name="absenceDate" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="absence-student-field">Student<select name="studentId" required><option value="">Choose student</option>${studentOptions}</select></label>
          <fieldset class="choice-field">
            <legend>Type</legend>
            <div class="choice-group">
              <label class="choice-pill"><input type="radio" name="kind" value="absence" checked /><span>Absence</span></label>
              <label class="choice-pill"><input type="radio" name="kind" value="tardy" /><span>Tardy</span></label>
            </div>
          </fieldset>
          <label class="absence-amount-field">Amount<input type="number" name="amount" min="0" max="30" step="0.25" value="1" required /></label>
          <fieldset class="choice-field">
            <legend>Unit</legend>
            <div class="choice-group">
              <label class="choice-pill"><input type="radio" name="unit" value="days" checked /><span>Days</span></label>
              <label class="choice-pill"><input type="radio" name="unit" value="hours" /><span>Hours</span></label>
            </div>
          </fieldset>
          <label class="absence-notes-field">Notes<textarea name="notes" maxlength="400"></textarea></label>
          <button class="absence-submit" type="submit">Save Absence</button>
        </form>
      </div>
    </section>`;
    const list = `<section class="family-detail">
      <div class="family-detail-head absence-list-head">
        <h2>Absences</h2>
        <div class="absence-list-actions">
          ${filters}
          <span class="family-count">${absences.length}</span>
          <a class="page-action compact-action" href="${addPath}">Add</a>
        </div>
      </div>
      <div class="family-detail-body">
        <div class="table-wrap compact-table"><table class="absence-table">
          <tr><th>Date</th><th>Student</th><th>Grade</th><th>Type</th><th>Amount</th><th>Notes</th></tr>
          ${absences.map((row) => `<tr>
            <td class="absence-date-cell">${esc(row.absence_date)}</td>
            <td class="absence-student-cell">${esc(row.last_name)}, ${esc(row.first_name)}</td>
            <td class="absence-grade-cell">Grade ${esc(row.grade_level || '')}</td>
            <td class="absence-kind-cell"><span class="absence-kind ${absenceKindClass(row.kind)}">${esc(formatAbsenceKind(row.kind))}</span></td>
            <td class="absence-amount-cell">${esc(formatAbsenceAmount(row))}</td>
            <td>${esc(row.notes || '') || '&mdash;'}</td>
          </tr>`).join('') || `<tr><td colspan="6">${emptyState('No absences recorded for this school year.')}</td></tr>`}
        </table></div>
      </div>
    </section>`;
    return `<div class="workspace">
      ${schoolYearHead('Absences', 'Record absences and tardies for report card attendance.', selectedYear)}
      ${action === 'add' ? addForm : list}
    </div>`;
  }

  return {
    gradebookGridView,
    gradebookPage,
    assignmentsPage,
    reportOverview,
    familiesReport,
    studentsReport,
    schoolBoardReport,
    birthdaysReport,
    gradeGraphReport,
    studentGradeGraphPanel,
    parentPage,
    reportsPage,
    reportCardsPage,
    absencesPage,
  };
}
module.exports = { createViews };
