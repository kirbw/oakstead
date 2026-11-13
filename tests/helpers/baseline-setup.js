// Frozen Setup renderer from 0f088ec3 for parity/benchmark verification only.
const { asInt, cleanText, esc, normalizeCategory, formatFileSize, compactNumber } = require('../../server/input');
const { APP_VERSION, DATA_DIR, RELEASE_REPO, UPDATE_MODE, DEMO_MODE, DEMO_HIDDEN_SETUP_SECTIONS } = require('../../server/config');

module.exports = function baselineSetup(helpers) {
  const { querySql, appSettings, getSetting, backupFrequency, backupFrequencyLabel, networkAccessLabel, desiredNetworkConfig, networkStatus, listDatabaseBackups, readUpdateStatus, schoolYearHead, selectedAttr, csrfInput, familyReportName, firstNameOnly, studentDisplayName, genderIcon, genderOptions, gradeOptions, gradeChoices, roleAssignmentRows, roleAssignmentForm, roleOptionsForUser, roleLabel, canManageAdminUsers, isAdmin, sortGrades, displayCategory, emptyState, DEFAULT_LETTER_GRADES, CATEGORIES, ROLE_ADMIN, ROLE_PRINCIPAL, ROLE_TEACHER } = helpers;
function setupPage(selectedYear, csrfToken, url, user) {
  const yearId = asInt(selectedYear.id);
  const allSections = ['families', 'districts', 'congregations', 'teachers', 'classrooms', 'subjects', 'years', 'weights', 'letter-grades', 'users', 'settings', 'network', 'backups', 'updates'];
  const validSections = DEMO_MODE ? allSections.filter((item) => !DEMO_HIDDEN_SETUP_SECTIONS.has(item)) : allSections;
  const section = validSections.includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'families';
  const action = cleanText(url.searchParams.get('action'), 40);
  const settings = appSettings();
  const teachers = querySql('SELECT * FROM os_teachers ORDER BY name;');
  const subjects = querySql('SELECT * FROM os_subjects ORDER BY name;');
  const districts = querySql('SELECT * FROM os_school_districts ORDER BY name;');
  const congregations = querySql('SELECT * FROM os_congregations ORDER BY name;');
  const roleGroups = querySql('SELECT * FROM os_role_groups ORDER BY name;');
  const roleTypes = querySql('SELECT rt.*, rg.name AS group_name FROM os_role_types rt JOIN os_role_groups rg ON rg.id = rt.group_id ORDER BY rg.name, rt.name;');
  const personRoles = querySql(`SELECT pr.*, rg.name AS group_name, rt.name AS role_name
    FROM os_person_roles pr
    JOIN os_role_groups rg ON rg.id = pr.group_id
    JOIN os_role_types rt ON rt.id = pr.role_type_id
    ORDER BY pr.term_start DESC, rg.name, rt.name;`);
  const schoolYears = querySql('SELECT * FROM os_school_years ORDER BY is_active DESC, name DESC;');
  const markingPeriods = querySql(`SELECT * FROM os_marking_periods WHERE school_year_id=${yearId} ORDER BY period_number;`);
  const classrooms = querySql(`SELECT c.*, t.name AS teacher_name,
      GROUP_CONCAT(cg.grade_level, ', ') AS grades
    FROM os_classrooms c
    LEFT JOIN os_teachers t ON t.id = c.teacher_id
    LEFT JOIN os_classroom_grades cg ON cg.classroom_id = c.id
    WHERE c.school_year_id=${yearId}
    GROUP BY c.id
    ORDER BY c.name;`);
  const gradeSubjects = querySql(`SELECT gs.grade_level, gs.subject_id, s.name AS subject_name
    FROM os_grade_subjects gs
    JOIN os_subjects s ON s.id = gs.subject_id
    WHERE gs.school_year_id=${yearId}
    ORDER BY gs.grade_level, s.name;`);
  const families = querySql(`SELECT f.*, sd.name AS school_district_name, cng.name AS congregation_name,
      COUNT(st.id) AS child_count
    FROM os_families f
    LEFT JOIN os_school_districts sd ON sd.id = f.school_district_id
    LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
    LEFT JOIN os_students st ON st.family_id = f.id
    GROUP BY f.id
    ORDER BY f.family_name;`);
  const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
    FROM os_students st
    JOIN os_families f ON f.id = st.family_id
    LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=${yearId}
    LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
    ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`);
  const users = querySql(`SELECT u.id, u.name, u.username, u.role, u.teacher_id, u.parent_family_id, t.name AS teacher_name, f.family_name AS parent_family_name
    FROM os_users u
    LEFT JOIN os_teachers t ON t.id = u.teacher_id
    LEFT JOIN os_families f ON f.id = u.parent_family_id
    ORDER BY u.name;`);
  const weightGroups = querySql(`SELECT wg.*, s.name AS subject_name
    FROM os_grade_weight_groups wg
    LEFT JOIN os_subjects s ON s.id = wg.subject_id
    WHERE wg.school_year_id=${yearId}
    ORDER BY CAST(wg.min_grade AS INTEGER), wg.name;`);
  const weightItems = querySql(`SELECT * FROM os_grade_weight_items
    WHERE group_id IN (SELECT id FROM os_grade_weight_groups WHERE school_year_id=${yearId})
    ORDER BY category;`);
  const letterGroups = querySql(`SELECT lg.*, s.name AS subject_name
    FROM os_letter_grade_groups lg
    LEFT JOIN os_subjects s ON s.id = lg.subject_id
    WHERE lg.school_year_id=${yearId}
    ORDER BY CAST(lg.min_grade AS INTEGER), lg.name;`);
  const letterItems = querySql(`SELECT * FROM os_letter_grade_items
    WHERE group_id IN (SELECT id FROM os_letter_grade_groups WHERE school_year_id=${yearId})
    ORDER BY threshold DESC, sort_order, letter;`);
  const teacherOptions = (selected = '') => teachers.map((teacher) => `<option value="${teacher.id}" ${selectedAttr(teacher.id, selected)}>${esc(teacher.name)}</option>`).join('');
  const familyOptions = (selected = '') => families.map((family) => `<option value="${family.id}" ${selectedAttr(family.id, selected)}>${esc(familyReportName(family))}</option>`).join('');
  const subjectOptions = (selected = '') => subjects.map((subject) => `<option value="${subject.id}" ${selectedAttr(subject.id, selected)}>${esc(subject.name)}</option>`).join('');
  const classroomOptions = (selected = '') => classrooms.map((room) => `<option value="${room.id}" ${selectedAttr(room.id, selected)}>${esc(room.name)}</option>`).join('');
  const districtOptions = (selected = '') => districts.map((district) => `<option value="${district.id}" ${selectedAttr(district.id, selected)}>${esc(district.name)}</option>`).join('');
  const congregationOptions = (selected = '') => congregations.map((congregation) => `<option value="${congregation.id}" ${selectedAttr(congregation.id, selected)}>${esc(congregation.name)}</option>`).join('');
  const updateStatus = readUpdateStatus();
  const backups = listDatabaseBackups();
  const backupFreq = backupFrequency(getSetting('backup_frequency', 'manual'));
  const networkInfo = networkStatus();
  const setupLinks = [
    ['families', 'Families', `${families.length} households`],
    ['districts', 'School Districts', `${districts.length} districts`],
    ['congregations', 'Congregations', `${congregations.length} churches`],
    ['teachers', 'Teachers', `${teachers.length} records`],
    ['classrooms', 'Classrooms', `${classrooms.length} rooms in ${selectedYear.name}`],
    ['subjects', 'Subjects', `${subjects.length} subjects`],
    ['years', 'School Years', `${schoolYears.length} years`],
    ['weights', 'Grade Weights', `${weightGroups.length} groups`],
    ['letter-grades', 'Letter Grades', `${letterGroups.length} scales`],
    ['users', 'Users', `${users.length} sign-ins`],
    ['settings', 'System Settings', settings.schoolName],
    ...(!DEMO_MODE ? [
      ['network', 'Network Access', networkAccessLabel(networkInfo.desired.host)],
      ['backups', 'Backups', `${backupFrequencyLabel(backupFreq)}`],
      ['updates', 'System Updates', `v${APP_VERSION}`]
    ] : [])
  ];
  const setupNav = `<aside class="setup-nav" aria-label="School setup modules">
    <div class="setup-nav-head"><h2>Setup</h2></div>
    ${setupLinks.map(([key, label, meta]) => `<a class="setup-link ${section === key ? 'active' : ''}" href="/setup?section=${key}">
      <strong>${esc(label)}</strong>
      <span>${esc(meta)}</span>
    </a>`).join('')}
  </aside>`;

  const requestedFamilyId = asInt(url.searchParams.get('familyId'));
  const selectedFamily = families.find((family) => family.id === requestedFamilyId) || families[0] || null;
  const showFamilyForm = action === 'add-family' || action === 'edit-family' || families.length === 0;
  const familyForForm = action === 'edit-family' ? selectedFamily : null;
  const selectedChildren = selectedFamily ? students.filter((student) => student.family_id === selectedFamily.id) : [];
  const childEdit = selectedChildren.find((student) => student.id === asInt(url.searchParams.get('studentId')));
  const emergencyContacts = selectedFamily ? querySql(`SELECT * FROM os_emergency_contacts WHERE family_id=${selectedFamily.id} ORDER BY priority, name;`) : [];
  const emergencyEdit = emergencyContacts.find((contact) => contact.id === asInt(url.searchParams.get('contactId')));
  const familyList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Families</h2>
      <div class="module-actions"><span class="family-count">${families.length}</span><a class="page-action compact-action" href="/setup?section=families&action=add-family">Add Family</a></div>
    </div>
    ${families.map((family) => {
      const active = selectedFamily?.id === family.id && !showFamilyForm ? 'active' : '';
      const childText = `${family.child_count || 0} ${Number(family.child_count) === 1 ? 'child' : 'children'}`;
      const householdLine = familyReportName(family);
      const contact = [family.father_phone || family.phone, family.mother_phone].filter(Boolean).join(' / ');
      return `<a class="family-link ${active}" href="/setup?section=families&familyId=${family.id}">
        <strong>${esc(householdLine)}</strong>
        <span>${esc(childText)}${family.school_district_name ? ` / ${esc(family.school_district_name)}` : ''}${family.congregation_name ? ` / ${esc(family.congregation_name)}` : ''}${contact ? ` / ${esc(contact)}` : ''}</span>
      </a>`;
    }).join('') || `<div style="padding:.9rem">${emptyState('No families have been entered yet.')}</div>`}
  </section>`;
  const familyForm = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${familyForForm ? 'Edit Family' : 'Add Family'}</h2>
      <a class="secondary-btn compact-action" href="/setup?section=families${selectedFamily ? `&familyId=${selectedFamily.id}` : ''}">Cancel</a>
    </div>
    <div class="family-detail-body">
      <form method="post" action="/families" class="form-grid two">
        ${csrfInput(csrfToken)}
        ${familyForForm ? `<input type="hidden" name="familyId" value="${familyForForm.id}" />` : ''}
        <div class="family-form-section">
          <h3>Household</h3>
          <div class="family-form-section-grid two">
            <label>Last Name<input name="familyName" required maxlength="120" value="${esc(familyForForm?.family_name || '')}" /></label>
            <label>Father<input name="fatherName" maxlength="120" value="${esc(firstNameOnly(familyForForm?.father_name || ''))}" /></label>
            <label>Mother<input name="motherName" maxlength="120" value="${esc(firstNameOnly(familyForForm?.mother_name || ''))}" /></label>
          </div>
        </div>
        <div class="family-form-section">
          <h3>Contact</h3>
          <div class="family-form-section-grid two">
            <label>Father Phone<input name="fatherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.father_phone || familyForForm?.phone || '')}" /></label>
            <label>Mother Phone<input name="motherPhone" inputmode="tel" maxlength="40" value="${esc(familyForForm?.mother_phone || '')}" /></label>
            <label>Email<input name="email" type="email" maxlength="160" value="${esc(familyForForm?.email || '')}" /></label>
            <label>Address<input name="address" maxlength="220" value="${esc(familyForForm?.address || '')}" /></label>
          </div>
        </div>
        <div class="family-form-section">
          <h3>Church and District</h3>
          <div class="family-form-section-grid two">
            <label>Congregation<select name="congregationId"><option value="">Not selected</option>${congregationOptions(familyForForm?.congregation_id || '')}</select></label>
            <label>School District<select name="schoolDistrictId"><option value="">Not selected</option>${districtOptions(familyForForm?.school_district_id || '')}</select></label>
          </div>
        </div>
        <button type="submit">${familyForForm ? 'Save Changes' : 'Save Family'}</button>
      </form>
    </div>
  </section>`;
  const childForm = selectedFamily ? `<form method="post" action="/students" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    <input type="hidden" name="familyId" value="${selectedFamily.id}" />
    ${childEdit ? `<input type="hidden" name="studentId" value="${childEdit.id}" />` : ''}
    <label>First Name<input name="firstName" required maxlength="80" value="${esc(childEdit?.first_name || '')}" /></label>
    <label>Middle Name<input name="middleName" maxlength="80" value="${esc(childEdit?.middle_name || '')}" /></label>
    <label>Last Name<input name="lastName" required maxlength="80" value="${esc(childEdit?.last_name || selectedFamily.family_name)}" /></label>
    <label>Gender<select name="gender">${genderOptions(childEdit?.gender || '')}</select></label>
    <label>Birthday<input type="date" name="birthDate" value="${esc(childEdit?.birth_date || '')}" /></label>
    ${childEdit ? `<label>Grade<input value="${esc(childEdit.grade_level || 'Not enrolled')}" disabled /></label>` : `<label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>`}
    <label>Classroom<select name="classroomId"><option value="">Not assigned yet</option>${classroomOptions(childEdit?.classroom_id || '')}</select></label>
    <button type="submit">${childEdit ? 'Save Child' : 'Add Child'}</button>
  </form>` : '';
  const familyDetail = selectedFamily ? `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${esc(selectedFamily.family_name)}</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=edit-family">Edit</a>
      </div>
    </div>
    <div class="family-detail-body">
	      <div class="detail-grid">
	        <div class="detail-item"><span>Father</span><strong>${esc(firstNameOnly(selectedFamily.father_name || '')) || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother</span><strong>${esc(firstNameOnly(selectedFamily.mother_name || '')) || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Contact</h3></div>
	      <div class="detail-grid">
	        <div class="detail-item"><span>Father Phone</span><strong>${esc(selectedFamily.father_phone || selectedFamily.phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Mother Phone</span><strong>${esc(selectedFamily.mother_phone || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Church and District</h3></div>
	      <div class="detail-grid">
	        <div class="detail-item"><span>Congregation</span><strong>${esc(selectedFamily.congregation_name || '') || '&mdash;'}</strong></div>
	        <div class="detail-item"><span>School District</span><strong>${esc(selectedFamily.school_district_name || '') || '&mdash;'}</strong></div>
	      </div>
	      <div class="subhead"><h3>Parent Groups and Roles</h3></div>
	      <div class="table-wrap compact-table"><table>
	        <tr><th>Parent</th><th>Group</th><th>Role</th><th>Term Starts</th><th>Term Ends</th><th></th></tr>
	        ${['father', 'mother'].map((parentType) => {
	          const label = parentType === 'father' ? (selectedFamily.father_name || 'Father') : (selectedFamily.mother_name || 'Mother');
	          const rows = personRoles.filter((role) => role.person_type === parentType && asInt(role.person_id) === asInt(selectedFamily.id));
	          return rows.map((role) => `<tr>
	            <td>${esc(label)}</td>
	            <td>${esc(role.group_name)}</td>
	            <td>${role.is_assistant ? 'Assistant ' : ''}${esc(role.role_name)}</td>
	            <td>${esc(role.term_start || '') || '&mdash;'}</td>
	            <td>${esc(role.term_end || '') || '&mdash;'}</td>
	            <td>
	              <form method="post" action="/person-roles" style="margin:0">
	                ${csrfInput(csrfToken)}
	                <input type="hidden" name="action" value="delete" />
	                <input type="hidden" name="roleAssignmentId" value="${role.id}" />
	                <input type="hidden" name="redirectTo" value="${esc(`/setup?section=families&familyId=${selectedFamily.id}`)}" />
	                <button class="secondary-btn compact-action" type="submit">Remove</button>
	              </form>
	            </td>
	          </tr>`).join('');
	        }).join('') || `<tr><td colspan="6">${emptyState('No parent roles assigned yet.')}</td></tr>`}
	      </table></div>
	      <div class="inline-actions">
	        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-father-role">Add Father Role</a>
	        <a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-mother-role">Add Mother Role</a>
	      </div>
	      ${(action === 'add-father-role' || action === 'add-mother-role') ? `<div class="subhead"><h3>${action === 'add-father-role' ? 'Add Father Role' : 'Add Mother Role'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${roleAssignmentForm({ csrfToken, redirectTo: `/setup?section=families&familyId=${selectedFamily.id}`, personType: action === 'add-father-role' ? 'father' : 'mother', personId: selectedFamily.id, roleGroups, roleTypes })}` : ''}
	      <div class="subhead"><h3>Children</h3><div class="module-actions"><span class="family-count">${esc(selectedYear.name)}</span><a class="page-action compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-child">Add Child</a></div></div>
      <div class="child-list">
        ${selectedChildren.map((student) => `<div class="child-row">
          <div class="child-row-main">
            <div class="child-name-line">${genderIcon(student.gender)}<b>${esc(studentDisplayName(student))}</b></div>
            <span>${student.birth_date ? `Birthday ${esc(student.birth_date)} / ` : ''}Grade ${esc(student.grade_level || 'not enrolled')}${student.classroom_name ? ` / ${esc(student.classroom_name)}` : ''}</span>
          </div>
          <a class="text-action" href="/setup?section=families&familyId=${selectedFamily.id}&studentId=${student.id}&action=edit-child">Edit</a>
        </div>`).join('') || emptyState('No children are listed for this family yet.')}
      </div>
      ${(action === 'add-child' || childEdit) ? `<div class="subhead"><h3>${childEdit ? 'Edit Child' : 'Add Child'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>${childForm}` : ''}
      <div class="subhead"><h3>Emergency Contacts</h3><a class="page-action compact-action" href="/setup?section=families&familyId=${selectedFamily.id}&action=add-emergency">Add Contact</a></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Priority</th><th>Name</th><th>Relationship</th><th>Number</th><th>Notes</th><th></th></tr>
        ${emergencyContacts.map((contact) => `<tr>
          <td>${esc(contact.priority)}</td>
          <td>${esc(contact.name)}</td>
          <td>${esc(contact.relationship || '') || '&mdash;'}</td>
          <td>${esc(contact.phone || '') || '&mdash;'}</td>
          <td>${esc(contact.notes || '') || '&mdash;'}</td>
          <td><a class="text-action" href="/setup?section=families&familyId=${selectedFamily.id}&contactId=${contact.id}&action=edit-emergency">Edit</a></td>
        </tr>`).join('') || `<tr><td colspan="6">${emptyState('No emergency contacts listed yet.')}</td></tr>`}
      </table></div>
      ${(action === 'add-emergency' || emergencyEdit) ? `<div class="subhead"><h3>${emergencyEdit ? 'Edit Emergency Contact' : 'Add Emergency Contact'}</h3><a class="secondary-btn compact-action" href="/setup?section=families&familyId=${selectedFamily.id}">Cancel</a></div>
        <form method="post" action="/emergency-contacts" class="form-grid two">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="familyId" value="${selectedFamily.id}" />
          ${emergencyEdit ? `<input type="hidden" name="contactId" value="${emergencyEdit.id}" />` : ''}
          <label>Priority<input type="number" name="priority" min="1" max="20" value="${esc(emergencyEdit?.priority || emergencyContacts.length + 1 || 1)}" required /></label>
          <label>Name<input name="name" required maxlength="120" value="${esc(emergencyEdit?.name || '')}" /></label>
          <label>Relationship<input name="relationship" maxlength="80" value="${esc(emergencyEdit?.relationship || '')}" /></label>
          <label>Number<input name="phone" inputmode="tel" maxlength="40" value="${esc(emergencyEdit?.phone || '')}" /></label>
          <label>Notes<textarea name="notes" maxlength="400">${esc(emergencyEdit?.notes || '')}</textarea></label>
          <button type="submit">${emergencyEdit ? 'Save Contact' : 'Add Contact'}</button>
        </form>` : ''}
    </div>
  </section>` : familyForm;
  const familiesModule = `<div class="family-module-grid">
    ${familyList}
    ${showFamilyForm ? familyForm : familyDetail}
  </div>`;

  const districtEdit = districts.find((district) => district.id === asInt(url.searchParams.get('districtId')));
  const districtForm = `<form method="post" action="/school-districts" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${districtEdit ? `<input type="hidden" name="districtId" value="${districtEdit.id}" />` : ''}
    <label>District Name<input name="name" required maxlength="140" value="${esc(districtEdit?.name || '')}" /></label>
    <button type="submit">${districtEdit ? 'Save District' : 'Add District'}</button>
  </form>`;
  const districtsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>School Districts</h2>
      <div class="module-actions"><span class="family-count">${districts.length}</span><a class="page-action compact-action" href="/setup?section=districts&action=add-district">Add District</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-district' || districtEdit) ? `<div class="subhead"><h3>${districtEdit ? 'Edit District' : 'Add District'}</h3><a class="secondary-btn compact-action" href="/setup?section=districts">Cancel</a></div>${districtForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>District</th><th>Families</th><th></th></tr>
        ${districts.map((district) => {
          const count = families.filter((family) => asInt(family.school_district_id) === asInt(district.id)).length;
          return `<tr><td>${esc(district.name)}</td><td>${count}</td><td><a class="text-action" href="/setup?section=districts&districtId=${district.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No school districts yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const congregationEdit = congregations.find((congregation) => congregation.id === asInt(url.searchParams.get('congregationId')));
  const congregationForm = `<form method="post" action="/congregations" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${congregationEdit ? `<input type="hidden" name="congregationId" value="${congregationEdit.id}" />` : ''}
    <label>Church Name<input name="name" required maxlength="140" value="${esc(congregationEdit?.name || '')}" /></label>
    <button type="submit">${congregationEdit ? 'Save Church' : 'Add Church'}</button>
  </form>`;
  const congregationsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Congregations</h2>
      <div class="module-actions"><span class="family-count">${congregations.length}</span><a class="page-action compact-action" href="/setup?section=congregations&action=add-congregation">Add Church</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-congregation' || congregationEdit) ? `<div class="subhead"><h3>${congregationEdit ? 'Edit Church' : 'Add Church'}</h3><a class="secondary-btn compact-action" href="/setup?section=congregations">Cancel</a></div>${congregationForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Church</th><th>Families</th><th></th></tr>
        ${congregations.map((congregation) => {
          const count = families.filter((family) => asInt(family.congregation_id) === asInt(congregation.id)).length;
          return `<tr><td>${esc(congregation.name)}</td><td>${count}</td><td><a class="text-action" href="/setup?section=congregations&congregationId=${congregation.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No congregations yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const selectedTeacherId = asInt(url.searchParams.get('teacherId'));
  const selectedTeacher = teachers.find((teacher) => teacher.id === selectedTeacherId) || teachers[0] || null;
  const teacherEdit = action === 'edit-teacher' ? selectedTeacher : null;
  const showTeacherForm = action === 'add-teacher' || action === 'edit-teacher' || teachers.length === 0;
  const teacherForm = `<form method="post" action="/teachers" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${teacherEdit ? `<input type="hidden" name="teacherId" value="${teacherEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(teacherEdit?.name || '')}" /></label>
    <label>Email Address<input name="email" type="email" maxlength="160" value="${esc(teacherEdit?.email || '')}" /></label>
    <label>Mobile Number<input name="mobilePhone" inputmode="tel" maxlength="40" value="${esc(teacherEdit?.mobile_phone || teacherEdit?.phone || '')}" /></label>
    <label>Address<input name="address" maxlength="220" value="${esc(teacherEdit?.address || '')}" /></label>
    <button type="submit">${teacherEdit ? 'Save Changes' : 'Save Teacher'}</button>
  </form>`;
  const teacherList = `<section class="family-list">
    <div class="family-list-head">
      <h2>Teachers</h2>
      <div class="module-actions"><span class="family-count">${teachers.length}</span><a class="page-action compact-action" href="/setup?section=teachers&action=add-teacher">Add Teacher</a></div>
    </div>
    ${teachers.map((teacher) => `<a class="family-link ${selectedTeacher?.id === teacher.id && !showTeacherForm ? 'active' : ''}" href="/setup?section=teachers&teacherId=${teacher.id}">
      <strong>${esc(teacher.name)}</strong>
      <span>${esc([teacher.mobile_phone || teacher.phone, teacher.email].filter(Boolean).join(' / ')) || 'No contact details'}</span>
    </a>`).join('') || `<div style="padding:.9rem">${emptyState('No teachers yet.')}</div>`}
  </section>`;
  const teacherDetail = selectedTeacher ? `<section class="family-detail">
    <div class="family-detail-head">
      <h2>${esc(selectedTeacher.name)}</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}&action=edit-teacher">Edit</a>
        <a class="page-action compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}&action=add-role">Add Role</a>
      </div>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Mobile Number</span><strong>${esc(selectedTeacher.mobile_phone || selectedTeacher.phone || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Email Address</span><strong>${esc(selectedTeacher.email || '') || '&mdash;'}</strong></div>
        <div class="detail-item"><span>Address</span><strong>${esc(selectedTeacher.address || '') || '&mdash;'}</strong></div>
      </div>
      <div class="subhead"><h3>Groups and Roles</h3><span class="family-count">${roleAssignmentRows(personRoles, 'teacher', selectedTeacher.id, csrfToken, `/setup?section=teachers&teacherId=${selectedTeacher.id}`).split('<tr>').length - 1}</span></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Group</th><th>Role</th><th>Term Starts</th><th>Term Ends</th><th></th></tr>
        ${roleAssignmentRows(personRoles, 'teacher', selectedTeacher.id, csrfToken, `/setup?section=teachers&teacherId=${selectedTeacher.id}`) || `<tr><td colspan="5">${emptyState('No roles assigned yet.')}</td></tr>`}
      </table></div>
      ${action === 'add-role' ? `<div class="subhead"><h3>Add Role</h3><a class="secondary-btn compact-action" href="/setup?section=teachers&teacherId=${selectedTeacher.id}">Cancel</a></div>${roleAssignmentForm({ csrfToken, redirectTo: `/setup?section=teachers&teacherId=${selectedTeacher.id}`, personType: 'teacher', personId: selectedTeacher.id, roleGroups, roleTypes })}` : ''}
    </div>
  </section>` : `<section class="family-detail"><div class="family-detail-body">${emptyState('Add a teacher to begin.')}</div></section>`;
  const teachersModule = `<div class="family-module-grid">
    ${teacherList}
    ${showTeacherForm ? `<section class="family-detail"><div class="family-detail-head"><h2>${teacherEdit ? 'Edit Teacher' : 'Add Teacher'}</h2><a class="secondary-btn compact-action" href="/setup?section=teachers${selectedTeacher ? `&teacherId=${selectedTeacher.id}` : ''}">Cancel</a></div><div class="family-detail-body">${teacherForm}</div></section>` : teacherDetail}
  </div>`;

  const classroomEdit = classrooms.find((room) => room.id === asInt(url.searchParams.get('classroomId')));
  const classroomForm = `<form method="post" action="/classrooms" class="form-grid three">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${classroomEdit ? `<input type="hidden" name="classroomId" value="${classroomEdit.id}" />` : ''}
    <label>Room Name<input name="name" required maxlength="120" value="${esc(classroomEdit?.name || '')}" /></label>
    <label>Teacher<select name="teacherId"><option value="">Unassigned</option>${teacherOptions(classroomEdit?.teacher_id || '')}</select></label>
    <label>Grades in Room<input name="grades" placeholder="3, 4" required maxlength="120" value="${esc(classroomEdit?.grades || '')}" /></label>
    <button type="submit">${classroomEdit ? 'Save Changes' : 'Save Classroom'}</button>
  </form>`;
  const classroomsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Classrooms</h2>
      <div class="module-actions"><span class="family-count">${esc(selectedYear.name)}</span><a class="page-action compact-action" href="/setup?section=classrooms&action=add-classroom">Add Classroom</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-classroom' || classroomEdit) ? `<div class="subhead"><h3>${classroomEdit ? 'Edit Classroom' : 'Add Classroom'}</h3><a class="secondary-btn compact-action" href="/setup?section=classrooms">Cancel</a></div>${classroomForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Classroom</th><th>Teacher</th><th>Grades</th><th></th></tr>
        ${classrooms.map((room) => `<tr><td>${esc(room.name)}</td><td>${esc(room.teacher_name || 'Unassigned')}</td><td>${String(room.grades || '').split(',').filter(Boolean).map((grade) => `<span class="badge">${esc(grade.trim())}</span>`).join('')}</td><td><a class="text-action" href="/setup?section=classrooms&classroomId=${room.id}">Edit</a></td></tr>`).join('') || `<tr><td colspan="4">${emptyState('No classrooms for this year yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const subjectEdit = subjects.find((subject) => subject.id === asInt(url.searchParams.get('subjectId')));
  const subjectAssignedGrades = subjectEdit ? gradeSubjects.filter((row) => row.subject_id === subjectEdit.id).map((row) => row.grade_level) : [];
  const subjectGradeChecks = `<div class="grade-checkbox-grid">
    ${gradeChoices().filter((grade) => grade !== 'Graduated').map((grade) => `<label class="grade-checkbox"><input type="checkbox" name="grades" value="${esc(grade)}" ${subjectAssignedGrades.includes(grade) ? 'checked' : ''} /> ${esc(grade)}</label>`).join('')}
  </div>`;
  const subjectForm = `<form method="post" action="/subjects" class="form-grid">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${subjectEdit ? `<input type="hidden" name="subjectId" value="${subjectEdit.id}" />` : ''}
    <label>Subject Name<input name="name" required maxlength="120" value="${esc(subjectEdit?.name || '')}" /></label>
    <label>Grades using this subject${subjectGradeChecks}</label>
    <button type="submit">${subjectEdit ? 'Save Changes' : 'Save Subject'}</button>
  </form>`;
  const subjectsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Subjects</h2>
      <div class="module-actions">
        <a class="page-action compact-action" href="/setup?section=subjects&action=add-subject">Add Subject</a>
      </div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-subject' || subjectEdit) ? `<div class="subhead"><h3>${subjectEdit ? 'Edit Subject' : 'Add Subject'}</h3><a class="secondary-btn compact-action" href="/setup?section=subjects">Cancel</a></div>${subjectForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Subject</th><th>Grades</th><th></th></tr>
        ${subjects.map((subject) => {
          const assigned = sortGrades(gradeSubjects.filter((row) => row.subject_id === subject.id).map((row) => row.grade_level));
          return `<tr><td>${esc(subject.name)}</td><td>${assigned.map((grade) => `<span class="badge">${esc(grade)}</span>`).join('') || '&mdash;'}</td><td><a class="text-action" href="/setup?section=subjects&subjectId=${subject.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="3">${emptyState('No subjects yet.')}</td></tr>`}
      </table></div>
      <div class="table-wrap compact-table"><table>
        <tr><th>Grade</th><th>Subjects</th></tr>
        ${sortGrades(gradeSubjects.map((row) => row.grade_level)).map((grade) => `<tr><td>${esc(grade)}</td><td>${gradeSubjects.filter((row) => row.grade_level === grade).map((row) => `<span class="badge">${esc(row.subject_name)}</span>`).join('')}</td></tr>`).join('') || `<tr><td colspan="2">${emptyState('No subjects have been assigned to grades yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const yearEdit = schoolYears.find((schoolYear) => schoolYear.id === asInt(url.searchParams.get('yearId')));
  const yearForm = `<form method="post" action="/school-years" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${yearEdit ? `<input type="hidden" name="yearId" value="${yearEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="40" value="${esc(yearEdit?.name || '')}" /></label>
    <label>Start Date<input type="date" name="startDate" value="${esc(yearEdit?.start_date || '')}" /></label>
    <label>End Date<input type="date" name="endDate" value="${esc(yearEdit?.end_date || '')}" /></label>
    <label>Make Active<select name="makeActive"><option value="1" ${selectedAttr(yearEdit?.is_active ? '1' : '', '1')}>Yes</option><option value="0" ${selectedAttr(yearEdit && !yearEdit.is_active ? '0' : '', '0')}>No</option></select></label>
    <button type="submit">${yearEdit ? 'Save Changes' : 'Create Year'}</button>
  </form>`;
  const promoteForm = `<form method="post" action="/promote-year" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="fromYearId" value="${yearId}" />
    <label>Next Year Name<input name="name" placeholder="2026-2027" required maxlength="40" /></label>
    <label>Start Date<input type="date" name="startDate" /></label>
    <label>End Date<input type="date" name="endDate" /></label>
    <label>Make Active<select name="makeActive"><option value="1">Yes</option><option value="0">No</option></select></label>
    <button type="submit">Promote Students</button>
  </form>`;
  const periodForm = `<form method="post" action="/marking-periods" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    <label>School Days<input type="number" name="schoolDays" min="1" max="260" value="${asInt(selectedYear.school_days) || 180}" /></label>
    <label>Marking Periods<input type="number" name="periodCount" min="1" max="12" value="${markingPeriods.length || 6}" /></label>
    <label>Term Starts<input type="date" name="startDate" value="${esc(selectedYear.start_date || '')}" /></label>
    <label>Term Ends<input type="date" name="endDate" value="${esc(selectedYear.end_date || '')}" /></label>
    <label><input type="checkbox" name="autoCalculate" value="1" checked /> Auto Calculate Marking Period Dates</label>
    <button type="submit">Save Marking Periods</button>
  </form>`;
  const yearsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>School Years</h2>
      <div class="module-actions">
        <a class="secondary-btn compact-action" href="/setup?section=years&action=promote-year">Promote Year</a>
        <a class="page-action compact-action" href="/setup?section=years&action=add-year">Create Year</a>
      </div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-year' || yearEdit) ? `<div class="subhead"><h3>${yearEdit ? 'Edit School Year' : 'Create School Year'}</h3><a class="secondary-btn compact-action" href="/setup?section=years">Cancel</a></div>${yearForm}` : ''}
      ${action === 'promote-year' ? `<div class="subhead"><h3>Promote Current Year</h3><a class="secondary-btn compact-action" href="/setup?section=years">Cancel</a></div><p class="notice">Promotion creates new year-specific enrollment records and leaves prior grades untouched.</p>${promoteForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>School Year</th><th>Dates</th><th>Status</th><th></th></tr>
        ${schoolYears.map((schoolYear) => `<tr><td>${esc(schoolYear.name)}</td><td>${esc([schoolYear.start_date, schoolYear.end_date].filter(Boolean).join(' to ')) || '&mdash;'}</td><td>${schoolYear.is_active ? '<span class="badge good">Active</span>' : '<span class="badge">Inactive</span>'}</td><td><a class="text-action" href="/setup?section=years&yearId=${schoolYear.id}">Edit</a></td></tr>`).join('')}
      </table></div>
      <div class="subhead"><h3>Marking Periods</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
      ${periodForm}
      <div class="table-wrap compact-table"><table>
        <tr><th>Period</th><th>Start</th><th>End</th></tr>
        ${markingPeriods.map((period) => `<tr><td>${esc(period.name)}</td><td>${esc(period.start_date || '') || '&mdash;'}</td><td>${esc(period.end_date || '') || '&mdash;'}</td></tr>`).join('') || `<tr><td colspan="3">${emptyState('No marking periods set yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const weightEdit = weightGroups.find((group) => group.id === asInt(url.searchParams.get('weightGroupId')));
  const weightsForForm = Object.fromEntries(weightItems.filter((item) => item.group_id === weightEdit?.id).map((item) => [normalizeCategory(item.category), item.weight]));
  const weightForm = `<form method="post" action="/grade-weights" class="form-grid two">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${weightEdit ? `<input type="hidden" name="weightGroupId" value="${weightEdit.id}" />` : ''}
    <label>Group Name<input name="name" required maxlength="120" value="${esc(weightEdit?.name || '')}" placeholder="Grades 1-2" /></label>
    <label>Subject<select name="subjectId"><option value="">Any subject</option>${subjectOptions(weightEdit?.subject_id || '')}</select></label>
    <label>Minimum Grade<select name="minGrade">${gradeOptions(weightEdit?.min_grade || '1')}</select></label>
    <label>Maximum Grade<select name="maxGrade">${gradeOptions(weightEdit?.max_grade || '2')}</select></label>
    <label>Rounding Mode<select name="roundingMode"><option value="nearest" ${selectedAttr(weightEdit?.rounding_mode || 'nearest', 'nearest')}>Nearest whole percent</option><option value="round-up" ${selectedAttr(weightEdit?.rounding_mode, 'round-up')}>.5 Round Up</option></select></label>
    <label>Calculation Mode<select name="calculationMode"><option value="weighted" ${selectedAttr(weightEdit?.calculation_mode || 'weighted', 'weighted')}>Weighted</option><option value="straight" ${selectedAttr(weightEdit?.calculation_mode, 'straight')}>Straight Average</option></select></label>
    ${CATEGORIES.map((category) => `<label>${esc(category)} Weight<input type="number" name="weight_${esc(category)}" min="0" max="100" step="1" value="${esc(weightsForForm[category] ?? '')}" /></label>`).join('')}
    <button type="submit">${weightEdit ? 'Save Weight Group' : 'Create Weight Group'}</button>
  </form>`;
  const weightsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Grade Weights</h2>
      <div class="module-actions"><span class="family-count">${weightGroups.length}</span><a class="page-action compact-action" href="/setup?section=weights&action=add-weight">Add Weight Group</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-weight' || weightEdit) ? `<div class="subhead"><h3>${weightEdit ? 'Edit Weight Group' : 'Add Weight Group'}</h3><a class="secondary-btn compact-action" href="/setup?section=weights">Cancel</a></div>${weightForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Group</th><th>Grades</th><th>Subject</th><th>Weights</th><th></th></tr>
        ${weightGroups.map((group) => {
          const items = weightItems.filter((item) => item.group_id === group.id);
          return `<tr><td>${esc(group.name)}</td><td>${esc(group.min_grade)}-${esc(group.max_grade)}</td><td>${esc(group.subject_name || 'Any')}</td><td>${items.map((item) => `<span class="badge">${displayCategory(item.category)} ${Number(item.weight)}%</span>`).join('')}</td><td><a class="text-action" href="/setup?section=weights&weightGroupId=${group.id}">Edit</a></td></tr>`;
        }).join('') || `<tr><td colspan="5">${emptyState('No grade weights yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const letterEdit = letterGroups.find((group) => group.id === asInt(url.searchParams.get('letterGroupId')));
  const letterRows = letterEdit
    ? letterItems.filter((item) => item.group_id === letterEdit.id)
    : DEFAULT_LETTER_GRADES.map(([letter, threshold], index) => ({ letter, threshold, sort_order: index }));
  const letterFormRows = [...letterRows, { letter: '', threshold: '', sort_order: letterRows.length }];
  const letterForm = `<form method="post" action="/letter-grades" class="form-grid">
    ${csrfInput(csrfToken)}
    <input type="hidden" name="schoolYearId" value="${yearId}" />
    ${letterEdit ? `<input type="hidden" name="letterGroupId" value="${letterEdit.id}" />` : ''}
    <div class="form-grid four">
      <label>Scale Name<input name="name" required maxlength="120" value="${esc(letterEdit?.name || 'Default Letter Grades')}" /></label>
      <label>Subject<select name="subjectId"><option value="">Any subject</option>${subjectOptions(letterEdit?.subject_id || '')}</select></label>
      <label>Minimum Grade<select name="minGrade">${gradeOptions(letterEdit?.min_grade || '1')}</select></label>
      <label>Maximum Grade<select name="maxGrade">${gradeOptions(letterEdit?.max_grade || '12')}</select></label>
    </div>
    <div class="table-wrap compact-table"><table class="letter-grade-edit-table">
      <tr><th>Letter</th><th>Threshold</th></tr>
      ${letterFormRows.map((row, index) => `<tr>
        <td><input name="letter_${index}" maxlength="12" value="${esc(row.letter || '')}" placeholder="${index === letterFormRows.length - 1 ? 'Add letter' : ''}" /></td>
        <td><input type="number" name="threshold_${index}" min="0" max="100" step="0.1" value="${esc(row.threshold ?? '')}" /></td>
      </tr>`).join('')}
    </table></div>
    <button type="submit">${letterEdit ? 'Save Letter Grades' : 'Create Letter Scale'}</button>
  </form>`;
  const letterGradesModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Letter Grades</h2>
      <div class="module-actions"><span class="family-count">${letterGroups.length}</span><a class="page-action compact-action" href="/setup?section=letter-grades&action=add-letter-scale">Add Scale</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-letter-scale' || letterEdit) ? `<div class="subhead"><h3>${letterEdit ? 'Edit Letter Scale' : 'Add Letter Scale'}</h3><a class="secondary-btn compact-action" href="/setup?section=letter-grades">Cancel</a></div>${letterForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Scale</th><th>Grades</th><th>Subject</th><th>Thresholds</th><th></th></tr>
        ${letterGroups.map((group) => {
          const items = letterItems.filter((item) => item.group_id === group.id);
          return `<tr>
            <td>${esc(group.name)}</td>
            <td>${esc(group.min_grade)}-${esc(group.max_grade)}</td>
            <td>${esc(group.subject_name || 'Any')}</td>
            <td>${items.map((item) => `<span class="badge">${esc(item.letter)} ${compactNumber(item.threshold)}%</span>`).join('')}</td>
            <td><a class="text-action" href="/setup?section=letter-grades&letterGroupId=${group.id}">Edit</a></td>
          </tr>`;
        }).join('') || `<tr><td colspan="5">${emptyState('No letter grade scales yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const userEdit = users.find((setupUser) => setupUser.id === asInt(url.searchParams.get('userId')));
  const protectedAdminEdit = [ROLE_ADMIN, ROLE_PRINCIPAL].includes(userEdit?.role) && !canManageAdminUsers(user);
  const roleValue = userEdit?.role || (canManageAdminUsers(user) ? ROLE_ADMIN : ROLE_TEACHER);
  const userForm = protectedAdminEdit ? '<p class="notice danger">Only admins can edit admin or principal users.</p>' : `<form method="post" action="/users" class="form-grid two">
    ${csrfInput(csrfToken)}
    ${userEdit ? `<input type="hidden" name="userId" value="${userEdit.id}" />` : ''}
    <label>Name<input name="name" required maxlength="120" value="${esc(userEdit?.name || '')}" /></label>
    <label>Username<input name="username" required maxlength="80" value="${esc(userEdit?.username || '')}" /></label>
    <label>Role<select name="role">${roleOptionsForUser(user, roleValue)}</select></label>
    <label>Teacher Link<select name="teacherId"><option value="">None</option>${teacherOptions(userEdit?.teacher_id || '')}</select></label>
    <label>Parent Family<select name="parentFamilyId"><option value="">None</option>${familyOptions(userEdit?.parent_family_id || '')}</select></label>
    <label>Password<input type="password" name="password" ${userEdit ? '' : 'required'} maxlength="120" autocomplete="new-password" /></label>
    <button type="submit">${userEdit ? 'Save Changes' : 'Create User'}</button>
  </form>`;
  const usersModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Users</h2>
      <div class="module-actions"><span class="family-count">${users.length}</span><a class="page-action compact-action" href="/setup?section=users&action=add-user">Add User</a></div>
    </div>
    <div class="family-detail-body">
      ${(action === 'add-user' || userEdit) ? `<div class="subhead"><h3>${userEdit ? 'Edit User' : 'Add User'}</h3><a class="secondary-btn compact-action" href="/setup?section=users">Cancel</a></div>${userForm}` : ''}
      <div class="table-wrap compact-table"><table>
        <tr><th>Name</th><th>Username</th><th>Role</th><th>Teacher</th><th>Family</th><th></th></tr>
        ${users.map((setupUser) => {
          const canEditUser = ![ROLE_ADMIN, ROLE_PRINCIPAL].includes(setupUser.role) || canManageAdminUsers(user);
          return `<tr><td>${esc(setupUser.name)}</td><td>${esc(setupUser.username)}</td><td>${roleLabel(setupUser.role)}</td><td>${esc(setupUser.teacher_name || '') || '&mdash;'}</td><td>${esc(setupUser.parent_family_name || '') || '&mdash;'}</td><td>${canEditUser ? `<a class="text-action" href="/setup?section=users&userId=${setupUser.id}">Edit</a>` : '&mdash;'}</td></tr>`;
        }).join('') || `<tr><td colspan="6">${emptyState('No users yet.')}</td></tr>`}
      </table></div>
    </div>
  </section>`;

  const settingsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>System Settings</h2>
      <span class="family-count">${esc(settings.schoolName)}</span>
    </div>
    <div class="family-detail-body">
      ${isAdmin(user) ? '<p><a href="/system/diagnostics">Review data integrity</a></p>' : ''}
      <div class="asset-preview-grid">
        <div class="asset-preview">
          <img src="${settings.logoUrl}" alt="${esc(settings.schoolName)} logo" />
          <div><strong>Software Logo</strong><span>${settings.hasCustomLogo ? 'Custom logo loaded' : 'Default logo'}</span></div>
        </div>
        <div class="asset-preview">
          <img src="${settings.faviconUrl}" alt="${esc(settings.schoolName)} favicon" />
          <div><strong>Favicon</strong><span>${settings.hasCustomFavicon ? 'Custom favicon loaded' : 'Using logo as favicon'}</span></div>
        </div>
      </div>
      <form method="post" action="/system-settings" enctype="multipart/form-data" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>School Name<input name="schoolName" required maxlength="120" value="${esc(settings.schoolName)}" /></label>
        <label>Logo<input type="file" name="logo" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" /></label>
        <label>Favicon<input type="file" name="favicon" accept=".ico,.png,.jpg,.jpeg,.webp,image/x-icon,image/png,image/jpeg,image/webp" /></label>
        <button type="submit">Save Settings</button>
      </form>
    </div>
  </section>`;

  const networkAccessMode = networkInfo.desired.host === '0.0.0.0' ? 'lan' : 'local';
  const networkDisabled = networkInfo.envManaged ? 'disabled' : '';
  const networkModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Network Access</h2>
      <span class="family-count">${esc(networkAccessLabel(networkInfo.active.host))}</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Active Mode</span><strong>${esc(networkAccessLabel(networkInfo.active.host))}</strong></div>
        <div class="detail-item"><span>Active Port</span><strong>${esc(networkInfo.active.port)}</strong></div>
        <div class="detail-item"><span>Host Machine</span><strong>${esc(networkInfo.hostName)}</strong></div>
        <div class="detail-item"><span>Data Directory</span><strong>${esc(DATA_DIR)}</strong></div>
      </div>
      ${networkInfo.restartRequired ? '<p class="notice danger">Network settings have changed. Restart Oakstead before other devices use the new address.</p>' : ''}
      ${networkInfo.envManaged ? '<p class="notice danger">HOST or PORT is set by the runtime environment, so the form below is read-only until those environment variables are removed.</p>' : ''}
      <form method="post" action="/network-settings" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Access Mode<select name="accessMode" ${networkDisabled}>
          <option value="local" ${selectedAttr(networkAccessMode, 'local')}>Local computer only</option>
          <option value="lan" ${selectedAttr(networkAccessMode, 'lan')}>Local network devices</option>
        </select></label>
        <label>Port<input name="port" type="number" min="1" max="65535" value="${esc(networkInfo.desired.port)}" ${networkDisabled} /></label>
        <button class="secondary-btn compact-action" type="submit" ${networkDisabled}>Save Network Settings</button>
      </form>
      <div class="subhead"><h3>Current URLs</h3></div>
      <div class="backup-list">
        ${networkInfo.urls.map((item) => `<div class="backup-row"><div><strong>${esc(item)}</strong><span>${networkInfo.active.host === '0.0.0.0' ? 'Open this from another device on the same network.' : 'Open this on the host computer.'}</span></div></div>`).join('')}
      </div>
      <div class="subhead"><h3>Detected LAN Addresses</h3></div>
      <div class="backup-list">
        ${networkInfo.addresses.length ? networkInfo.addresses.map((item) => `<div class="backup-row"><div><strong>${esc(item)}</strong><span>${networkInfo.active.host === '0.0.0.0' ? esc(`http://${item}:${networkInfo.active.port}`) : 'Enable LAN access to use this address.'}</span></div></div>`).join('') : '<div class="backup-row"><div><strong>No non-local IPv4 address detected</strong><span>Check the host machine network connection.</span></div></div>'}
      </div>
      <p class="notice">LAN access should stay on a trusted local network or VPN. Do not expose Oakstead directly to the public internet.</p>
    </div>
  </section>`;

  const updateLogText = (updateStatus.log || []).slice(-20).join('\n');
  const latestBackup = backups[0] || null;
  const backupsModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>Backups</h2>
      <span class="family-count">${backups.length} saved</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Schedule</span><strong>${backupFrequencyLabel(backupFreq)}</strong></div>
        <div class="detail-item"><span>Latest Backup</span><strong>${latestBackup ? esc(latestBackup.fileName) : 'None yet'}</strong></div>
      </div>
      <form method="post" action="/backup-settings" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Automatic Backup Schedule<select name="frequency">
          <option value="manual" ${selectedAttr(backupFreq, 'manual')}>Manual only</option>
          <option value="daily" ${selectedAttr(backupFreq, 'daily')}>Daily</option>
          <option value="weekly" ${selectedAttr(backupFreq, 'weekly')}>Weekly</option>
          <option value="monthly" ${selectedAttr(backupFreq, 'monthly')}>Monthly</option>
        </select></label>
        <button class="secondary-btn compact-action" type="submit">Save Schedule</button>
      </form>
      <div class="inline-actions">
        <form method="post" action="/backup/create" style="margin:0">${csrfInput(csrfToken)}<button class="page-action compact-action" type="submit">Create Backup</button></form>
        ${latestBackup ? `<a class="secondary-btn compact-action" href="/backup/download?file=${encodeURIComponent(latestBackup.fileName)}">Download Latest</a>` : ''}
      </div>
      <div class="subhead"><h3>Restore Backup</h3></div>
      <form method="post" action="/backup/restore" enctype="multipart/form-data" class="form-grid two">
        ${csrfInput(csrfToken)}
        <label>Saved Backup<select name="backupFileName"><option value="">Choose saved backup</option>${backups.map((backup) => `<option value="${esc(backup.fileName)}">${esc(backup.fileName)}</option>`).join('')}</select></label>
        <label>Upload Backup<input type="file" name="backupFile" accept=".db,application/octet-stream" /></label>
        <button class="secondary-btn compact-action" type="submit">Restore Backup</button>
      </form>
      <p class="notice">Restoring replaces the current database. Oakstead creates a pre-restore backup first.</p>
      <div class="backup-list">
        ${backups.map((backup) => `<div class="backup-row">
          <div><strong>${esc(backup.fileName)}</strong><span>${esc(formatFileSize(backup.size))} / ${esc(backup.createdAt.toLocaleString())}</span></div>
          <a class="secondary-btn compact-action" href="/backup/download?file=${encodeURIComponent(backup.fileName)}">Download</a>
        </div>`).join('') || emptyState('No backups have been created yet.')}
      </div>
    </div>
  </section>`;
  const updatesModule = `<section class="family-detail">
    <div class="family-detail-head">
      <h2>System Updates</h2>
      <span class="family-count">v${esc(APP_VERSION)}</span>
    </div>
    <div class="family-detail-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Installed Version</span><strong>v${esc(APP_VERSION)}</strong></div>
        <div class="detail-item"><span>Latest Checked</span><strong>${updateStatus.latestVersion ? `v${esc(updateStatus.latestVersion)}` : 'Not checked yet'}</strong></div>
        <div class="detail-item"><span>Update Mode</span><strong>${UPDATE_MODE === 'installer' ? 'Windows installer' : 'Git checkout'}</strong></div>
        <div class="detail-item"><span>Release Source</span><strong>${UPDATE_MODE === 'installer' ? esc(RELEASE_REPO) : 'Configured Git remote'}</strong></div>
      </div>
      <div class="update-actions">
      <form method="post" action="/system-update/check" class="update-actions" data-update-check-form>
        ${csrfInput(csrfToken)}
        <label>Release Type<select name="channel">
          <option value="stable" ${selectedAttr(updateStatus.channel, 'stable')}>Current release</option>
          <option value="prerelease" ${selectedAttr(updateStatus.channel, 'prerelease')}>Pre-release</option>
        </select></label>
        <button class="secondary-btn compact-action" type="submit" ${updateStatus.running ? 'disabled' : ''}>Check for Updates</button>
      </form>
      <form method="post" action="/system-update" class="update-actions" data-update-form>
        ${csrfInput(csrfToken)}
        <input type="hidden" name="channel" value="${esc(updateStatus.channel)}" />
        <button class="page-action compact-action" type="submit" ${updateStatus.running ? 'disabled' : ''}>${UPDATE_MODE === 'installer' ? 'Download Installer' : 'Download and Install'}</button>
      </form>
      </div>
      <div class="inline-actions" data-update-download-row style="${updateStatus.installerDownloadUrl || updateStatus.releaseUrl ? '' : 'display:none'}">
        <a class="page-action compact-action" data-update-download href="${esc(updateStatus.installerDownloadUrl || '#')}" style="${updateStatus.installerDownloadUrl ? '' : 'display:none'}">${updateStatus.installerAssetName ? `Download ${esc(updateStatus.installerAssetName)}` : 'Download Windows Installer'}</a>
        <a class="secondary-btn compact-action" data-update-release href="${esc(updateStatus.releaseUrl || '#')}" style="${updateStatus.releaseUrl ? '' : 'display:none'}">Open Release Page</a>
      </div>
      <div class="update-status" data-update-status>
        <div class="update-status-head">
          <strong data-update-message>${esc(updateStatus.message)}</strong>
          <span data-update-percent>${asInt(updateStatus.percent)}%</span>
        </div>
        <div class="progress-track" aria-label="Update progress"><div class="progress-fill" data-update-progress style="--progress-value:${asInt(updateStatus.percent)}%"></div></div>
        <p class="notice" data-update-phase>${esc(updateStatus.phase)}${updateStatus.targetVersion ? ` / target v${esc(updateStatus.targetVersion)}` : ''}</p>
        <pre class="update-log" data-update-log>${esc(updateLogText || 'No update activity yet.')}</pre>
      </div>
      <p class="notice">${UPDATE_MODE === 'installer'
        ? 'Packaged Windows updates are installed by downloading the GitHub release installer, running it on the host computer, and letting it replace app files while preserving the data directory.'
        : 'Updates are fetched from the configured GitHub remote. Oakstead creates a database backup before updating, installs npm dependencies, validates the server, and restarts after success.'}</p>
    </div>
  </section>`;

  const modules = {
    families: familiesModule,
    districts: districtsModule,
    congregations: congregationsModule,
    teachers: teachersModule,
    classrooms: classroomsModule,
    subjects: subjectsModule,
    years: yearsModule,
    weights: weightsModule,
    'letter-grades': letterGradesModule,
    users: usersModule,
    settings: settingsModule,
    ...(!DEMO_MODE ? {
      network: networkModule,
      backups: backupsModule,
      updates: updatesModule
    } : {})
  };

  return `<div class="workspace">
    ${schoolYearHead('School Setup', 'Manage the records that define the school year.', selectedYear)}
    <div class="setup-layout">
      ${setupNav}
      ${modules[section]}
    </div>
  </div>`;
}

return setupPage;
};
