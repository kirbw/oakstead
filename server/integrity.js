function collectDataIntegrityIssues(query) {
  const foreignKeys = new Map();
  const issues = query('PRAGMA foreign_key_check;').map((row) => {
    if (!foreignKeys.has(row.table)) {
      const identifier = String(row.table).replace(/"/g, '""');
      foreignKeys.set(row.table, query(`PRAGMA foreign_key_list("${identifier}");`));
    }
    const keys = foreignKeys.get(row.table).filter((key) => key.id === row.fkid);
    return { table: row.table, rowId: row.rowid, relatedTable: row.parent,
      relationship: keys.map((key) => `${key.from} → ${key.table}.${key.to}`).join(', ') };
  });
  for (const row of query(`SELECT a.id, a.marking_period_id FROM os_assignments a
    LEFT JOIN os_marking_periods p ON p.id=a.marking_period_id AND p.school_year_id=a.school_year_id
    WHERE a.marking_period_id IS NOT NULL AND p.id IS NULL;`)) {
    issues.push({ table: 'os_assignments', rowId: row.id, relatedTable: 'os_marking_periods',
      relationship: `marking_period_id ${row.marking_period_id}: missing period or different school year` });
  }
  for (const row of query(`SELECT pr.id, pr.person_type, pr.person_id FROM os_person_roles pr
    LEFT JOIN os_teachers t ON pr.person_type='teacher' AND t.id=pr.person_id
    LEFT JOIN os_families f ON pr.person_type IN ('father','mother') AND f.id=pr.person_id
    WHERE (pr.person_type='teacher' AND t.id IS NULL)
      OR (pr.person_type IN ('father','mother') AND f.id IS NULL)
      OR pr.person_type NOT IN ('teacher','father','mother');`)) {
    issues.push({ table: 'os_person_roles', rowId: row.id,
      relatedTable: row.person_type === 'teacher' ? 'os_teachers' : 'os_families',
      relationship: `person_id ${row.person_id}: missing or unsupported person link` });
  }
  for (const row of query(`SELECT pr.id FROM os_person_roles pr
    JOIN os_role_types rt ON rt.id=pr.role_type_id WHERE rt.group_id<>pr.group_id;`)) {
    issues.push({ table:'os_person_roles', rowId:row.id, relatedTable:'os_role_types', relationship:'role type belongs to a different group' });
  }
  return issues;
}

module.exports = { collectDataIntegrityIssues };
