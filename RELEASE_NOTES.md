# Release Notes

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
