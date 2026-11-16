# v0.0.11

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
