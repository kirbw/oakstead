const { sqlParameter } = require('../input');
function createAcademicAccess({ repository, asInt, isAdmin, isParent, isPrincipal, isTeacher }) {
  const { querySql } = repository;
  function integer(value, parameters) {
    parameters.push(asInt(value));
    return '?';
  }
  function teacherStudentClause(user, yearId, alias = 'sy', parameters) {
    if (!['sy', 'os_student_years'].includes(alias)) throw new Error('Unsupported enrollment alias');
    return isTeacher(user) ? `AND ${alias}.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${integer(user.teacher_id, parameters)} AND school_year_id=${integer(yearId, parameters)})` : '';
  }

  function studentAccessClause(user, yearId, studentAlias = 'st', enrollmentAlias = 'sy', parameters) {
    if (studentAlias !== 'st' || !['sy', 'os_student_years'].includes(enrollmentAlias)) throw new Error('Unsupported student access aliases');
    if (isAdmin(user) || isPrincipal(user)) return '';
    if (isTeacher(user)) return teacherStudentClause(user, yearId, enrollmentAlias, parameters);
    if (isParent(user)) return `AND ${studentAlias}.family_id=${integer(user.parent_family_id, parameters)}`;
    return 'AND 1=0';
  }

  function canViewStudent(user, studentId, yearId) {
    if (isAdmin(user) || isPrincipal(user)) return true;
    if (!studentId || !yearId) return false;
    if (isTeacher(user)) {
      const rows = querySql(`SELECT sy.student_id
        FROM os_student_years sy
        JOIN os_classrooms c ON c.id = sy.classroom_id
        WHERE sy.student_id=?
          AND sy.school_year_id=?
          AND sy.status='enrolled'
          AND c.teacher_id=?
        LIMIT 1;`, [asInt(studentId), asInt(yearId), asInt(user.teacher_id)]);
      return Boolean(rows.length);
    }
    if (isParent(user)) {
      const rows = querySql(`SELECT st.id
        FROM os_students st
        JOIN os_student_years sy ON sy.student_id = st.id
        WHERE st.id=?
          AND st.family_id=?
          AND sy.school_year_id=?
          AND sy.status='enrolled'
        LIMIT 1;`, [asInt(studentId), asInt(user.parent_family_id), asInt(yearId)]);
      return Boolean(rows.length);
    }
    return false;
  }

  function canModifyStudentAcademicRecord(user, studentId, yearId) {
    if (isAdmin(user) || isPrincipal(user)) return true;
    if (!isTeacher(user)) return false;
    return canViewStudent(user, studentId, yearId);
  }

  // Bulk equivalent of canModifyStudentAcademicRecord: one query instead of one
  // per student. Returns null when every student is allowed.

  function modifiableStudentIdSet(user, yearId) {
    if (isAdmin(user) || isPrincipal(user)) return null;
    if (!isTeacher(user)) return new Set();
    const parameters = [asInt(yearId)];
    const rows = querySql(`SELECT sy.student_id
      FROM os_student_years sy
      WHERE sy.school_year_id=?
        AND sy.status='enrolled'
        ${teacherStudentClause(user, yearId, 'sy', parameters)};`, parameters);
    return new Set(rows.map((row) => asInt(row.student_id)));
  }

  function setAllowsStudent(allowedIds, studentId) {
    return !allowedIds || allowedIds.has(asInt(studentId));
  }

  function assignmentAccessClause(user, yearId, parameters) {
    return isTeacher(user) ? `AND a.grade_level IN
      (SELECT cg.grade_level FROM os_classroom_grades cg JOIN os_classrooms c ON c.id=cg.classroom_id
        WHERE c.school_year_id=${integer(yearId, parameters)} AND c.teacher_id=${integer(user.teacher_id, parameters)})
      AND (a.classroom_id IS NULL OR a.classroom_id IN
      (SELECT id FROM os_classrooms WHERE school_year_id=${integer(yearId, parameters)} AND teacher_id=${integer(user.teacher_id, parameters)}))` : '';
  }

  function authorizedAssignments(user, yearId, grade, subjectId, assignmentIds) {
    const ids = [...new Set(assignmentIds.map((id) => asInt(id)))];
    if (!ids.length) return new Map();
    const parameters = [...ids, asInt(yearId), sqlParameter(grade), asInt(subjectId)];
    const rows = querySql(`SELECT a.* FROM os_assignments a
      WHERE a.id IN (${ids.map(() => '?').join(',')}) AND a.school_year_id=?
        AND a.grade_level=? AND a.subject_id=?
        ${assignmentAccessClause(user, yearId, parameters)};`, parameters);
    if (!teacherAllowedForSelection(user, yearId, grade) || rows.length !== ids.length) {
      throw Object.assign(new Error('Assignment is not accessible for this selection.'), { statusCode: 403 });
    }
    return new Map(rows.map((row) => [asInt(row.id), row]));
  }

  function requireScoreStudents(user, yearId, grade, studentIds) {
    const ids = [...new Set(studentIds.map((id) => asInt(id)))];
    if (!ids.length) return;
    const parameters = [asInt(yearId), sqlParameter(grade), ...ids];
    const rows = querySql(`SELECT st.id FROM os_students st
      JOIN os_student_years sy ON sy.student_id=st.id
      WHERE sy.school_year_id=? AND sy.grade_level=?
        AND sy.status='enrolled' AND st.id IN (${ids.map(() => '?').join(',')})
        ${studentAccessClause(user, yearId, 'st', 'sy', parameters)};`, parameters);
    if (rows.length !== ids.length) {
      throw Object.assign(new Error('Student is not accessible for this selection.'), { statusCode: 403 });
    }
  }

  function teacherAllowedForSelection(user, yearId, grade, classroomId = 0) {
    if (!user) return false;
    if (isAdmin(user) || isPrincipal(user)) return true;
    if (!isTeacher(user)) return false;
    if (!user.teacher_id) return false;
    const parameters = [asInt(yearId), asInt(user.teacher_id), sqlParameter(grade)];
    const roomClause = classroomId ? 'AND c.id=?' : '';
    if (classroomId) parameters.push(asInt(classroomId));
    const rows = querySql(`SELECT c.id
      FROM os_classrooms c
      JOIN os_classroom_grades cg ON cg.classroom_id = c.id
      WHERE c.school_year_id=?
        AND c.teacher_id=?
        AND cg.grade_level=?
        ${roomClause}
      LIMIT 1;`, parameters);
    return Boolean(rows.length);
  }

  return {
    teacherStudentClause,
    studentAccessClause,
    canViewStudent,
    canModifyStudentAcademicRecord,
    modifiableStudentIdSet,
    setAllowsStudent,
    assignmentAccessClause,
    authorizedAssignments,
    requireScoreStudents,
    teacherAllowedForSelection,
  };
}
module.exports = { createAcademicAccess };
