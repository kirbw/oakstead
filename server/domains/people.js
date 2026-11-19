const { sqlParameter } = require('../input');
const { text, json, redirectTo } = require('./results');
const { createTransactionalService } = require('./service');

function createPeopleService(deps) {
  const { repository, asInt, canManageSchoolSetup, cleanDate, cleanGender, cleanGrade, cleanPersonRoleType, cleanText, firstNameOnly, sqlValue } = deps;
  const { querySql, runSql, executeSql, insertReturningId } = repository;
  return createTransactionalService(["/families","/school-districts","/congregations","/students","/emergency-contacts","/teachers","/person-roles"], (p, body, user, headers) => {
    if (p === '/families') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const familyId = asInt(body.familyId);
      if (familyId) {
        executeSql(`UPDATE os_families
          SET family_name=?,
              school_district_id=?,
              congregation_id=?,
              father_name=?,
              mother_name=?,
              father_phone=?,
              mother_phone=?,
              phone=?,
              email=?,
              address=?
          WHERE id=?;`, [sqlParameter(cleanText(body.familyName, 120)), asInt(body.schoolDistrictId) || null, asInt(body.congregationId) || null, sqlParameter(firstNameOnly(body.fatherName)), sqlParameter(firstNameOnly(body.motherName)), sqlParameter(cleanText(body.fatherPhone, 40)), sqlParameter(cleanText(body.motherPhone, 40)), sqlParameter(cleanText(body.fatherPhone, 40)), sqlParameter(cleanText(body.email, 160)), sqlParameter(cleanText(body.address, 220)), familyId]);
        return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
      }
      const newFamilyId = insertReturningId(`INSERT INTO os_families (family_name, school_district_id, congregation_id, father_name, mother_name, father_phone, mother_phone, phone, email, address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [sqlParameter(cleanText(body.familyName, 120)), asInt(body.schoolDistrictId) || null, asInt(body.congregationId) || null, sqlParameter(firstNameOnly(body.fatherName)), sqlParameter(firstNameOnly(body.motherName)), sqlParameter(cleanText(body.fatherPhone, 40)), sqlParameter(cleanText(body.motherPhone, 40)), sqlParameter(cleanText(body.fatherPhone, 40)), sqlParameter(cleanText(body.email, 160)), sqlParameter(cleanText(body.address, 220))]);
      return redirectTo(`/setup?section=families&familyId=${newFamilyId}`, headers);
    }

    if (p === '/school-districts') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const districtId = asInt(body.districtId);
      if (districtId) {
        executeSql(`UPDATE os_school_districts SET name=? WHERE id=?;`, [sqlParameter(cleanText(body.name, 140)), districtId]);
        return redirectTo('/setup?section=districts', headers);
      }
      executeSql(`INSERT OR IGNORE INTO os_school_districts (name) VALUES (?);`, [sqlParameter(cleanText(body.name, 140))]);
      return redirectTo('/setup?section=districts', headers);
    }

    if (p === '/congregations') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const congregationId = asInt(body.congregationId);
      if (congregationId) {
        executeSql(`UPDATE os_congregations SET name=? WHERE id=?;`, [sqlParameter(cleanText(body.name, 140)), congregationId]);
        return redirectTo('/setup?section=congregations', headers);
      }
      executeSql(`INSERT OR IGNORE INTO os_congregations (name) VALUES (?);`, [sqlParameter(cleanText(body.name, 140))]);
      return redirectTo('/setup?section=congregations', headers);
    }

    if (p === '/students') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const existingStudentId = asInt(body.studentId);
      if (existingStudentId) {
        executeSql(`UPDATE os_students
          SET first_name=?,
              middle_name=?,
              last_name=?,
              birth_date=?,
              gender=?
          WHERE id=? AND family_id=?;`, [sqlParameter(cleanText(body.firstName, 80)), sqlParameter(cleanText(body.middleName, 80)), sqlParameter(cleanText(body.lastName, 80)), sqlParameter(cleanDate(body.birthDate)), sqlParameter(cleanGender(body.gender)), existingStudentId, asInt(body.familyId)]);
        executeSql(`UPDATE os_student_years
          SET classroom_id=?
          WHERE student_id=? AND school_year_id=?;`, [asInt(body.classroomId) || null, existingStudentId, schoolYearId]);
        return redirectTo(`/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
      }
      const studentId = insertReturningId(`INSERT INTO os_students (family_id, first_name, middle_name, last_name, birth_date, gender)
        VALUES (?, ?, ?, ?, ?, ?)`, [asInt(body.familyId), sqlParameter(cleanText(body.firstName, 80)), sqlParameter(cleanText(body.middleName, 80)), sqlParameter(cleanText(body.lastName, 80)), sqlParameter(cleanDate(body.birthDate)), sqlParameter(cleanGender(body.gender))]);
      executeSql(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id)
        VALUES (?, ?, ?, ?);`, [studentId, schoolYearId, sqlParameter(cleanGrade(body.gradeLevel)), asInt(body.classroomId) || null]);
      return redirectTo(`/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
    }

    if (p === '/emergency-contacts') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const familyId = asInt(body.familyId);
      const contactId = asInt(body.contactId);
      const priority = Math.max(1, Math.min(20, asInt(body.priority) || 1));
      if (contactId) {
        executeSql(`UPDATE os_emergency_contacts
          SET priority=?,
              name=?,
              relationship=?,
              phone=?,
              notes=?
          WHERE id=? AND family_id=?;`, [priority, sqlParameter(cleanText(body.name, 120)), sqlParameter(cleanText(body.relationship, 80)), sqlParameter(cleanText(body.phone, 40)), sqlParameter(cleanText(body.notes, 400)), contactId, familyId]);
        return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
      }
      executeSql(`INSERT INTO os_emergency_contacts (family_id, priority, name, relationship, phone, notes)
        VALUES (?, ?, ?, ?, ?, ?);`, [familyId, priority, sqlParameter(cleanText(body.name, 120)), sqlParameter(cleanText(body.relationship, 80)), sqlParameter(cleanText(body.phone, 40)), sqlParameter(cleanText(body.notes, 400))]);
      return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
    }

    if (p === '/teachers') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const teacherId = asInt(body.teacherId);
      if (teacherId) {
        executeSql(`UPDATE os_teachers
          SET name=?,
              email=?,
              mobile_phone=?,
              phone=?,
              address=?
          WHERE id=?;`, [sqlParameter(cleanText(body.name, 120)), sqlParameter(cleanText(body.email, 160)), sqlParameter(cleanText(body.mobilePhone, 40)), sqlParameter(cleanText(body.mobilePhone, 40)), sqlParameter(cleanText(body.address, 220)), teacherId]);
        return redirectTo(`/setup?section=teachers&teacherId=${teacherId}`, headers);
      }
      const newTeacherId = insertReturningId(`INSERT INTO os_teachers (name, email, mobile_phone, phone, address)
        VALUES (?, ?, ?, ?, ?)`, [sqlParameter(cleanText(body.name, 120)), sqlParameter(cleanText(body.email, 160)), sqlParameter(cleanText(body.mobilePhone, 40)), sqlParameter(cleanText(body.mobilePhone, 40)), sqlParameter(cleanText(body.address, 220))]);
      return redirectTo(`/setup?section=teachers&teacherId=${newTeacherId}`, headers);
    }

    if (p === '/person-roles') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const redirectRaw = cleanText(body.redirectTo, 240);
      const redirectTo = redirectRaw.startsWith('/') && !redirectRaw.startsWith('//') ? redirectRaw : '/setup';
      if (body.action === 'delete') {
        executeSql(`DELETE FROM os_person_roles WHERE id=?;`, [asInt(body.roleAssignmentId)]);
        return redirectTo(redirectTo, headers);
      }
      const personType = cleanPersonRoleType(body.personType);
      const personId = asInt(body.personId);
      const roleTypeId = asInt(body.roleTypeId);
      const roleType = querySql(`SELECT id, group_id FROM os_role_types WHERE id=? LIMIT 1;`, [roleTypeId])[0];
      if (!personType || !personId || !roleType) return text(400, 'Bad Request');
      const personTable = personType === 'teacher' ? 'os_teachers' : 'os_families';
      if (!querySql(`SELECT id FROM ${personTable} WHERE id=?;`, [personId]).length) return text(400, 'The linked person no longer exists.');
      executeSql(`INSERT INTO os_person_roles (person_type, person_id, group_id, role_type_id, is_assistant, term_start, term_end)
        VALUES (?, ?, ?, ?, ?, ?, ?);`, [sqlParameter(personType), personId, asInt(roleType.group_id), roleTypeId, body.isAssistant ? 1 : 0, sqlParameter(cleanDate(body.termStart)), sqlParameter(cleanDate(body.termEnd))]);
      return redirectTo(redirectTo, headers);
    }

    return text(404, 'Not Found');
  }, repository);
}
module.exports = { createPeopleService };
