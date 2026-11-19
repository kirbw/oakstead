function createViews({ asInt, csrfInput, emptyState, esc, firstNameOnly, gradeOptions, querySql, roleAssignmentForm, schoolYearHead, selectedAttr }) {
  function familiesPage(selectedYear, csrfToken, url) {
    const yearId = asInt(selectedYear.id);
    const congregations = querySql('SELECT * FROM os_congregations ORDER BY name;');
    const families = querySql(`SELECT f.*, cng.name AS congregation_name,
        COUNT(st.id) AS child_count
      FROM os_families f
      LEFT JOIN os_congregations cng ON cng.id = f.congregation_id
      LEFT JOIN os_students st ON st.family_id = f.id
      GROUP BY f.id
      ORDER BY f.family_name;`);
    const students = querySql(`SELECT st.*, f.family_name, sy.grade_level, sy.status, sy.classroom_id, c.name AS classroom_name
      FROM os_students st
      JOIN os_families f ON f.id = st.family_id
      LEFT JOIN os_student_years sy ON sy.student_id = st.id AND sy.school_year_id=?
      LEFT JOIN os_classrooms c ON c.id = sy.classroom_id
      ORDER BY f.family_name, st.birth_date, st.last_name, st.first_name;`, [yearId]);
    const classrooms = querySql(`SELECT id, name FROM os_classrooms WHERE school_year_id=? ORDER BY name;`, [yearId]);
    const classroomOptions = classrooms.map((room) => `<option value="${room.id}">${esc(room.name)}</option>`).join('');
    const congregationOptions = (selected = '') => congregations.map((congregation) => `<option value="${congregation.id}" ${selectedAttr(congregation.id, selected)}>${esc(congregation.name)}</option>`).join('');
    const showAddFamily = url.searchParams.get('action') === 'add-family' || families.length === 0;
    const requestedFamilyId = asInt(url.searchParams.get('familyId'));
    const selectedFamily = !showAddFamily
      ? (families.find((family) => family.id === requestedFamilyId) || families[0] || null)
      : null;
    const selectedChildren = selectedFamily ? students.filter((student) => student.family_id === selectedFamily.id) : [];
    const addFamilyAction = `<a class="page-action" href="/families?action=add-family">Add Family</a>`;

    const familyList = `<section class="family-list">
      <div class="family-list-head">
        <h2>Families</h2>
        <div class="module-actions"><span class="family-count">${families.length}</span><a class="page-action compact-action" href="/setup?section=families&action=add-family">Add Family</a></div>
      </div>
      ${families.map((family) => {
        const active = selectedFamily?.id === family.id ? 'active' : '';
        const childText = `${family.child_count || 0} ${Number(family.child_count) === 1 ? 'child' : 'children'}`;
        const contact = [family.phone, family.email].filter(Boolean).join(' - ');
        const parents = [family.father_name, family.mother_name].filter(Boolean).join(' & ');
        const householdLine = parents ? `${family.family_name}, ${parents}` : family.family_name;
        return `<a class="family-link ${active}" href="/families?familyId=${family.id}">
          <strong>${esc(householdLine)}</strong>
          <span>${esc(childText)}${family.congregation_name ? ` / ${esc(family.congregation_name)}` : ''}${contact ? ` / ${esc(contact)}` : ''}</span>
        </a>`;
      }).join('') || `<div style="padding:.9rem">${emptyState('No families have been entered yet.')}</div>`}
    </section>`;

    const addFamilyPanel = `<section class="family-detail">
      <div class="family-detail-head"><h2>Add Family</h2><a class="secondary-btn" href="/families">Cancel</a></div>
      <div class="family-detail-body">
        <form method="post" action="/families" class="form-grid two">
          ${csrfInput(csrfToken)}
          <label>Family Name<input name="familyName" required maxlength="120" /></label>
          <label>Phone<input name="phone" inputmode="tel" maxlength="40" /></label>
          <label>Congregation<select name="congregationId"><option value="">Not selected</option>${congregationOptions()}</select></label>
          <label>Father<input name="fatherName" maxlength="120" /></label>
          <label>Mother<input name="motherName" maxlength="120" /></label>
          <label>Email<input name="email" type="email" maxlength="160" /></label>
          <label>Address<input name="address" maxlength="220" /></label>
          <button type="submit">Save Family</button>
        </form>
      </div>
    </section>`;

    const detailPanel = selectedFamily ? `<section class="family-detail">
      <div class="family-detail-head">
        <h2>${esc(selectedFamily.family_name)}</h2>
        <span class="family-count">${selectedChildren.length} ${selectedChildren.length === 1 ? 'child' : 'children'}</span>
      </div>
      <div class="family-detail-body">
        <div class="detail-grid">
          <div class="detail-item"><span>Parents</span><strong>${esc([firstNameOnly(selectedFamily.father_name), firstNameOnly(selectedFamily.mother_name)].filter(Boolean).join(' / ')) || '&mdash;'}</strong></div>
          <div class="detail-item"><span>Phone</span><strong>${esc(selectedFamily.phone || '') || '&mdash;'}</strong></div>
          <div class="detail-item"><span>Congregation</span><strong>${esc(selectedFamily.congregation_name || '') || '&mdash;'}</strong></div>
          <div class="detail-item"><span>Email</span><strong>${esc(selectedFamily.email || '') || '&mdash;'}</strong></div>
          <div class="detail-item"><span>Address</span><strong>${esc(selectedFamily.address || '') || '&mdash;'}</strong></div>
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
        <div class="subhead"><h3>Children</h3><span class="family-count">${esc(selectedYear.name)}</span></div>
        <div class="child-list">
          ${selectedChildren.map((student) => `<div class="child-row">
            <b>${esc(student.first_name)} ${esc(student.last_name)}</b>
            <span>${student.birth_date ? `Birthday ${esc(student.birth_date)} / ` : ''}Grade ${esc(student.grade_level || 'not enrolled')}${student.classroom_name ? ` / ${esc(student.classroom_name)}` : ''}</span>
          </div>`).join('') || emptyState('No children are listed for this family yet.')}
        </div>
        <div class="subhead"><h3>Add Child</h3></div>
        <form method="post" action="/students" class="form-grid two">
          ${csrfInput(csrfToken)}
          <input type="hidden" name="schoolYearId" value="${yearId}" />
          <input type="hidden" name="familyId" value="${selectedFamily.id}" />
          <label>First Name<input name="firstName" required maxlength="80" /></label>
          <label>Last Name<input name="lastName" required maxlength="80" /></label>
          <label>Birthday<input type="date" name="birthDate" /></label>
          <label>Grade<select name="gradeLevel" required>${gradeOptions()}</select></label>
          <label>Classroom<select name="classroomId"><option value="">Not assigned yet</option>${classroomOptions}</select></label>
          <button type="submit">Save Child</button>
        </form>
      </div>
    </section>` : addFamilyPanel;

    return `<div class="workspace">
      ${schoolYearHead('Families', 'Select a household to manage its children and yearly placement.', selectedYear, addFamilyAction)}
      <div class="family-layout">
        ${familyList}
        ${showAddFamily ? addFamilyPanel : detailPanel}
      </div>
    </div>`;
  }

  return { familiesPage };
}
module.exports = { createViews };
