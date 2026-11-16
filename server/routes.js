function createPageRoutes({
  DEMO_MODE,
  absencesPage,
  appendSetCookie,
  asInt,
  assignmentsPage,
  backupPath,
  canAccessSetup,
  canManageAcademicRecords,
  canManageSchoolSetup,
  canManageSchoolUsers,
  cleanText,
  cookieValue,
  dashboardPage,
  dataIntegrityPage,
  fs,
  gradebookPage,
  isAdmin,
  isParent,
  loginPage,
  operationalPage,
  parentPage,
  path,
  readUpdateStatus,
  redirect,
  reportCardsPage,
  reportsPage,
  securityHeaders,
  selectedPageContext,
  sendAppPage,
  sendHtml,
  sendJson,
  sendText,
  setupPage,
}) {
  function handleGet(req, res, url, pathname, user, csrfToken, headers) {
    if (pathname === '/login') {
      if (user) return redirect(res, '/', headers);
      return sendHtml(req, res, loginPage(csrfToken, url.searchParams.get('error') === '1'), headers);
    }

    if (!user) return redirect(res, '/login', headers);

    if (DEMO_MODE && pathname === '/backup/download') return sendText(res, 404, 'Not Found');
    if (DEMO_MODE && pathname === '/system-update/status') return sendJson(res, 404, { error: 'Not Found' }, headers);

    if (pathname === '/backup/download') {
      if (!canManageSchoolSetup(user)) return sendText(res, 403, 'Forbidden');
      const target = backupPath(url.searchParams.get('file'));
      if (!target || !fs.existsSync(target)) return sendText(res, 404, 'Backup not found');
      const fileName = path.basename(target);
      res.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`
      });
      return fs.createReadStream(target).pipe(res);
    }

    if (pathname === '/system-update/status') {
      if (!canManageSchoolSetup(user)) return sendJson(res, 403, { error: 'Forbidden' }, headers);
      return sendJson(res, 200, readUpdateStatus(), headers);
    }

    const context = selectedPageContext(req, url, pathname, csrfToken, user);
    if (!context) return sendText(res, 500, 'No school year configured');
    const { selected, pageArgs } = context;

    if (pathname === '/system/diagnostics') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Data Integrity', dataIntegrityPage());
    }

    if (pathname === '/system/operations') {
      if (!isAdmin(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Operational Health', operationalPage());
    }

    if (pathname === '/') {
      if (isParent(user)) return redirect(res, '/parent', headers);
      return sendAppPage(req, res, headers, pageArgs, 'Dashboard', dashboardPage(selected, user));
    }
    if (pathname === '/parent') {
      if (!isParent(user)) return redirect(res, '/', headers);
      return sendAppPage(req, res, headers, pageArgs, 'Parent Portal', parentPage(url, user, selected));
    }
    if (pathname === '/families') {
      if (!canAccessSetup(user)) return sendText(res, 403, 'Forbidden');
      return redirect(res, '/setup?section=families', headers);
    }
    if (pathname === '/setup') {
      if (!canAccessSetup(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'School Setup', setupPage(selected, csrfToken, url, user));
    }
    if (pathname === '/gradebook') {
      if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
      const markingPeriodId = asInt(url.searchParams.get('markingPeriodId'));
      if (markingPeriodId) appendSetCookie(headers, `gradebookPeriodId=${cookieValue(markingPeriodId)}; Path=/; SameSite=Strict; Max-Age=31536000`);
      const gridParam = cleanText(url.searchParams.get('grid'), 12);
      if (gridParam === 'on' || gridParam === 'off') appendSetCookie(headers, `gradebookGrid=${gridParam}; Path=/; SameSite=Strict; Max-Age=31536000`);
      return sendAppPage(req, res, headers, pageArgs, 'Gradebook', gradebookPage(req, url, user, selected, csrfToken));
    }
    if (pathname === '/assignments') {
      if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Assignments', assignmentsPage(req, url, user, selected, csrfToken));
    }
    if (pathname === '/report-cards') {
      if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Report Cards', reportCardsPage(url, selected, user));
    }
    if (pathname === '/absences') {
      if (!canManageAcademicRecords(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Absences', absencesPage(url, selected, csrfToken, user));
    }
    if (pathname === '/reports') {
      if (isParent(user)) return sendText(res, 403, 'Forbidden');
      return sendAppPage(req, res, headers, pageArgs, 'Reports', reportsPage(url, selected, user));
    }
    if (pathname === '/users') {
      if (!canManageSchoolUsers(user)) return sendText(res, 403, 'Forbidden');
      return redirect(res, '/setup?section=users', headers);
    }

    return sendText(res, 404, 'Not Found');
  }

  return handleGet;
}
module.exports = { createPageRoutes };
