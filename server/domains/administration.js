const { text, json, redirectTo } = require('./results');
const { createTransactionalService } = require('./service');

function createAdministrationService(deps) {
  const { repository, ROLES, ROLE_ADMIN, ROLE_PARENT, ROLE_PRINCIPAL, ROLE_TEACHER, asInt, canManageAdminUsers, canManageSchoolUsers, cleanText, hashPassword, sqlValue } = deps;
  const { querySql, runSql, insertReturningId } = repository;
  return createTransactionalService(["/users"], (p, body, user, headers) => {
    if (p === '/users') {
      if (!canManageSchoolUsers(user)) return text(403, 'Forbidden');
      const role = cleanText(body.role, 20).toLowerCase();
      if (!ROLES.includes(role)) return text(400, 'Invalid role');
      if ([ROLE_ADMIN, ROLE_PRINCIPAL].includes(role) && !canManageAdminUsers(user)) return text(403, 'Only admins can manage admin or principal users.');
      const userId = asInt(body.userId);
      const existingUser = userId ? querySql(`SELECT id, role FROM os_users WHERE id=${userId} LIMIT 1;`)[0] : null;
      if ([ROLE_ADMIN, ROLE_PRINCIPAL].includes(existingUser?.role) && !canManageAdminUsers(user)) return text(403, 'Only admins can manage admin or principal users.');
      const teacherId = role === ROLE_TEACHER ? asInt(body.teacherId) : 0;
      const parentFamilyId = role === ROLE_PARENT ? asInt(body.parentFamilyId) : 0;
      if (role === ROLE_TEACHER && !teacherId) return text(400, 'Teacher users require a teacher link.');
      if (role === ROLE_PARENT && !parentFamilyId) return text(400, 'Parent users require a family link.');
      if (userId) {
        const password = String(body.password || '').slice(0, 120);
        const passwordSql = password ? `, password_hash=${sqlValue(hashPassword(password))}` : '';
        runSql(`UPDATE os_users
          SET name=${sqlValue(cleanText(body.name, 120))},
              username=${sqlValue(cleanText(body.username, 80).toLowerCase())},
              role=${sqlValue(role)},
              teacher_id=${role === ROLE_TEACHER ? teacherId : 'NULL'},
              parent_family_id=${role === ROLE_PARENT ? parentFamilyId : 'NULL'}
              ${passwordSql}
          WHERE id=${userId};`);
        return redirectTo('/setup?section=users', headers);
      }
      runSql(`INSERT INTO os_users (name, username, role, password_hash, teacher_id, parent_family_id)
        VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.username, 80).toLowerCase())}, ${sqlValue(role)}, ${sqlValue(hashPassword(String(body.password || '').slice(0, 120)))}, ${role === ROLE_TEACHER ? teacherId : 'NULL'}, ${role === ROLE_PARENT ? parentFamilyId : 'NULL'});`);
      return redirectTo('/setup?section=users', headers);
    }

    return text(404, 'Not Found');
  }, repository);
}
module.exports = { createAdministrationService };
