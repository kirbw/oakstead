# Release Notes

## 0.0.11

This release includes the merged changes since tag `0.0.10`: PRs #22, #23,
#26–#51. It improves grading reliability, access control, database recovery,
performance and mobile usability.

## Grading and daily use

- Reliable queued grade autosave with visible status, timeout, retry and navigation
  protection. Blank scores clear consistently; omitted scores remain unchanged.
- Whole-number grades retain trailing zeroes (90 stays 90). Ungraded periods no
  longer count as zero in averages; legitimate zero scores still count.
- Assignment and dashboard access consistently follow teacher grade/classroom
  permissions, including bulk submissions. Unauthorized mixed writes are rejected.
- Marking-period edits preserve assignment links and reject removal of referenced
  periods. School dates behave consistently across timezones.
- Unicode names and text survive multipart form submissions and file uploads.

## Reliability and administration

- Malformed cookies no longer crash requests; expired sessions are rejected accurately.
- Backups run on schedule while the application stays open, with overlap protection
  and retry after failures. Existing daily/weekly/30-day monthly intervals remain.
- Restores validate integrity, application structure and required constraints in a
  staged copy before replacing the active database, with recovery on failure.
- Foreign keys are enforced. Historical relationship problems are preserved and
  reported through administrator diagnostics rather than automatically repaired.
- Versioned transactional schema migrations are shared by startup and restore.
- Startup/shutdown explicitly manage database connections, requests and background
  jobs; normal shutdown allows requests up to five seconds to finish.
- Safe request errors retain submitted values and include request IDs. Administrator
  operational metrics and a minimal public `/health` readiness endpoint are available.

## Speed and appearance

- Grade calculations load/group scores once per request and avoid unrelated periods.
  Representative graph benchmark: 108 queries reduced to 3; median 725.60ms to 86ms.
- Setup loads only the selected section. Representative Network view: 20 queries /
  1,613 rows reduced to 2 queries / 1 row. These are fixture results, not production SLAs.
- Refreshed green visual styling, shared accessible controls, keyboard focus,
  loading/save/error states, dark-theme contrast and mobile touch targets.
- Percentage badges stay on one line; phone dashboard averages remain visible.
  Gradebook headings stay beneath mobile navigation. Wide tables/report previews
  scroll within their containers.
- Domain services, validation, rendering and request handling now have clearer boundaries.

## Compatibility and upgrade notes

- Requires Node 22.13 or newer. No new dependencies.
- Back up the database before upgrading. Startup establishes schema version 1 and
  applies supported additive migrations. Reverting application code does not undo
  migrations; unsupported future versions are rejected rather than downgraded.
- Historical orphan records remain intact and appear in diagnostics. Constraint
  enforcement may reject invalid writes or restrictive deletes previously accepted.
- Existing routes, role rules, grading rules and supported older backups are retained.
- Release publication does not deploy the application or repair historical data.

## Validation

All 74 tests pass on Node 22.13 and development Node 26.13.1 on Windows, including
syntax/refactor, restore recovery, lifecycle and authorization checks. Browser QA
covers staff/parent flows, Setup and keyboard grade entry. Mobile QA recorded 60
layout checks across six portrait sizes, landscape and demo-visible Setup sections.
Physical iPhone/Safari, iOS keyboard/zoom/safe areas and OS reduced-motion checks
remain manual verification items.

See `docs/quality-improvement-plan.md`, `docs/quality-improvement-round-2.md`,
`docs/performance-results.md` and `docs/mobile-layout-review.md` for PR links,
compatibility details, benchmarks and screenshots.

## 0.0.10

**Breaking: requires Node.js 22.13 or newer.** Oakstead now uses Node's built-in
`node:sqlite` module instead of shelling out to the `sqlite3` CLI, so the CLI is
no longer needed anywhere. When updating an existing source install, upgrade Node
before restarting the service or it will exit on startup. Node 22.5–22.12 gate
`node:sqlite` behind the `--experimental-sqlite` flag, so use 22.13+ or 24+.
On Debian/Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`.
Packaged Windows installs bundle their own Node runtime and are unaffected.

Performance:

- Replaced the per-statement `sqlite3` subprocess model with a persistent
  in-process `node:sqlite` connection (WAL mode). Typical authenticated pages now
  render in a few milliseconds instead of hundreds, and requests no longer
  serialize behind one another.
- Serve the app stylesheet and script as cached, content-versioned `/assets/app.css`
  and `/assets/app.js` files, and gzip HTML responses, so navigation after the
  first load transfers far less data.
- Save gradebook scores in a single transaction and authorize them with one
  set-based query instead of one query per student.
- Cache school-year and settings lookups for the read hot path.
- Removed the unused 906KB `html2pdf` bundle from the app and installer.

Security and correctness:

- Ship with authentication enabled by default. `DEMO_MODE` (which disables all
  authentication) is now off unless explicitly set, `.env` is no longer tracked in
  git, and the server warns loudly if demo mode runs on a non-loopback address.
- Locked the Content-Security-Policy `script-src` to the app's own script (no more
  `unsafe-inline`).
- Hardened the year switcher against malformed `Referer` headers and open redirects.
- Stopped tracking database backups (`backups/*.db`) that contained real records.

## 0.0.9

- Refactored the server startup, configuration, HTTP helpers, input normalization, and gradebook form helpers into focused modules while preserving existing behavior.
- Simplified GET request dispatch and shared gradebook score redirect/parsing logic for safer maintenance.
- Added dependency-free refactor regression checks for the extracted helper behavior.

## 0.0.8

- Hid Network Access, Backups, and System Updates from School Setup while running in demo mode, including direct access to the related backup and update routes.
- Fixed gradebook grid autosave ordering so student averages stay current when entering scores quickly.

## 0.0.7

- Improved the Reports dashboard with clearer visual summaries, more readable chart styling, and report-specific icons.
- Cleaned up printable reports by removing the demo-mode banner from print output.
- Fixed grade graph report pagination so the report content starts correctly and avoids extra blank pages.
- Refined grade graph print charts with a more compact layout that fits the grade report more reliably.
- Improved the Absences page with compact grade and student filters in the list header, a dedicated Grade column, formatted absence/tardy labels, and cleaner amount display.
- Enforced teacher-scoped absence visibility so teachers only see students in the grades and classrooms they are responsible for.
- Added smoother app-shell navigation for internal pages and GET filters so the header, logo, and sidebar stay in place while main content updates.
- Linked the footer version label to the Oakstead GitHub repository.
- Added headless network access commands for checking or switching between local-only and trusted-LAN mode.

## 0.0.6

- Added cross-platform runtime configuration for data directories, SQLite executable paths, bind hosts, ports, and update modes.
- Added School Setup -> Network Access for local-only or trusted-LAN hosting with visible host/IP URLs and restart-gated changes.
- Added packaged Windows update checks that read GitHub release assets and download installer updates instead of running Git commands.
- Added Windows installer/service packaging scaffolding with bundled runtime expectations, ProgramData storage, WinSW service config, and Inno Setup script.
- Added Linux systemd packaging examples that keep source installs on the Git-based updater.

## 0.0.5

- Added principal and parent roles alongside admins and teachers, with role-scoped navigation and route permissions.
- Added a parent portal for household-linked child grade graphs and report cards.
- Scoped teacher academic workflows to assigned classrooms, including assignments, gradebook scores, report cards, reports, and absences.
- Expanded user management with teacher and parent-family links, plus admin-only protection for admin and principal accounts.
- Improved the responsive app shell with a compact mobile top bar, dropdown navigation, sticky desktop sidebar, safe-area spacing, and better small-screen table handling.
- Refined absence entry with segmented type and unit controls plus responsive form layout.
- Added demo principal, teacher, and parent users to the demo seed data for role testing.

## 0.0.4

- Added congregation tracking with setup management, family assignment, family-list display, and family report columns.
- Reworked the family setup form into Household, Contact, and Church and District sections for faster data entry.
- Stored parent names as first names in family workflows while keeping household last names separate.
- Updated gradebook grid autosave so assignment, student, and class averages refresh immediately after a score is saved.
- Simplified gradebook assignment display titles by removing generated category prefixes.
- Expanded demo seed data with school districts, congregations, and first-name parent records.
- Added a static project website page in `website/`.

## 0.0.3

- Added an optional spreadsheet-style gradebook grid with students down the side, assignments across the top, sticky headers, class averages, per-student averages, and inline score saving.
- Added gradebook controls for switching between standard assignment entry and grid entry, remembering the selected grid mode and marking period.
- Added inline assignment creation, editing, and deletion from the grid view.
- Added customizable letter grade scales by school year, grade range, and subject, with default letter grade groups created automatically.
- Added letter grade display alongside percentage averages in gradebook grid cells, class rows, and student averages, with an option to hide letters.
- Improved assignment history in the standard gradebook view with selectable assignment cards and clearer score/average summaries.
- Improved grade graph print charts with larger line graphs, clearer period labels, and score labels.

## 0.0.2

- Added demo mode with `.env` support, automatic refresh scheduling, and a demo seed script for realistic families, students, teachers, subjects, assignments, and scores.
- Added database backup management with manual backups, scheduled backup frequency settings, backup downloads, restore from saved or uploaded `.db` files, and automatic pre-update/pre-restore backups.
- Added richer report workflows including report navigation, family and student print reports, school board roles, birthday reports, and grade graph reporting for full grades or individual students.
- Added role group and role assignment management for parents and teachers, including school board role reporting.
- Improved account and security controls with teacher-linked users, login throttling, larger validated uploads, safer image detection, and added security/deployment guidance.
- Improved system updates with explicit update checks, pre-update backup creation, and clearer update status handling.
- Added project metadata and housekeeping updates including MIT license metadata, `.env.example`, ignored local env/backup files, and expanded documentation.

## 0.0.1

- Initial Oakstead release with family, student, teacher, classroom, subject, school-year, gradebook, absence, report, and report-card workflows.
- Added admin and teacher sign-ins with secure sessions and CSRF protection.
- Added customizable school name, logo, and favicon settings.
- Added the Oakstead oak leaf as the default logo and favicon.
- Added in-app GitHub system updates under School Setup with current release and pre-release channels.
- Added visible application versioning sourced from `package.json`.
