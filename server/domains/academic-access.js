function createAcademicAccess({ repository, asInt, isAdmin, isParent, isPrincipal, isTeacher, sqlValue }) {
  const { querySql } = repository;
  function teacherStudentClause(user, yearId, alias = 'sy') {
    return isTeacher(user) ? `AND ${alias}.classroom_id IN (SELECT id FROM os_classrooms WHERE teacher_id=${asInt(user.teacher_id)} AND school_year_id=${asInt(yearId)})` : '';
  }

  function studentAccessClause(user, yearId, studentAlias = 'st', enrollmentAlias = 'sy') {
    if (isAdmin(user) || isPrincipal(user)) return '';
    if (isTeacher(user)) return teacherStudentClause(user, yearId, enrollmentAlias);
    if (isParent(user)) return `AND ${studentAlias}.family_id=${asInt(user.parent_family_id)}`;
    return 'AND 1=0';
  }

  function canViewStudent(user, studentId, yearId) {
    if (isAdmin(user) || isPrincipal(user)) return true;
    if (!studentId || !yearId) return false;
    if (isTeacher(user)) {
      const rows = querySql(`SELECT sy.student_id
        FROM os_student_years sy
        JOIN os_classrooms c ON c.id = sy.classroom_id
        WHERE sy.student_id=${asInt(studentId)}
          AND sy.school_year_id=${asInt(yearId)}
          AND sy.status='enrolled'
          AND c.teacher_id=${asInt(user.teacher_id)}
        LIMIT 1;`);
      return Boolean(rows.length);
    }
    if (isParent(user)) {
      const rows = querySql(`SELECT st.id
        FROM os_students st
        JOIN os_student_years sy ON sy.student_id = st.id
        WHERE st.id=${asInt(studentId)}
          AND st.family_id=${asInt(user.parent_family_id)}
          AND sy.school_year_id=${asInt(yearId)}
          AND sy.status='enrolled'
        LIMIT 1;`);
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
    const rows = querySql(`SELECT sy.student_id
      FROM os_student_years sy
      WHERE sy.school_year_id=${asInt(yearId)}
        AND sy.status='enrolled'
        ${teacherStudentClause(user, yearId, 'sy')};`);
    return new Set(rows.map((row) => asInt(row.student_id)));
  }

  function setAllowsStudent(allowedIds, studentId) {
    return !allowedIds || allowedIds.has(asInt(studentId));
  }

  function assignmentAccessClause(user, yearId) {
    return isTeacher(user) ? `AND a.grade_level IN
      (SELECT cg.grade_level FROM os_classroom_grades cg JOIN os_classrooms c ON c.id=cg.classroom_id
        WHERE c.school_year_id=${asInt(yearId)} AND c.teacher_id=${asInt(user.teacher_id)})
      AND (a.classroom_id IS NULL OR a.classroom_id IN
      (SELECT id FROM os_classrooms WHERE school_year_id=${asInt(yearId)} AND teacher_id=${asInt(user.teacher_id)}))` : '';
  }

  function authorizedAssignments(user, yearId, grade, subjectId, assignmentIds) {
    const ids = [...new Set(assignmentIds.map((id) => asInt(id)))];
    if (!ids.length) return new Map();
    const rows = querySql(`SELECT a.* FROM os_assignments a
      WHERE a.id IN (${ids.join(',')}) AND a.school_year_id=${asInt(yearId)}
        AND a.grade_level=${sqlValue(grade)} AND a.subject_id=${asInt(subjectId)}
        ${assignmentAccessClause(user, yearId)};`);
    if (!teacherAllowedForSelection(user, yearId, grade) || rows.length !== ids.length) {
      throw Object.assign(new Error('Assignment is not accessible for this selection.'), { statusCode: 403 });
    }
    return new Map(rows.map((row) => [asInt(row.id), row]));
  }

  function requireScoreStudents(user, yearId, grade, studentIds) {
    const ids = [...new Set(studentIds.map((id) => asInt(id)))];
    if (!ids.length) return;
    const rows = querySql(`SELECT st.id FROM os_students st
      JOIN os_student_years sy ON sy.student_id=st.id
      WHERE sy.school_year_id=${asInt(yearId)} AND sy.grade_level=${sqlValue(grade)}
        AND sy.status='enrolled' AND st.id IN (${ids.join(',')})
        ${studentAccessClause(user, yearId)};`);
    if (rows.length !== ids.length) {
      throw Object.assign(new Error('Student is not accessible for this selection.'), { statusCode: 403 });
    }
  }

  function teacherAllowedForSelection(user, yearId, grade, classroomId = 0) {
    if (!user) return false;
    if (isAdmin(user) || isPrincipal(user)) return true;
    if (!isTeacher(user)) return false;
    if (!user.teacher_id) return false;
    const roomClause = classroomId ? `AND c.id=${asInt(classroomId)}` : '';
    const rows = querySql(`SELECT c.id
      FROM os_classrooms c
      JOIN os_classroom_grades cg ON cg.classroom_id = c.id
      WHERE c.school_year_id=${asInt(yearId)}
        AND c.teacher_id=${asInt(user.teacher_id)}
        AND cg.grade_level=${sqlValue(grade)}
        ${roomClause}
      LIMIT 1;`);
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
