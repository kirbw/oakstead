# Oakstead

**Rooted Records for Growing Minds.**

Current version: **0.0.8**

Oakstead is a small-school records and gradebook app built for simple daily classroom use. It keeps families, children, birthdays, yearly grade placement, church and district affiliations, classrooms, teachers, grade-level subjects, gradebook entries, and averages in one responsive web app.

## Highlights

- Responsive layout for iPhone, iPad, and desktop
- School-year switcher for viewing current or prior-year records
- Year-specific enrollment history so students can be promoted without losing old grades
- Family and child entry with birthdays, grade placement, and classroom assignment
- Congregation and school district tracking for households
- Teacher, classroom, grade, and subject setup
- Fast gradebook entry by school year, grade, classroom, subject, and assignment
- Lesson, quiz, and test categories
- Quick score buttons for entering a whole class in one pass
- Spreadsheet-style gradebook grid with inline score saving
- Custom grade weights and letter grade scales by year, grade range, and subject
- Reports for class averages and student subject averages
- Polished report dashboard charts, report icons, and cleaner printable grade graphs
- Printable family reports with congregation, contact, address, and enrolled-student counts
- Absence tracking with grade and student filters, formatted type labels, and role-scoped visibility
- Admin, principal, teacher, and parent sign-ins with secure sessions and CSRF protection
- Parent portal for household-linked child grade graphs and report cards
- Smoother app-shell navigation for internal pages and filters
- In-app system updates from GitHub with current release and pre-release channels
- Local-only or trusted-LAN hosting modes with visible host URLs
- Windows installer packaging support with service, bundled SQLite, and release-asset update checks
- Static project website page in `website/`

## Tech

- Node.js built-in HTTP server
- SQLite database via the `sqlite3` CLI
- Server-rendered HTML/CSS/JS with no frontend framework

The app stores its primary data in `school.db` by default. For testing, you can point it at a different database file:

```bash
DB_FILE=/tmp/oakstead-test.db PORT=3001 npm start
```

## Requirements

- Node.js with npm available on the server for source installs.
- The `sqlite3` command-line program available in `PATH`, or set `SQLITE_BIN` to an explicit executable path. Oakstead shells out to the SQLite CLI for database reads, writes, backup validation, and restore checks.
- A writable runtime data directory for `school.db`, `backups/`, uploads, `.oakstead-update-status.json`, and any custom school assets.
- Git available in `PATH` if you want to use in-app system updates from a GitHub remote.
- A trusted local network, VPN, or protective reverse proxy. Oakstead should not be exposed directly to the public internet.

Packaged Windows installs bundle Node.js and SQLite, run as a Windows service, and store runtime data outside the install folder.

On Debian or Ubuntu, the system packages usually look like:

```bash
sudo apt install nodejs npm sqlite3 git
```

## Install and Run

Clone or copy the Oakstead project onto the server, then install npm metadata and start the app:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Default bootstrap login:

```text
admin / ChangeMeNow!
```

Change the default password before using this with real school data.

## User Roles

Oakstead has four app login roles:

- **Admin**: full access, including creating and editing other admins.
- **Principal**: full school operations access, including setup, reports, backups, updates, teachers, and parent/teacher users, but cannot create or edit admin or principal accounts.
- **Teacher**: can manage assignments, grades, report cards, and absences for students in classrooms linked to their teacher record. Teachers cannot access School Setup.
- **Parent**: can use the parent portal for children in their linked family household, including grade graphs and report cards. Parents cannot change school records.

## Configuration

Oakstead loads environment variables from a local `.env` file when present. Common settings:

- `PORT`: HTTP port. Defaults to `3000`.
- `HOST`: Explicit bind host. Use `127.0.0.1` for local-only access or `0.0.0.0` for LAN access. If set, it overrides the in-app Network Access setting.
- `OAKSTEAD_DEFAULT_HOST`: Default bind host used when `HOST` is not set. Defaults to `127.0.0.1`.
- `OAKSTEAD_DEFAULT_PORT`: Default port used when `PORT` is not set. Defaults to `3000`.
- `OAKSTEAD_DATA_DIR`: Runtime data directory for `school.db`, backups, uploads, and update status. Defaults to the project directory for source installs.
- `DB_FILE`: SQLite database path. Defaults to `school.db` inside `OAKSTEAD_DATA_DIR`.
- `SQLITE_BIN`: SQLite CLI executable. Defaults to `sqlite3`.
- `OAKSTEAD_UPDATE_MODE`: `git` for source installs or `installer` for packaged Windows installs. Defaults to `git`.
- `OAKSTEAD_RELEASE_REPO`: GitHub release repository slug for installer updates, for example `kirbw/oakstead`.
- `DEMO_MODE`: Set to `1`, `true`, `yes`, or `on` to run demo mode.
- `DEMO_REFRESH_HOURS`: Demo reset interval from 1 to 24 hours. Defaults to `2`.

The in-app Network Access setting is saved in `school.db`. On a headless Linux host, you can update that saved mode from SSH:

```bash
sudo systemctl stop oakstead
sudo -u oakstead env OAKSTEAD_DATA_DIR=/var/lib/oakstead SQLITE_BIN=/usr/bin/sqlite3 node /opt/oakstead/server.js --set-network-access lan
sudo systemctl restart oakstead
```

Use `--set-network-access local` to return to local-only mode, or `--network-status` to print the saved and next-start URLs. For emergency LAN recovery, setting `HOST=0.0.0.0` in the service environment also works because `HOST` overrides the saved setting until it is removed.

Example `.env`:

```bash
PORT=3000
OAKSTEAD_DATA_DIR=/srv/oakstead
SQLITE_BIN=/usr/bin/sqlite3
```

Use the included demo seed script only for demo or disposable data:

```bash
node scripts/seed-demo.js --reset
```

## Security and Deployment

Oakstead stores sensitive student and family records. Do not publish it directly to the internet. If it must be reachable outside a trusted local network or VPN, place it behind a protective edge layer such as Cloudflare, another WAF, or an equivalent reverse proxy with HTTPS, rate limiting, access controls, and request filtering.

For production installs, run Oakstead under a supervisor such as systemd or pm2 so the app starts after reboots and can restart cleanly after in-app updates. Back up `school.db`, `backups/`, and uploaded assets before server maintenance or version upgrades.

## Windows Installer and LAN Access

Windows packaging files live in `packaging/windows/`. The installer path stages Oakstead with:

- App files under `Program Files\Oakstead`.
- Runtime data under `%ProgramData%\Oakstead`.
- A Windows service that starts Oakstead on boot.
- Bundled Node.js and `sqlite3.exe`.
- Optional Windows Firewall rule for TCP port `3000`.

Prepare the package after adding the local vendor runtimes described in `packaging/windows/README.md`:

```bash
npm run prepare:windows
```

Then compile `packaging/windows/Oakstead.iss` with Inno Setup. The service uses installer-update mode, so creating a new GitHub release should include an asset named like `Oakstead-Setup-v0.0.8.exe`.

Admins can use **School Setup -> Network Access** to switch between local-only access and LAN access. LAN mode binds Oakstead to `0.0.0.0`; other devices use the host machine IP shown on that page.

## Validate

```bash
npm run check
```

## System Updates

Administrators can update Oakstead from **School Setup -> System Updates**. Choose **Current release** for the latest stable version, or **Pre-release** to install the newest pre-release when one is available.

Source installs use `OAKSTEAD_UPDATE_MODE=git`: the updater fetches GitHub tags from the configured `origin` remote, checks out the selected release, runs `npm install`, validates the server with `npm run check`, and restarts the app.

Packaged Windows installs use `OAKSTEAD_UPDATE_MODE=installer`: the updater checks GitHub Releases for a Windows installer asset, creates a pre-installer backup, and gives the admin the installer download. Running the installer replaces app files while preserving the data directory.

Before updating, commit or clear local code changes. Oakstead creates a database backup before updating, but you should still keep an external backup plan for production data.

## Release Notes

Release notes are also kept in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

### 0.0.8

- Hid Network Access, Backups, and System Updates from School Setup while running in demo mode.
- Fixed gradebook grid autosave ordering so student averages stay current when entering scores quickly.

### 0.0.7

- Improved the Reports dashboard with clearer visual summaries, more readable chart styling, and report-specific icons.
- Cleaned up printable reports by removing the demo-mode banner from print output.
- Fixed grade graph report pagination so the report content starts correctly and avoids extra blank pages.
- Refined grade graph print charts with a more compact layout that fits the grade report more reliably.
- Improved the Absences page with compact grade and student filters in the list header, a dedicated Grade column, formatted absence/tardy labels, and cleaner amount display.
- Enforced teacher-scoped absence visibility so teachers only see students in the grades and classrooms they are responsible for.
- Added smoother app-shell navigation for internal pages and GET filters so the header, logo, and sidebar stay in place while main content updates.

### 0.0.6

- Added cross-platform runtime configuration for data directories, SQLite executable paths, bind hosts, ports, and update modes.
- Added School Setup -> Network Access for local-only or trusted-LAN hosting with visible host/IP URLs and restart-gated changes.
- Added packaged Windows update checks that read GitHub release assets and download installer updates instead of running Git commands.
- Added Windows installer/service packaging scaffolding with bundled runtime expectations, ProgramData storage, WinSW service config, and Inno Setup script.
- Added Linux systemd packaging examples that keep source installs on the Git-based updater.

### 0.0.5

- Added principal and parent roles alongside admins and teachers, with role-scoped navigation and route permissions.
- Added a parent portal for household-linked child grade graphs and report cards.
- Scoped teacher academic workflows to assigned classrooms, including assignments, gradebook scores, report cards, reports, and absences.
- Expanded user management with teacher and parent-family links, plus admin-only protection for admin and principal accounts.
- Improved the responsive app shell with a compact mobile top bar, dropdown navigation, sticky desktop sidebar, safe-area spacing, and better small-screen table handling.
- Refined absence entry with segmented type and unit controls plus responsive form layout.
- Added demo principal, teacher, and parent users to the demo seed data for role testing.

### 0.0.4

- Added congregation tracking with setup management, family assignment, family-list display, and family report columns.
- Reworked the family setup form into Household, Contact, and Church and District sections for faster data entry.
- Stored parent names as first names in family workflows while keeping household last names separate.
- Updated gradebook grid autosave so assignment, student, and class averages refresh immediately after a score is saved.
- Simplified gradebook assignment display titles by removing generated category prefixes.
- Expanded demo seed data with school districts, congregations, and first-name parent records.
- Added a static project website page in `website/`.

### 0.0.3

- Added an optional spreadsheet-style gradebook grid with students down the side, assignments across the top, sticky headers, class averages, per-student averages, and inline score saving.
- Added gradebook controls for switching between standard assignment entry and grid entry, remembering the selected grid mode and marking period.
- Added inline assignment creation, editing, and deletion from the grid view.
- Added customizable letter grade scales by school year, grade range, and subject, with default letter grade groups created automatically.
- Added letter grade display alongside percentage averages in gradebook grid cells, class rows, and student averages, with an option to hide letters.
- Improved assignment history in the standard gradebook view with selectable assignment cards and clearer score/average summaries.
- Improved grade graph print charts with larger line graphs, clearer period labels, and score labels.

### 0.0.2

- Added demo mode with `.env` support, automatic refresh scheduling, and a demo seed script for realistic families, students, teachers, subjects, assignments, and scores.
- Added database backup management with manual backups, scheduled backup frequency settings, backup downloads, restore from saved or uploaded `.db` files, and automatic pre-update/pre-restore backups.
- Added richer report workflows including report navigation, family and student print reports, school board roles, birthday reports, and grade graph reporting for full grades or individual students.
- Added role group and role assignment management for parents and teachers, including school board role reporting.
- Improved account and security controls with teacher-linked users, login throttling, larger validated uploads, safer image detection, and added security/deployment guidance.
- Improved system updates with explicit update checks, pre-update backup creation, and clearer update status handling.
- Added project metadata and housekeeping updates including MIT license metadata, `.env.example`, ignored local env/backup files, and expanded documentation.

### 0.0.1

- Initial Oakstead release with family, student, teacher, classroom, subject, school-year, gradebook, absence, report, and report-card workflows.
- Added admin and teacher accounts with session security and CSRF protection.
- Added customizable school name, logo, and favicon settings.
- Added default Oakstead oak leaf logo and favicon.
- Added in-app GitHub system updater with progress display.
- Added visible application versioning from `package.json`.
