# School Grade Tracker

## Recommended stack
For a polished long-term product, the best fit is **Django + HTMX (or React where needed) with SQLite/PostgreSQL** because this project is heavily form/data-workflow driven.

In this environment, package installation is blocked by a proxy policy, so this rebuild ships as a dependency-light Node app using:
- built-in HTTP server
- **SQLite database** (`school.db`)
- server-rendered UI with a simplified menu

## What this version includes
- Families + students CRM
- Gradebook entry workflow
- Unified **Settings** page for teachers, terms, classrooms, curriculum, and grade weights
- Automatic numeric student promotion when creating a new term

## Run

```bash
npm start
```

Then open: `http://localhost:3000`

## Data
- SQLite file: `school.db`
