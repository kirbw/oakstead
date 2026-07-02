const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');

function loadEnvFile(appRoot = APP_ROOT) {
  const envFile = path.join(appRoot, '.env');
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) return;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  });
}

function parsePort(value, fallback = 3000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function cleanBindHost(value, fallback = '127.0.0.1') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (text === 'localhost' || text === '127.0.0.1' || text === '0.0.0.0') return text;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) return text;
  return fallback;
}

function cleanUpdateMode(value) {
  return String(value || '').toLowerCase() === 'installer' ? 'installer' : 'git';
}

function normalizeRepositorySlug(value) {
  const text = String(value || '').trim();
  const githubMatch = text.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[#?].*)?$/i);
  if (githubMatch) return `${githubMatch[1]}/${githubMatch[2].replace(/\.git$/i, '')}`;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text) ? text : '';
}

loadEnvFile();

const PACKAGE_INFO = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
const APP_VERSION = PACKAGE_INFO.version || '0.0.0';
const DATA_DIR_IS_CUSTOM = Boolean(process.env.OAKSTEAD_DATA_DIR);
const DATA_DIR = path.resolve(process.env.OAKSTEAD_DATA_DIR || APP_ROOT);
const DEFAULT_PORT = parsePort(process.env.OAKSTEAD_DEFAULT_PORT, 3000);
const DEFAULT_HOST = cleanBindHost(process.env.OAKSTEAD_DEFAULT_HOST, '127.0.0.1');
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'school.db');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOAD_DIR = DATA_DIR_IS_CUSTOM ? path.join(DATA_DIR, 'uploads') : path.join(PUBLIC_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DEFAULT_LOGO_FILE = path.join(APP_ROOT, 'assets', 'oakleaf.png');
const LEGACY_LOGO_FILE = path.join(PUBLIC_DIR, 'oakstead-logo.svg');
const UPDATE_STATUS_FILE = path.join(DATA_DIR, '.oakstead-update-status.json');
const SQLITE_BIN = process.env.SQLITE_BIN || 'sqlite3';
const UPDATE_MODE = cleanUpdateMode(process.env.OAKSTEAD_UPDATE_MODE || 'git');
const PACKAGE_REPO = normalizeRepositorySlug(typeof PACKAGE_INFO.repository === 'string' ? PACKAGE_INFO.repository : PACKAGE_INFO.repository?.url)
  || 'kirbw/oakstead';
const APP_REPOSITORY_URL = `https://github.com/${PACKAGE_REPO}`;
const RELEASE_REPO = normalizeRepositorySlug(process.env.OAKSTEAD_RELEASE_REPO)
  || PACKAGE_REPO;
const DEFAULT_SCHOOL_NAME = 'Oakstead';
const MAX_BODY_SIZE = 50_000_000;
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const DEMO_MODE = /^(1|true|yes|on)$/i.test(String(process.env.DEMO_MODE || ''));
const DEMO_REFRESH_HOURS = Math.max(1, Math.min(24, Number(process.env.DEMO_REFRESH_HOURS) || 2));
const DEMO_HIDDEN_SETUP_SECTIONS = new Set(['network', 'backups', 'updates']);
const DEMO_HIDDEN_POST_PATHS = new Set(['/network-settings', '/backup-settings', '/backup/create', '/backup/restore', '/system-update/check', '/system-update']);

module.exports = {
  APP_ROOT,
  PACKAGE_INFO,
  APP_VERSION,
  DATA_DIR_IS_CUSTOM,
  DATA_DIR,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DB_FILE,
  PUBLIC_DIR,
  UPLOAD_DIR,
  BACKUP_DIR,
  DEFAULT_LOGO_FILE,
  LEGACY_LOGO_FILE,
  UPDATE_STATUS_FILE,
  SQLITE_BIN,
  UPDATE_MODE,
  PACKAGE_REPO,
  APP_REPOSITORY_URL,
  RELEASE_REPO,
  DEFAULT_SCHOOL_NAME,
  MAX_BODY_SIZE,
  SESSION_HOURS,
  LOGIN_WINDOW_MS,
  LOGIN_LOCK_MS,
  MAX_LOGIN_FAILURES,
  DEMO_MODE,
  DEMO_REFRESH_HOURS,
  DEMO_HIDDEN_SETUP_SECTIONS,
  DEMO_HIDDEN_POST_PATHS,
  cleanBindHost,
  cleanUpdateMode,
  loadEnvFile,
  normalizeRepositorySlug,
  parsePort
};
