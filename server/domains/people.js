const { text, json, redirectTo } = require('./results');
const { createTransactionalService } = require('./service');

function createPeopleService(deps) {
  const { repository, asInt, canManageSchoolSetup, cleanDate, cleanGender, cleanGrade, cleanPersonRoleType, cleanText, firstNameOnly, sqlValue } = deps;
  const { querySql, runSql, insertReturningId } = repository;
  return createTransactionalService(["/families","/school-districts","/congregations","/students","/emergency-contacts","/teachers","/person-roles"], (p, body, user, headers) => {
    if (p === '/families') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const familyId = asInt(body.familyId);
      if (familyId) {
        runSql(`UPDATE os_families
          SET family_name=${sqlValue(cleanText(body.familyName, 120))},
              school_district_id=${asInt(body.schoolDistrictId) || 'NULL'},
              congregation_id=${asInt(body.congregationId) || 'NULL'},
              father_name=${sqlValue(firstNameOnly(body.fatherName))},
              mother_name=${sqlValue(firstNameOnly(body.motherName))},
              father_phone=${sqlValue(cleanText(body.fatherPhone, 40))},
              mother_phone=${sqlValue(cleanText(body.motherPhone, 40))},
              phone=${sqlValue(cleanText(body.fatherPhone, 40))},
              email=${sqlValue(cleanText(body.email, 160))},
              address=${sqlValue(cleanText(body.address, 220))}
          WHERE id=${familyId};`);
        return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
      }
      const newFamilyId = insertReturningId(`INSERT INTO os_families (family_name, school_district_id, congregation_id, father_name, mother_name, father_phone, mother_phone, phone, email, address)
        VALUES (${sqlValue(cleanText(body.familyName, 120))}, ${asInt(body.schoolDistrictId) || 'NULL'}, ${asInt(body.congregationId) || 'NULL'}, ${sqlValue(firstNameOnly(body.fatherName))}, ${sqlValue(firstNameOnly(body.motherName))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.motherPhone, 40))}, ${sqlValue(cleanText(body.fatherPhone, 40))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.address, 220))})`);
      return redirectTo(`/setup?section=families&familyId=${newFamilyId}`, headers);
    }

    if (p === '/school-districts') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const districtId = asInt(body.districtId);
      if (districtId) {
        runSql(`UPDATE os_school_districts SET name=${sqlValue(cleanText(body.name, 140))} WHERE id=${districtId};`);
        return redirectTo('/setup?section=districts', headers);
      }
      runSql(`INSERT OR IGNORE INTO os_school_districts (name) VALUES (${sqlValue(cleanText(body.name, 140))});`);
      return redirectTo('/setup?section=districts', headers);
    }

    if (p === '/congregations') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const congregationId = asInt(body.congregationId);
      if (congregationId) {
        runSql(`UPDATE os_congregations SET name=${sqlValue(cleanText(body.name, 140))} WHERE id=${congregationId};`);
        return redirectTo('/setup?section=congregations', headers);
      }
      runSql(`INSERT OR IGNORE INTO os_congregations (name) VALUES (${sqlValue(cleanText(body.name, 140))});`);
      return redirectTo('/setup?section=congregations', headers);
    }

    if (p === '/students') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolYearId = asInt(body.schoolYearId);
      const existingStudentId = asInt(body.studentId);
      if (existingStudentId) {
        runSql(`UPDATE os_students
          SET first_name=${sqlValue(cleanText(body.firstName, 80))},
              middle_name=${sqlValue(cleanText(body.middleName, 80))},
              last_name=${sqlValue(cleanText(body.lastName, 80))},
              birth_date=${sqlValue(cleanDate(body.birthDate))},
              gender=${sqlValue(cleanGender(body.gender))}
          WHERE id=${existingStudentId} AND family_id=${asInt(body.familyId)};`);
        runSql(`UPDATE os_student_years
          SET classroom_id=${asInt(body.classroomId) || 'NULL'}
          WHERE student_id=${existingStudentId} AND school_year_id=${schoolYearId};`);
        return redirectTo(`/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
      }
      const studentId = insertReturningId(`INSERT INTO os_students (family_id, first_name, middle_name, last_name, birth_date, gender)
        VALUES (${asInt(body.familyId)}, ${sqlValue(cleanText(body.firstName, 80))}, ${sqlValue(cleanText(body.middleName, 80))}, ${sqlValue(cleanText(body.lastName, 80))}, ${sqlValue(cleanDate(body.birthDate))}, ${sqlValue(cleanGender(body.gender))})`);
      runSql(`INSERT INTO os_student_years (student_id, school_year_id, grade_level, classroom_id)
        VALUES (${studentId}, ${schoolYearId}, ${sqlValue(cleanGrade(body.gradeLevel))}, ${asInt(body.classroomId) || 'NULL'});`);
      return redirectTo(`/setup?section=families&familyId=${asInt(body.familyId)}`, headers);
    }

    if (p === '/emergency-contacts') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const familyId = asInt(body.familyId);
      const contactId = asInt(body.contactId);
      const priority = Math.max(1, Math.min(20, asInt(body.priority) || 1));
      if (contactId) {
        runSql(`UPDATE os_emergency_contacts
          SET priority=${priority},
              name=${sqlValue(cleanText(body.name, 120))},
              relationship=${sqlValue(cleanText(body.relationship, 80))},
              phone=${sqlValue(cleanText(body.phone, 40))},
              notes=${sqlValue(cleanText(body.notes, 400))}
          WHERE id=${contactId} AND family_id=${familyId};`);
        return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
      }
      runSql(`INSERT INTO os_emergency_contacts (family_id, priority, name, relationship, phone, notes)
        VALUES (${familyId}, ${priority}, ${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.relationship, 80))}, ${sqlValue(cleanText(body.phone, 40))}, ${sqlValue(cleanText(body.notes, 400))});`);
      return redirectTo(`/setup?section=families&familyId=${familyId}`, headers);
    }

    if (p === '/teachers') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const teacherId = asInt(body.teacherId);
      if (teacherId) {
        runSql(`UPDATE os_teachers
          SET name=${sqlValue(cleanText(body.name, 120))},
              email=${sqlValue(cleanText(body.email, 160))},
              mobile_phone=${sqlValue(cleanText(body.mobilePhone, 40))},
              phone=${sqlValue(cleanText(body.mobilePhone, 40))},
              address=${sqlValue(cleanText(body.address, 220))}
          WHERE id=${teacherId};`);
        return redirectTo(`/setup?section=teachers&teacherId=${teacherId}`, headers);
      }
      const newTeacherId = insertReturningId(`INSERT INTO os_teachers (name, email, mobile_phone, phone, address)
        VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.email, 160))}, ${sqlValue(cleanText(body.mobilePhone, 40))}, ${sqlValue(cleanText(body.mobilePhone, 40))}, ${sqlValue(cleanText(body.address, 220))})`);
      return redirectTo(`/setup?section=teachers&teacherId=${newTeacherId}`, headers);
    }

    if (p === '/person-roles') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const redirectRaw = cleanText(body.redirectTo, 240);
      const redirectTo = redirectRaw.startsWith('/') && !redirectRaw.startsWith('//') ? redirectRaw : '/setup';
      if (body.action === 'delete') {
        runSql(`DELETE FROM os_person_roles WHERE id=${asInt(body.roleAssignmentId)};`);
        return redirectTo(redirectTo, headers);
      }
      const personType = cleanPersonRoleType(body.personType);
      const personId = asInt(body.personId);
      const roleTypeId = asInt(body.roleTypeId);
      const roleType = querySql(`SELECT id, group_id FROM os_role_types WHERE id=${roleTypeId} LIMIT 1;`)[0];
      if (!personType || !personId || !roleType) return text(400, 'Bad Request');
      const personTable = personType === 'teacher' ? 'os_teachers' : 'os_families';
      if (!querySql(`SELECT id FROM ${personTable} WHERE id=${personId};`).length) return text(400, 'The linked person no longer exists.');
      runSql(`INSERT INTO os_person_roles (person_type, person_id, group_id, role_type_id, is_assistant, term_start, term_end)
        VALUES (${sqlValue(personType)}, ${personId}, ${asInt(roleType.group_id)}, ${roleTypeId}, ${body.isAssistant ? 1 : 0}, ${sqlValue(cleanDate(body.termStart))}, ${sqlValue(cleanDate(body.termEnd))});`);
      return redirectTo(redirectTo, headers);
    }

    return text(404, 'Not Found');
  }, repository);
}
module.exports = { createPeopleService };
