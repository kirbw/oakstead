const { sqlParameter } = require('../input');
const { text, json, redirectTo } = require('./results');
const { createTransactionalService } = require('./service');
const { schoolDateRange } = require('../dates');

function createAcademicsService(deps) {
  const {
    repository,
    CATEGORIES,
    DEFAULT_LETTER_GRADES,
    ROLE_TEACHER,
    appendSetCookie,
    asInt,
    asPoints,
    authorizedAssignments,
    canManageAcademicRecords,
    canManageSchoolSetup,
    canModifyStudentAcademicRecord,
    cleanDate,
    cleanGrade,
    cleanScoreMode,
    cleanText,
    cookieValue,
    createDefaultWeightGroups,
    createMarkingPeriods,
    formArray,
    gradebookDisplayScore,
    gradebookLetter,
    gradebookRedirectUrl,
    gridScoreEntries,
    letterGradeScale,
    markingPeriodStatements,
    normalizeCategory,
    parseGrades,
    parseScoreChanges,
    parseScoreInput,
    periodAverageRows,
    promoteGrade,
    reportDataIntegrity,
    requireScoreStudents,
    runSqlBatch,
    scoreFieldEntries,
    scoreWriteStatements,
    studentAccessClause,
    teacherAllowedForSelection,
  } = deps;
  const { querySql, runSql, executeSql, insertReturningId } = repository;
  return createTransactionalService(["/enrollments","/absences","/classrooms","/subjects","/grade-subjects","/school-years","/marking-periods","/promote-year","/grade-weights","/letter-grades","/gradebook","/assignments"], (p, body, user, headers) => {
    if (p === '/enrollments') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      executeSql(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id, status)
        VALUES (?, ?, ?, ?, 'enrolled')
        ON CONFLICT(student_id, school_year_id) DO UPDATE SET grade_level=excluded.grade_level, classroom_id=excluded.classroom_id, status=excluded.status;`, [asInt(body.studentId), asInt(body.schoolYearId), sqlParameter(cleanGrade(body.gradeLevel)), asInt(body.classroomId) || null]);
      const family = querySql(`SELECT family_id FROM os_students WHERE id=? LIMIT 1;`, [asInt(body.studentId)])[0];
      return redirectTo(`/setup?section=families&familyId=${asInt(family?.family_id)}`, headers);
    }

    if (p === '/absences') {
      if (!canManageAcademicRecords(user)) return text(403, 'Forbidden');
      if (!canModifyStudentAcademicRecord(user, asInt(body.studentId), asInt(body.schoolYearId))) return text(403, 'Forbidden');
      const kind = cleanText(body.kind, 20).toLowerCase() === 'tardy' ? 'tardy' : 'absence';
      const unit = cleanText(body.unit, 20).toLowerCase() === 'hours' ? 'hours' : 'days';
      const amount = Math.max(0, Math.min(30, Number(body.amount) || 0));
      executeSql(`INSERT INTO os_absences (school_year_id, student_id, absence_date, kind, amount, unit, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?);`, [asInt(body.schoolYearId), asInt(body.studentId), sqlParameter(cleanDate(body.absenceDate)), sqlParameter(kind), amount, sqlParameter(unit), sqlParameter(cleanText(body.notes, 400))]);
      return redirectTo('/absences', headers);
    }

    if (p === '/classrooms') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const classroomId = asInt(body.classroomId) || insertReturningId(`INSERT INTO os_classrooms (school_year_id, name, teacher_id)
        VALUES (?, ?, ?)`, [asInt(body.schoolYearId), sqlParameter(cleanText(body.name, 120)), asInt(body.teacherId) || null]);
      if (asInt(body.classroomId)) {
        executeSql(`UPDATE os_classrooms
          SET school_year_id=?,
              name=?,
              teacher_id=?
          WHERE id=?;`, [asInt(body.schoolYearId), sqlParameter(cleanText(body.name, 120)), asInt(body.teacherId) || null, classroomId]);
        executeSql(`DELETE FROM os_classroom_grades WHERE classroom_id=?;`, [classroomId]);
      }
      parseGrades(body.grades).forEach((grade) => {
        executeSql(`INSERT OR IGNORE INTO os_classroom_grades (classroom_id, grade_level)
          VALUES (?, ?);`, [classroomId, sqlParameter(grade)]);
      });
      return redirectTo('/setup?section=classrooms', headers);
    }

    if (p === '/subjects') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      let subjectId = asInt(body.subjectId);
      const schoolYearId = asInt(body.schoolYearId);
      const subjectName = cleanText(body.name, 120);
      if (subjectId) {
        executeSql(`UPDATE os_subjects SET name=? WHERE id=?;`, [sqlParameter(subjectName), subjectId]);
      } else {
        subjectId = insertReturningId(`INSERT INTO os_subjects (name) VALUES (?)
          ON CONFLICT(name) DO UPDATE SET name=excluded.name`, [sqlParameter(subjectName)]);
      }
      if (schoolYearId && subjectId) {
        executeSql(`DELETE FROM os_grade_subjects WHERE school_year_id=? AND subject_id=?;`, [schoolYearId, subjectId]);
        formArray(body.grades).map(cleanGrade).filter(Boolean).forEach((grade) => {
          executeSql(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id)
            VALUES (?, ?, ?);`, [schoolYearId, sqlParameter(grade), subjectId]);
        });
      }
      return redirectTo('/setup?section=subjects', headers);
    }

    if (p === '/grade-subjects') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      executeSql(`INSERT OR IGNORE INTO os_grade_subjects (school_year_id, grade_level, subject_id)
        VALUES (?, ?, ?);`, [asInt(body.schoolYearId), sqlParameter(cleanGrade(body.gradeLevel)), asInt(body.subjectId)]);
      return redirectTo('/setup?section=subjects', headers);
    }

    if (p === '/school-years') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const { startDate, endDate } = schoolDateRange(body.startDate, body.endDate);
      const existingYearId = asInt(body.yearId);
      if (String(body.makeActive) === '1') runSql('UPDATE os_school_years SET is_active=0;');
      if (existingYearId) {
        executeSql(`UPDATE os_school_years
          SET name=?,
              start_date=?,
              end_date=?,
              is_active=?
          WHERE id=?;`, [sqlParameter(cleanText(body.name, 40)), sqlParameter(startDate), sqlParameter(endDate), String(body.makeActive) === '1' ? 1 : 0, existingYearId]);
        if (String(body.makeActive) === '1') {
          appendSetCookie(headers, `selectedYearId=${cookieValue(existingYearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
        }
        return redirectTo('/setup?section=years', headers);
      }
      const yearId = insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
        VALUES (?, ?, ?, ?)`, [sqlParameter(cleanText(body.name, 40)), sqlParameter(startDate), sqlParameter(endDate), String(body.makeActive) === '1' ? 1 : 0]);
      createMarkingPeriods(yearId, 6, startDate, endDate);
      createDefaultWeightGroups(yearId);
      appendSetCookie(headers, `selectedYearId=${cookieValue(yearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      return redirectTo('/setup?section=years', headers);
    }

    if (p === '/marking-periods') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const schoolDays = Math.max(1, Math.min(260, asInt(body.schoolDays) || 180));
      const periodCount = Math.max(1, Math.min(12, asInt(body.periodCount) || 6));
      const { startDate, endDate } = schoolDateRange(body.startDate, body.endDate);
      repository.transaction(() => {
        const referenced = querySql(`SELECT p.period_number FROM os_marking_periods p
          JOIN os_assignments a ON a.marking_period_id=p.id
          WHERE p.school_year_id=? AND p.period_number>? LIMIT 1;`, [schoolYearId, periodCount])[0];
        if (referenced) throw Object.assign(new Error(`Period ${referenced.period_number} has assignments. Move those assignments before reducing the period count.`), { statusCode: 409 });
        executeSql(`UPDATE os_school_years SET school_days=?, start_date=?, end_date=? WHERE id=?;`, [schoolDays, sqlParameter(startDate), sqlParameter(endDate), schoolYearId]);
        executeSql(`DELETE FROM os_marking_periods WHERE school_year_id=? AND period_number>?;`, [schoolYearId, periodCount]);
        runSqlBatch(markingPeriodStatements(schoolYearId, periodCount, startDate, endDate));
      });
      reportDataIntegrity();
      return redirectTo('/setup?section=years', headers);
    }

    if (p === '/promote-year') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const { startDate, endDate } = schoolDateRange(body.startDate, body.endDate);
      const fromYearId = asInt(body.fromYearId);
      if (String(body.makeActive) === '1') runSql('UPDATE os_school_years SET is_active=0;');
      const newYearId = insertReturningId(`INSERT INTO os_school_years (name, start_date, end_date, is_active)
        VALUES (?, ?, ?, ?)`, [sqlParameter(cleanText(body.name, 40)), sqlParameter(startDate), sqlParameter(endDate), String(body.makeActive) === '1' ? 1 : 0]);
      createMarkingPeriods(newYearId, 6, startDate, endDate);
      createDefaultWeightGroups(newYearId);
      const enrollments = querySql(`SELECT student_id, grade_level FROM os_student_years WHERE school_year_id=? AND status='enrolled';`, [fromYearId]);
      enrollments.forEach((enrollment) => {
        executeSql(`INSERT OR IGNORE INTO os_student_years (student_id, school_year_id, grade_level, status)
          VALUES (?, ?, ?, 'enrolled');`, [asInt(enrollment.student_id), newYearId, sqlParameter(promoteGrade(enrollment.grade_level))]);
      });
      appendSetCookie(headers, `selectedYearId=${cookieValue(newYearId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      return redirectTo('/setup?section=years', headers);
    }

    if (p === '/grade-weights') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const groupId = asInt(body.weightGroupId);
      const name = cleanText(body.name, 120) || 'Grade Weight Group';
      const minGrade = cleanGrade(body.minGrade);
      const maxGrade = cleanGrade(body.maxGrade);
      const subjectId = asInt(body.subjectId);
      const roundingMode = cleanText(body.roundingMode, 40) || 'nearest';
      const calculationMode = cleanText(body.calculationMode, 40) || 'weighted';
      const savedGroupId = groupId || insertReturningId(`INSERT INTO os_grade_weight_groups (school_year_id, name, min_grade, max_grade, subject_id, rounding_mode, calculation_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [schoolYearId, sqlParameter(name), sqlParameter(minGrade), sqlParameter(maxGrade), subjectId || null, sqlParameter(roundingMode), sqlParameter(calculationMode)]);
      if (groupId) {
        executeSql(`UPDATE os_grade_weight_groups
          SET name=?,
              min_grade=?,
              max_grade=?,
              subject_id=?,
              rounding_mode=?,
              calculation_mode=?
          WHERE id=?;`, [sqlParameter(name), sqlParameter(minGrade), sqlParameter(maxGrade), subjectId || null, sqlParameter(roundingMode), sqlParameter(calculationMode), groupId]);
        executeSql(`DELETE FROM os_grade_weight_items WHERE group_id=?;`, [groupId]);
      }
      CATEGORIES.forEach((category) => {
        const weight = Number(body[`weight_${category}`]);
        if (!Number.isFinite(weight) || weight <= 0) return;
        executeSql(`INSERT INTO os_grade_weight_items (group_id, category, weight)
          VALUES (?, ?, ?);`, [savedGroupId, sqlParameter(category), Math.max(0, Math.min(100, weight))]);
      });
      return redirectTo('/setup?section=weights', headers);
    }

    if (p === '/letter-grades') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const groupId = asInt(body.letterGroupId);
      const name = cleanText(body.name, 120) || 'Letter Grades';
      const subjectId = asInt(body.subjectId);
      const minGrade = cleanGrade(body.minGrade) || '1';
      const maxGrade = cleanGrade(body.maxGrade) || '12';
      const savedGroupId = groupId || insertReturningId(`INSERT INTO os_letter_grade_groups (school_year_id, name, min_grade, max_grade, subject_id)
        VALUES (?, ?, ?, ?, ?)`, [schoolYearId, sqlParameter(name), sqlParameter(minGrade), sqlParameter(maxGrade), subjectId || null]);
      if (groupId) {
        executeSql(`UPDATE os_letter_grade_groups
          SET name=?,
              min_grade=?,
              max_grade=?,
              subject_id=?
          WHERE id=?;`, [sqlParameter(name), sqlParameter(minGrade), sqlParameter(maxGrade), subjectId || null, groupId]);
        executeSql(`DELETE FROM os_letter_grade_items WHERE group_id=?;`, [groupId]);
      }
      Object.keys(body)
        .filter((key) => /^letter_\d+$/.test(key))
        .map((key) => Number(key.replace('letter_', '')))
        .sort((a, b) => a - b)
        .forEach((index) => {
          const letter = cleanText(body[`letter_${index}`], 12);
          const threshold = Number(body[`threshold_${index}`]);
          if (!letter || !Number.isFinite(threshold)) return;
          executeSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
            VALUES (?, ?, ?, ?);`, [savedGroupId, sqlParameter(letter), Math.max(0, Math.min(100, threshold)), index]);
        });
      const itemCount = querySql(`SELECT COUNT(*) AS count FROM os_letter_grade_items WHERE group_id=?;`, [savedGroupId])[0]?.count || 0;
      if (!itemCount) {
        DEFAULT_LETTER_GRADES.forEach(([letter, threshold], index) => {
          executeSql(`INSERT INTO os_letter_grade_items (group_id, letter, threshold, sort_order)
            VALUES (?, ?, ?, ?);`, [savedGroupId, sqlParameter(letter), Number(threshold), index]);
        });
      }
      return redirectTo('/setup?section=letter-grades', headers);
    }

    if (p === '/gradebook') {
      if (!canManageAcademicRecords(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const markingPeriodId = asInt(body.markingPeriodId);
      if (markingPeriodId && !querySql(`SELECT id FROM os_marking_periods WHERE id=? AND school_year_id=?;`, [markingPeriodId, schoolYearId]).length) return text(400, 'The marking period does not belong to this school year.');
      const gradeLevel = cleanGrade(body.gradeLevel);
      const subjectId = asInt(body.subjectId);
      const existingAssignmentId = asInt(body.assignmentId);
      const scoreMode = cleanScoreMode(body.scoreMode);
      if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel)) return text(403, 'Forbidden');
      const gridRedirectTo = gradebookRedirectUrl({
        schoolYearId,
        markingPeriodId,
        gradeLevel,
        subjectId,
        scoreMode,
        gridMode: 'on'
      });
      if (body.action === 'grid-score') {
        const assignmentId = asInt(body.assignmentId);
        const studentId = asInt(body.studentId);
        const assignment = authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [assignmentId]).get(assignmentId);
        requireScoreStudents(user, schoolYearId, gradeLevel, [studentId]);
        const maxScore = asPoints(assignment.max_score);
        const parsed = parseScoreInput(body.scoreValue, scoreMode, maxScore);
        if (parsed.kind === 'invalid') return json(400, { ok: false, error: 'Invalid score' }, headers);
        runSqlBatch(scoreWriteStatements([{ assignmentId, studentId, ...parsed }]));
        const stored = querySql(`SELECT score FROM os_scores WHERE assignment_id=? AND student_id=?;`, [assignmentId, studentId])[0];
        const percent = stored?.score == null ? null : (stored.score / maxScore) * 100;
        const scale = letterGradeScale(schoolYearId, gradeLevel, subjectId);
        const period = querySql(`SELECT * FROM os_marking_periods WHERE id=? AND school_year_id=? LIMIT 1;`, [markingPeriodId, schoolYearId])[0] || null;
        const assignmentAverage = querySql(`SELECT ROUND(AVG(CASE WHEN sc.score IS NULL THEN NULL ELSE (sc.score / NULLIF(a.max_score, 0)) * 100 END), 1) AS avg_score
          FROM os_assignments a
          LEFT JOIN os_scores sc ON sc.assignment_id = a.id
          WHERE a.id=?;`, [assignmentId])[0]?.avg_score ?? null;
        const studentParameters = [schoolYearId, sqlParameter(gradeLevel)];
        const studentIds = querySql(`SELECT student_id FROM os_student_years
          JOIN os_students st ON st.id = os_student_years.student_id
          WHERE school_year_id=?
            AND grade_level=?
            AND status='enrolled'
            ${studentAccessClause(user, schoolYearId, 'st', 'os_student_years', studentParameters)};`, studentParameters).map((row) => asInt(row.student_id)).filter(Boolean);
        const averageData = periodAverageRows(schoolYearId, gradeLevel, subjectId, studentIds, period);
        const studentAverage = averageData.studentAverages.get(studentId);
        return json(200, {
          ok: true,
          assignmentId,
          studentId,
          percent,
          letter: gradebookLetter(percent, scale),
          display: {
            assignmentAverage: gradebookDisplayScore(assignmentAverage, scale),
            studentAverage: gradebookDisplayScore(studentAverage, scale),
            classAverage: gradebookDisplayScore(averageData.classAverage, scale)
          }
        }, headers);
      }
      if (body.action === 'update-assignment') {
        const assignmentId = asInt(body.assignmentId);
        authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [assignmentId]);
        if (body.deleteAssignment) {
          executeSql(`DELETE FROM os_assignments WHERE id=?;`, [assignmentId]);
          return redirectTo(gridRedirectTo, headers);
        }
        executeSql(`UPDATE os_assignments
          SET title=?,
              category=?,
              assignment_date=?,
              max_score=?
          WHERE id=?;`, [sqlParameter(cleanText(body.title, 140)), sqlParameter(normalizeCategory(body.category)), sqlParameter(cleanDate(body.assignmentDate)), asPoints(body.maxScore), assignmentId]);
        return redirectTo(gridRedirectTo, headers);
      }
      if (body.action === 'add-assignment') {
        const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : null;
        const maxScore = asPoints(body.maxScore);
        insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, marking_period_id, title, category, assignment_date, max_score, teacher_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [schoolYearId, sqlParameter(gradeLevel), subjectId, markingPeriodId || null, sqlParameter(cleanText(body.title, 140)), sqlParameter(normalizeCategory(body.category)), sqlParameter(cleanDate(body.assignmentDate)), maxScore, teacherId]);
        return redirectTo(gridRedirectTo, headers);
      }
      if (body.action === 'grid-scores') {
        if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
        const scoreEntries = gridScoreEntries(body);
        const assignmentIds = new Set(scoreEntries.map((entry) => asInt(entry.assignmentId)));
        const submittedStudentIds = scoreEntries.map((entry) => asInt(entry.studentId)).filter(Boolean);
        requireScoreStudents(user, schoolYearId, gradeLevel, submittedStudentIds);
        const allowedAssignments = new Map([...authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [...assignmentIds])]
          .map(([id, row]) => [id, asPoints(row.max_score)]));
        const changes = parseScoreChanges(body, scoreEntries, scoreMode, (entry) => allowedAssignments.get(entry.assignmentId));
        runSqlBatch(scoreWriteStatements(changes));
        return redirectTo(gridRedirectTo, headers);
      }
      const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : null;
      const maxScore = existingAssignmentId
        ? asPoints(authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [existingAssignmentId]).get(existingAssignmentId).max_score)
        : asPoints(body.maxScore);
      if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      const scoreEntries = scoreFieldEntries(body);
      requireScoreStudents(user, schoolYearId, gradeLevel, scoreEntries.map((entry) => entry.studentId));
      const changes = parseScoreChanges(body, scoreEntries, scoreMode, () => maxScore);
      const assignmentId = existingAssignmentId || insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, marking_period_id, title, category, assignment_date, max_score, teacher_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [schoolYearId, sqlParameter(gradeLevel), subjectId, markingPeriodId || null, sqlParameter(cleanText(body.title, 140)), sqlParameter(normalizeCategory(body.category)), sqlParameter(cleanDate(body.assignmentDate)), maxScore, teacherId]);
      runSqlBatch(scoreWriteStatements(changes, assignmentId));
      return redirectTo(gradebookRedirectUrl({
        schoolYearId,
        markingPeriodId,
        gradeLevel,
        subjectId,
        scoreMode,
        assignmentId,
        gridMode: body.gridMode
      }), headers);
    }

    if (p === '/assignments') {
      if (!canManageAcademicRecords(user)) return text(403, 'Forbidden');
      const action = body.action;
      const schoolYearId = asInt(body.schoolYearId);
      const gradeLevel = cleanGrade(body.gradeLevel);
      const subjectId = asInt(body.subjectId);
      if (!teacherAllowedForSelection(user, schoolYearId, gradeLevel)) return text(403, 'Forbidden');
      const baseRedirect = `/assignments?yearId=${schoolYearId}&grade=${encodeURIComponent(gradeLevel)}&subjectId=${subjectId}`;

      if (action === 'add') {
        const teacherId = user.role === ROLE_TEACHER ? asInt(user.teacher_id) : null;
        const maxScore = asPoints(body.maxScore);
        const newId = insertReturningId(`INSERT INTO os_assignments (school_year_id, grade_level, subject_id, title, category, assignment_date, max_score, teacher_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [schoolYearId, sqlParameter(gradeLevel), subjectId, sqlParameter(cleanText(body.title, 140)), sqlParameter(normalizeCategory(body.category)), sqlParameter(cleanDate(body.assignmentDate)), maxScore, teacherId]);
        return redirectTo(`${baseRedirect}&assignmentId=${newId}`, headers);
      }

      if (action === 'update') {
        const assignmentId = asInt(body.assignmentId);
        authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [assignmentId]);
        const maxScore = asPoints(body.maxScore);
        executeSql(`UPDATE os_assignments SET title=?, category=?, assignment_date=?, max_score=? WHERE id=? AND school_year_id=?;`, [sqlParameter(cleanText(body.title, 140)), sqlParameter(normalizeCategory(body.category)), sqlParameter(cleanDate(body.assignmentDate)), maxScore, assignmentId, schoolYearId]);
        return redirectTo(`${baseRedirect}&assignmentId=${assignmentId}`, headers);
      }

      if (action === 'scores') {
        const assignmentId = asInt(body.assignmentId);
        const scoreMode = cleanScoreMode(body.scoreMode);
        const maxScore = asPoints(authorizedAssignments(user, schoolYearId, gradeLevel, subjectId, [assignmentId]).get(assignmentId).max_score);
        const scoreEntries = scoreFieldEntries(body);
        requireScoreStudents(user, schoolYearId, gradeLevel, scoreEntries.map((entry) => entry.studentId));
        const changes = parseScoreChanges(body, scoreEntries, scoreMode, () => maxScore);
        runSqlBatch(scoreWriteStatements(changes, assignmentId));
        return redirectTo(`${baseRedirect}&mode=${scoreMode}&assignmentId=${assignmentId}`, headers);
      }

      return text(400, 'Bad Request');
    }

    return text(404, 'Not Found');
  }, repository, deps.history);
}
module.exports = { createAcademicsService };
