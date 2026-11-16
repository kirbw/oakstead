# Oakstead improvement plan: twelve sequential PRs

Approved implementation plan. Preserve the completed first-round checklist.
Implement the six fixes first, followed by the first six Nexus-inspired patterns.
Merge each PR before starting the next branch from updated main.

## Workflow and shared gates

1. Create the specified codex/ branch from updated main; keep it focused.
2. Implement the change and meaningful regression tests using Node's built-in tools,
   temporary databases, and disposable application processes. Add no dependencies.
3. Run focused tests followed by npm test (syntax, existing refactor checks, tests).
   Validate runtime changes on Node 22.13 and the development runtime; restores and
   lifecycle changes require Windows coverage.
4. Browser-check changed screens/flows and capture screenshots. If tooling fails,
   record the attempt, cause, and exact manual verification steps.
5. Open a PR describing problem, resulting behavior, validation, compatibility,
   and recovery where relevant. Save its URL and implementation notes here.
6. Merge after checks pass, confirm the merge, update main, and delete that exact
   branch locally and remotely. Check off only after merge, in the following PR.
7. After PR 12, submit a final documentation-only PR recording its completion;
   protected main must not receive direct tracking commits.

Every entry records status, branch, PR URL, implementation notes, validation,
screenshots, compatibility/recovery notes, and merge commit. Planned entries use
"Pending" until implementation provides actual evidence.

Reuse grade/Setup benchmarks for relevant changes; record comparable results and
resolve material regressions before merge. Preserve production data, historical
records, current routes, role rules, and supported backup compatibility except
where an item explicitly specifies a correction. Historical repairs require
separate approval. Exclude CI expansion, framework replacement, external telemetry,
offline grade storage, deployment, and historical-data repair. PR merge is not
production rollout. Leave unrelated local files untouched.

## Part A — Six bug fixes

- [x] **1. Make grade autosave reliable**
  - Branch: `codex/reliable-grade-autosave`. Status: merged.
  - Plan: DOM-independent pending edits keyed by year/assignment/student; reachable
    debounce, serialized saves, coalesced latest values, correct in-flight reverts.
    Add a 30-second timeout, saving/saved/failed states, retained errors and explicit
    retry/discard. Hold internal navigation/forms until saves finish; warn on unload.
    Preserve permissions and last-write-wins; no persistent browser grade storage.
  - Acceptance: multiple delayed saves followed by navigation persist final values;
    cover rapid typing, in-flight revert, clearing, zero, timeout, rejection, retry,
    discard, blocked navigation, and keyboard entry.
  - Implementation: dependency-free score queue embedded in the existing hashed
    client asset; captures request fields before navigation; stops on errors and
    exposes retry/discard; captures form submissions and guards page navigation.
  - Validation: six queue regression tests; npm test passes all 35 tests on Node
    26.13; all 35 tests also pass on Node 22.13. Final npm test passes; minimum-runtime syntax/refactor/tests pass. Browser verified
    two edits (90/75), Tab entry, navigation away and back, persisted averages, and
    no console errors. Screenshot capture attempted through Edge but timed out.
  - PR: https://github.com/kirbw/oakstead/pull/38. Screenshots: unavailable (Edge Page.captureScreenshot timeout).
    Manual check: enter two grades, Tab to the next student, immediately navigate
    to Dashboard, return, and confirm both grades. Simulate a failed save, verify
    leaving is blocked, then retry or explicitly discard. Merge commit: 7746d26925169c264be8945371275b247dbd0c7c (2026-11-16).
  - Compatibility/recovery: no schema or permission changes. Sudden process/tab
    termination cannot guarantee completion; unload warning is best effort.

- [x] **2. Restrict the teacher dashboard consistently**
  - Branch: `codex/scope-teacher-dashboard`. Status: merged.
  - Plan: pass authenticated user into dashboard loading. Scope counts, recent
    assignments, charts, and averages through existing grade/classroom access rules.
    Admin/principal remain schoolwide; parent redirect unchanged; no creator rule.
  - Acceptance: contrasting role fixtures cannot leak other grades/classrooms via
    names, counts, or statistics; authorized grade/classroom access remains.
  - Implementation: central assignment scope now includes authorized grades and
    classrooms; dashboard uses that scope and accessible enrolled students for all
    counts and score aggregates. Administrator/principal behavior remains schoolwide.
  - Validation: npm test and Node 22.13 syntax/refactor/full tests pass (36 tests).
    Role fixture covers hidden grades/classrooms, cross-year zero counts, inaccessible
    student scores, teacher-created-by-others access, and parent redirect. Edge
    browser verified teacher KPI values 1/1/1/1/2 and only authorized assignments.
  - Screenshots: capture attempted; Edge CDP timed out again. Manual check: compare
    teacher and admin Dashboard, change school year, confirm scoped counts/entries.
  - Compatibility: no schema change; existing grade/classroom rules reused.
  - PR: https://github.com/kirbw/oakstead/pull/39. Merge commit: f9685995d2c21b1cf9e391539f6013973f7a5ff0 (2026-11-16).

- [x] **3. Make score clearing consistent**
  - Branch: `codex/consistent-score-clearing`. Status: merged.
  - Plan: shared parser distinguishes omitted (unchanged), blank (delete), invalid
    (reject), and valid score. Apply across individual/conventional/bulk paths.
    Validate every target before writes; no partial submissions. Ungraded letter
    is empty, not F. Preserve zero, conversions, bounds, rounding, and report rules.
  - Acceptance: set/replace/clear/omit behave consistently; invalid mixed submissions
    change nothing; cleared cells, averages and reports display ungraded values.
  - Implementation: shared parser and prepared change lists for every score route;
    deletes for explicit blanks, skipped omissions, invalid submissions rejected
    before inserts/writes; numeric missing-value handling fixes cleared letters.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (39 tests).
    Regression coverage includes all entry paths, conversion/bounds, zero, omitted
    fields, invalid mixed writes and no accidental new assignment. Edge verified
    saving 90 then clearing, Saved status, empty letter and ungraded averages.
  - Screenshots: Edge CDP capture timed out; native fallback could not identify a
    unique test window. Manual: save 90, clear, Tab away, reload; confirm no F and
    ungraded averages, then repeat with the conventional assignment form.
  - Compatibility: same bounds/conversions/rounding; no schema changes or repairs.
  - PR: https://github.com/kirbw/oakstead/pull/40. Merge commit: 44e0b34528de7857239d9548d7e87bc6eb7edb9c (2026-11-16).

- [x] **4. Preserve Unicode in multipart forms**
  - Branch: `codex/fix-multipart-unicode`. Status: merged.
  - Plan: preserve multipart/file bytes and decode text as UTF-8. Preserve upload
    limits and file validation. Reject malformed bodies before mutations. Do not
    guess repairs for previously corrupted stored text.
  - Acceptance: accents/non-Latin text/emoji round-trip; mixed text/file checksums,
    quoted/unquoted boundaries, empty fields, malformed bodies, upload rejections.
  - Implementation: byte-buffer delimiter parsing, UTF-8 text/header decoding,
    framing validation and safe asynchronous parse rejection. File bytes unchanged.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (42 tests).
    Unicode/emoji/empty/quoted boundaries, binary checksums with boundary-like bytes,
    malformed/truncated/invalid UTF-8 requests, real settings and upload rejection.
    Edge browser saved and reloaded Colegio José 学校 🌿 without corruption.
  - Screenshots: Edge CDP capture attempted and timed out. Manual: save an accented/
    non-Latin/emoji school name in System Settings, reload, check exact text and logo.
  - Compatibility: upload limits and signature checks retained; no historical repair.
  - PR: https://github.com/kirbw/oakstead/pull/41. Merge commit: 9cb762920ac1cea32303e72219df86cdaba7edc5 (2026-11-16).

- [x] **5. Make school-date calculations timezone independent**
  - Branch: `codex/timezone-safe-school-dates`. Status: merged.
  - Plan: UTC date-only calendar helpers, real date validation and ordered school
    year ranges, consistently used for year/period calculations. Preserve inclusive
    days, explicit period links/IDs, and stored historical dates.
  - Acceptance: UTC, America/New_York, Pacific/Auckland agree across DST/leap/year
    boundaries; reject impossible/reversed dates atomically; unchanged IDs survive.
  - Implementation: shared UTC date-only helpers, calendar validation, range checks
    before activation/new-year/promotion/period writes; optional blank dates retained.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (45 tests).
    UTC/New York/Auckland subprocess fixtures, DST/leap/year boundaries, invalid and
    reversed ranges, atomic rejection and unchanged period IDs/assignment links.
    Browser saved unchanged periods and confirmed first date and full period table.
  - Screenshot: screenshots/round-2/pr5-school-dates.jpg (in-app browser; Edge capture
    unavailable). Compatibility: no stored date shifts/schema changes/repairs.
  - PR: https://github.com/kirbw/oakstead/pull/42. Merge commit: 27da081e7c5c8ffe4b16de9e5033ff6b30a7e36e (2026-11-16).

- [x] **6. Validate database constraints before restore**
  - Branch: `codex/validate-backup-constraints`. Status: merged.
  - Plan: validate required PK/UNIQUE/FK constraints, compatible column declarations,
    and application upsert targets through semantic SQLite metadata, not generated
    index names. Reject unsupported staged schemas before replacement; preserve
    supported additive upgrades and historical orphan reporting. Do not rebuild
    damaged tables or expose records through errors.
  - Acceptance: missing constraints rejected while current DB stays usable; current
    and supported older restores succeed; Windows WAL/lock, migration, replacement,
    reopen, verification failures recover. Document compatibility and recovery.
  - Implementation: schema manifest now requires compatible affinity/nullability/
    defaults, PK semantics, non-partial unique keys and FK actions. Index names and
    unique-column order do not matter. Supported additive FK-column exceptions
    remain because ALTER ADD COLUMN historically did not attach those constraints.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (48 tests),
    including all Windows migration/lock/replacement/reopen/verification recovery
    cases. Missing PK/UNIQUE/FK/cascade, wrong affinity and partial-only keys rejected
    before backup/replacement. Custom indexes and legacy additive schemas accepted.
    Restored orphans retained and reported by foreign_key_check; new orphans rejected.
    Browser created/restored a temporary backup and confirmed pre-restore backup.
  - Screenshot: screenshots/round-2/pr6-restore-verified.jpg.
  - Compatibility/recovery: no table rebuilds or guessed repairs; source backups
    unchanged, active DB usable on rejection, existing staged rollback retained.
    Historical orphan diagnostics remain admin-only; no contents exposed in errors.
  - PR: https://github.com/kirbw/oakstead/pull/43. Merge commit: 5473415b11137fc7ac56f610a61ed200abffcff7 (2026-11-16).

## Part B — First six Nexus patterns

- [x] **7. Establish domain routes, services, and validation boundaries**
  - Branch: `codex/domain-boundaries`. Status: merged.
  - Plan: separate dispatch, dependency-free input validation, business operations,
    database access and rendering. Group authentication/people/academics/admin;
    entry point composes/starts app. Shared services own authorization/transactions.
    Preserve URLs, fields, responses, schema and server-rendered pages.
  - Acceptance: integrations and focused authorization/validation/rollback service
    tests pass; representative response comparisons and before/after grade/Setup
    benchmarks show no material regression.
  - Implementation: authentication/people/academics/administration service and view
    factories, explicit repository injection, shared input guard, response descriptors
    and route adapter. Shared academic authorization and service-owned transactions;
    rejected results roll back before HTTP response. Hashed CSS/client assets moved
    out of entry point. Architecture documented in architecture.md.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (52 tests).
    Direct service authorization/validation/rollback tests, transport commit/cookie
    behavior, browser-asset syntax/hash/gzip checks. Forty role/route responses match
    pre-extraction behavior (CSRF/temporary runtime values normalized). Browser
    sign-in, authorized grade grid and autosave 90/Saved verified.
  - Benchmarks: graph 3 queries/51,166 rows, 74.78ms before / 82.95ms after; single
    period 3 queries/1,398 rows, 1.78ms / 1.39ms. Setup network 2 queries/1 row 0.03ms
    both; settings 0.02ms both; families 11 queries/404 rows 1.03ms / 0.97ms. Existing
    pure grade calculation and section loading code unchanged; timing noise observed.
  - Screenshot: screenshots/round-2/pr7-domain-gradebook.jpg. Compatibility: no
    schema/URL/field/permission/stack changes; dependencies explicit, no new packages.
  - PR: https://github.com/kirbw/oakstead/pull/44. Merge commit: d70dfa82fdc1ff9206f9f6a6acedba20a10ed832 (2026-11-16).

- [x] **8. Standardize request handling and errors**
  - Branch: `codex/shared-request-errors`. Status: merged.
  - Plan: shared browser timeout/auth-loss/error/request-ID handling; consistent
    validation/forbidden/conflict/oversize/unexpected errors, established success
    fields retained. Safe form errors retain appropriate submitted values; hide
    stacks/DB details. Central body limits preserve route-specific uploads. Add
    personalized no-store. Preserve queue; explicit latest-value score retry only,
    no generic mutation/restore/update retry.
  - Acceptance: timeout/auth loss/malformed response/validation/denial/oversize/500
    give useful safe feedback and request IDs without sensitive internals.
  - Implementation: shared 30-second browser helper covers response bodies, auth
    loss, malformed/error responses and request IDs; forms retain DOM values and
    accessible field alerts; no automatic mutation retries. Shared JSON/HTML errors
    sanitize 500s. Normal forms limited to 1MiB; multipart keeps 50,000,000 bytes.
    Personalized no-store and generated request IDs; versioned assets unchanged.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (56 tests).
    Timeout/header/body, malformed response, auth loss, fields, 403/409/413/500,
    redaction, actual/declared byte limits and unchanged successful zero-grade JSON.
    Browser retained reversed date with aria-invalid and focused request-ID alert;
    correction/resubmission succeeded without errors.
  - Screenshot: screenshots/round-2/pr8-retained-form-error.jpg.
  - Compatibility: successful fields preserved; JSON session failures now 401,
    duplicate records 409; ordinary large forms capped at 1MiB. Upload limits and
    explicit autosave retry preserved. No schema/dependency changes.
  - PR: https://github.com/kirbw/oakstead/pull/45. Merge commit: 68173ea81d95bac28f333c64308eb066071c32a0 (2026-11-16).

- [ ] **9. Introduce versioned database migrations**
  - Branch: `codex/versioned-database-migrations`. Status: validated, awaiting PR.
  - Plan: ordered SQLite user_version registry. Recognize/upgrade/validate supported
    unversioned schemas and establish baseline; transactionally advance versions
    only on success; reject future versions before data changes. Startup and staged
    restores share registry. Preserve historical diagnostics; no implicit downgrade.
  - Acceptance: fresh/historical/current/repeated/future/partial fixtures and injected
    failure preserve records, roll back fully, and retain version on failure.
    Document schema compatibility/recovery: reverting code does not undo migration.
  - Implementation: consecutive user_version registry establishes baseline version 1;
    recognizes supported unversioned schemas, creates fresh DBs in a savepoint, and
    rolls back all pending steps/data/version on failure. Startup/demo/staged restore
    share registry; future versions and partial/unrelated schemas rejected pre-write.
  - Validation: npm test and Node 22.13 syntax/refactor/full suite pass (61 tests).
    Fresh/historical/idempotent/future/partial/injected migration cases, staged future
    rejection, data/version preservation, and all Windows restore recovery cases.
    Browser sign-in/create backup/restore/pre-restore copy verified.
  - Screenshot: screenshots/round-2/pr9-versioned-restore.jpg.
  - Compatibility/recovery: historical data and orphan diagnostics preserved. No
    downgrades/repairs/table rebuilds. Candidate migration never alters source backup.
    Failed upgrade stops startup; reverting code does not undo schema versions.
    Registry and recovery documented in architecture.md.
  - PR: Pending. Merge commit: Pending.

- [ ] **10. Make startup and shutdown explicit**
  - Branch: `codex/application-lifecycle`. Status: planned.
  - Plan: create/start/stop; config validation and DB migration precede listener;
    background jobs share lifecycle. Unwind partial startup. Stop accepting requests,
    stop jobs, drain up to five seconds, checkpoint/close DB. Idempotent stop and
    existing restart/update paths; utilities never start listeners/timers by accident.
  - Acceptance: stage failures, repeated stop, pending requests, timer cleanup, port
    release, reopen, forced-stop logging and supported signals work on Windows.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **11. Add operational health and query visibility**
  - Branch: `codex/operational-health`. Status: planned.
  - Plan: structured request ID/normalized route/status/duration logs; DB counts and
    timings, operation-label warnings over 100ms; never raw SQL parameters or records.
    Bounded process-local aggregates. Admin view: uptime/version/readiness, request/
    query timing, backup status, integrity links. Minimal public /health readiness
    with lightweight DB probe, no school data or repeated integrity scan.
  - Acceptance: DB failure/shutdown unavailable, backup failures visible, bounded
    state and redaction of cookies/passwords/names/scores; benchmark overhead.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **12. Standardize visual controls and UI states**
  - Branch: `codex/consistent-ui-states`. Status: planned.
  - Plan: document/consolidate semantic colors, spacing/type/focus/controls while
    preserving green identity/layouts. Shared fields/buttons/notices/empty/loading/
    save/error patterns distinguish failure from empty and offer safe retry. Keyboard
    focus, associated field errors, status announcements, mobile targets; retain
    efficient desktop gradebook entry and all business/authorization rules.
  - Acceptance: main screens/all Setup sections/grade entry/parent/staff flows,
    keyboard, mobile/desktop, light/dark, reduced motion, loading/error/empty states;
    representative screenshots.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.
