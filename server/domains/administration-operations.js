const { text, json, redirectTo } = require('./results');
const { formRecord } = require('./validation');
function createService({
  BACKUP_DIR,
  DEFAULT_PORT,
  DEFAULT_SCHOOL_NAME,
  backupFrequency,
  backupPath,
  canManageSchoolSetup,
  checkLatestRelease,
  cleanText,
  createDatabaseBackup,
  db,
  fs,
  invalidateAppCaches,
  networkAccessHostForMode,
  parsePort,
  path,
  reportDataIntegrity,
  saveUploadedImage,
  setSetting,
  startSystemUpdate,
  timestampForFile,
  updateLog,
  writeUpdateStatus,
}) {
  return { paths: new Set(["/system-settings","/network-settings","/backup-settings","/backup/create","/backup/restore","/system-update/check","/system-update"]), async execute(p, body, user, req) {
    formRecord(body);
    const headers = {};
    if (p === '/system-settings') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const schoolName = cleanText(body.schoolName, 120) || DEFAULT_SCHOOL_NAME;
      setSetting('school_name', schoolName);
      const logoPath = saveUploadedImage(body.logo, 'logo');
      if (logoPath) setSetting('logo_path', logoPath);
      const faviconPath = saveUploadedImage(body.favicon, 'favicon');
      if (faviconPath) setSetting('favicon_path', faviconPath);
      return redirectTo('/setup?section=settings', headers);
    }

    if (p === '/network-settings') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      if (process.env.HOST || process.env.PORT) return text(400, 'Network settings are managed by HOST or PORT environment variables.');
      const bindHost = networkAccessHostForMode(body.accessMode) || '127.0.0.1';
      const port = parsePort(body.port, DEFAULT_PORT);
      db.transaction(() => {
        setSetting('network_bind_host', bindHost);
        setSetting('network_port', String(port));
        setSetting('network_restart_required_at', new Date().toISOString());
      });
      return redirectTo('/setup?section=network', headers);
    }

    if (p === '/backup-settings') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      setSetting('backup_frequency', backupFrequency(body.frequency));
      return redirectTo('/setup?section=backups', headers);
    }

    if (p === '/backup/create') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      createDatabaseBackup('manual');
      return redirectTo('/setup?section=backups', headers);
    }

    if (p === '/backup/restore') {
      if (!canManageSchoolSetup(user)) return text(403, 'Forbidden');
      const uploaded = body.backupFile?.data?.length ? body.backupFile : null;
      let source = '';
      if (uploaded) {
        if (!String(uploaded.filename || '').toLowerCase().endsWith('.db')) return text(400, 'Upload a .db backup file.');
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        source = path.join(BACKUP_DIR, `oakstead-backup-${timestampForFile()}-uploaded.db`);
        fs.writeFileSync(source, uploaded.data);
      } else {
        source = backupPath(body.backupFileName);
      }
      if (!source || !fs.existsSync(source)) return text(400, 'Backup file not found.');
      try {
        db.restoreDatabase(source, { beforeReplace: () => createDatabaseBackup('pre-restore') });
      } finally {
        // Both successful replacement and recovery may reopen a different file.
        invalidateAppCaches();
      }
      setSetting('backup_last_restore_at', new Date().toISOString());
      reportDataIntegrity();
      return redirectTo('/setup?section=backups', headers);
    }

    if (p === '/system-update/check') {
      if (!canManageSchoolSetup(user)) return json(403, { error: 'Forbidden' });
      try {
        return json(200, await checkLatestRelease(cleanText(body.channel, 20)), headers);
      } catch (error) {
        const status = writeUpdateStatus({ running: false, phase: 'check failed', percent: 0, message: error.message || 'Update check failed.', log: [updateLog(`ERROR ${error.message || error}`)] });
        return json(500, status, headers);
      }
    }

    if (p === '/system-update') {
      if (!canManageSchoolSetup(user)) return json(403, { error: 'Forbidden' });
      try {
        const status = await startSystemUpdate(cleanText(body.channel, 20));
        return json(202, status, headers);
      } catch (error) {
        const status = writeUpdateStatus({ running: false, phase: 'update failed', percent: 100, message: error.message || 'Update failed.', log: [updateLog(`ERROR ${error.message || error}`)] });
        return json(500, status, headers);
      }
    }


    return text(404, 'Not Found');
  } };
}
module.exports = { createService };
