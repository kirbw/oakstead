# School Grade Tracker

A modernized, mobile-first school operations app with SQLite persistence.

## Highlights

- 2026-style responsive UI designed mobile-first (iPhone), then scales to iPad/laptop layouts
- Built-in light + dark mode toggle with persisted user preference
- Unified workflows for families, students, settings, and gradebook operations
- Security hardening for internet exposure:
  - strict security headers (CSP, frame protections, referrer policy, etc.)
  - CSRF protection for all form posts
  - request body size limit
  - consistent output escaping and constrained input handling

## Tech

- Node.js built-in HTTP server
- SQLite database (`school.db`) via `sqlite3` CLI
- Server-rendered HTML/CSS/JS (no frontend framework required)

## Run

```bash
npm start
```

Open: `http://localhost:3000`

## Validate

```bash
npm run check
```
