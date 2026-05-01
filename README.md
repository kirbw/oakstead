# Oakstead

**Rooted Records for Growing Minds.**

Current version: **0.0.3**

Oakstead is a small-school records and gradebook app built for simple daily classroom use. It keeps families, children, birthdays, yearly grade placement, classrooms, teachers, grade-level subjects, gradebook entries, and averages in one responsive web app.

## Highlights

- Responsive layout for iPhone, iPad, and desktop
- School-year switcher for viewing current or prior-year records
- Year-specific enrollment history so students can be promoted without losing old grades
- Family and child entry with birthdays, grade placement, and classroom assignment
- Teacher, classroom, grade, and subject setup
- Fast gradebook entry by school year, grade, classroom, subject, and assignment
- Lesson, quiz, and test categories
- Quick score buttons for entering a whole class in one pass
- Spreadsheet-style gradebook grid with inline score saving
- Custom grade weights and letter grade scales by year, grade range, and subject
- Reports for class averages and student subject averages
- Admin and teacher sign-ins with secure sessions and CSRF protection
- In-app system updates from GitHub with current release and pre-release channels

## Tech

- Node.js built-in HTTP server
- SQLite database via the `sqlite3` CLI
- Server-rendered HTML/CSS/JS with no frontend framework

The app stores its primary data in `school.db` by default. For testing, you can point it at a different database file:

```bash
DB_FILE=/tmp/oakstead-test.db PORT=3001 npm start
```

## Requirements

- Node.js with npm available on the server.
- The `sqlite3` command-line program available in `PATH`. Oakstead shells out to the SQLite CLI for database reads, writes, backup validation, and restore checks.
- A writable project directory for `school.db`, `backups/`, `public/uploads/`, `.oakstead-update-status.json`, and any custom uploaded school assets.
- Git available in `PATH` if you want to use in-app system updates from a GitHub remote.
- A trusted local network, VPN, or protective reverse proxy. Oakstead should not be exposed directly to the public internet.

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

## Configuration

Oakstead loads environment variables from a local `.env` file when present. Common settings:

- `PORT`: HTTP port. Defaults to `3000`.
- `DB_FILE`: SQLite database path. Defaults to `school.db` in the project directory.
- `DEMO_MODE`: Set to `1`, `true`, `yes`, or `on` to run demo mode.
- `DEMO_REFRESH_HOURS`: Demo reset interval from 1 to 24 hours. Defaults to `2`.

Example `.env`:

```bash
PORT=3000
DB_FILE=/srv/oakstead/school.db
```

Use the included demo seed script only for demo or disposable data:

```bash
node scripts/seed-demo.js --reset
```

## Security and Deployment

Oakstead stores sensitive student and family records. Do not publish it directly to the internet. If it must be reachable outside a trusted local network or VPN, place it behind a protective edge layer such as Cloudflare, another WAF, or an equivalent reverse proxy with HTTPS, rate limiting, access controls, and request filtering.

For production installs, run Oakstead under a supervisor such as systemd or pm2 so the app starts after reboots and can restart cleanly after in-app updates. Back up `school.db`, `backups/`, and uploaded assets before server maintenance or version upgrades.

## Validate

```bash
npm run check
```

## System Updates

Administrators can update Oakstead from **School Setup -> System Updates**. Choose **Current release** for the latest stable version, or **Pre-release** to install the newest pre-release tag when one is available. The updater fetches GitHub tags from the configured `origin` remote, checks out the selected release, runs `npm install`, validates the server with `npm run check`, and restarts the app.

Before updating, commit or clear local code changes. Oakstead creates a database backup before updating, but you should still keep an external backup plan for production data.

## Release Notes

Release notes are also kept in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

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
