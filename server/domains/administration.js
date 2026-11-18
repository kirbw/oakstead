const { text, redirectTo } = require('./results');
const { formRecord } = require('./validation');

function createAdministrationService(deps) {
  const { repository, ROLES, ROLE_ADMIN, ROLE_PARENT, ROLE_PRINCIPAL, ROLE_TEACHER, asInt, canManageAdminUsers, canManageSchoolUsers, cleanText, hashPassword, currentUser, sqlValue } = deps;
  const { querySql, runSql } = repository;
  return { paths: new Set(["/users"]), async execute(p, body, user, req) {
    formRecord(body);
    const headers = {};
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
      const before = userId ? querySql(`SELECT * FROM os_users WHERE id=${userId} LIMIT 1;`)[0] : null;
      if (userId && !before) return text(404, 'User no longer exists.');
      const suppliedPassword = String(body.password || '').slice(0, 120);
      const encoded = !userId || suppliedPassword ? await hashPassword(suppliedPassword) : null;
      return repository.transaction(() => {
        const actor = currentUser(req);
        if (!actor || actor.id !== user.id || !canManageSchoolUsers(actor)) return text(403, 'Your account permissions changed. Sign in again.');
        const target = userId ? querySql(`SELECT * FROM os_users WHERE id=${userId} LIMIT 1;`)[0] : null;
        if (userId && JSON.stringify(target) !== JSON.stringify(before)) return text(409, 'This account changed while saving. Reload and try again.');
        if (([ROLE_ADMIN, ROLE_PRINCIPAL].includes(role) || [ROLE_ADMIN, ROLE_PRINCIPAL].includes(target?.role)) && !canManageAdminUsers(actor)) return text(403, 'Only admins can manage admin or principal users.');
        if (userId) {
          const password = String(body.password || '').slice(0, 120);
          const passwordSql = password ? `, password_hash=${sqlValue(encoded)}` : '';
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
          VALUES (${sqlValue(cleanText(body.name, 120))}, ${sqlValue(cleanText(body.username, 80).toLowerCase())}, ${sqlValue(role)}, ${sqlValue(encoded)}, ${role === ROLE_TEACHER ? teacherId : 'NULL'}, ${role === ROLE_PARENT ? parentFamilyId : 'NULL'});`);
        return redirectTo('/setup?section=users', headers);
      });
    }

    return text(404, 'Not Found');
  } };
}
module.exports = { createAdministrationService };
