# Oakstead

**Rooted Records for Growing Minds.**

Current version: **0.0.1**

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

## Run

```bash
npm start
```

Open `http://localhost:3000`.

Default bootstrap login:

```text
admin / ChangeMeNow!
```

Change the default password before using this with real school data.

## Validate

```bash
npm run check
```

## System Updates

Administrators can update Oakstead from **School Setup -> System Updates**. Choose **Current release** for the latest stable version, or **Pre-release** to install the newest pre-release tag when one is available. The updater fetches GitHub tags from the configured `origin` remote, checks out the selected release, runs `npm install`, validates the server with `npm run check`, and restarts the app.

For production installs, run Oakstead under a supervisor such as systemd or pm2 so a process exit can restart cleanly after updates.

## Release Notes

Release notes are also kept in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

### 0.0.1

- Initial Oakstead release with family, student, teacher, classroom, subject, school-year, gradebook, absence, report, and report-card workflows.
- Added admin and teacher accounts with session security and CSRF protection.
- Added customizable school name, logo, and favicon settings.
- Added default Oakstead oak leaf logo and favicon.
- Added in-app GitHub system updater with progress display.
- Added visible application versioning from `package.json`.
