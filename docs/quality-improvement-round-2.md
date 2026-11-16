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

- [ ] **2. Restrict the teacher dashboard consistently**
  - Branch: `codex/scope-teacher-dashboard`. Status: submitted, awaiting merge.
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
  - PR: https://github.com/kirbw/oakstead/pull/39. Merge commit: Pending.

- [ ] **3. Make score clearing consistent**
  - Branch: `codex/consistent-score-clearing`. Status: planned.
  - Plan: shared parser distinguishes omitted (unchanged), blank (delete), invalid
    (reject), and valid score. Apply across individual/conventional/bulk paths.
    Validate every target before writes; no partial submissions. Ungraded letter
    is empty, not F. Preserve zero, conversions, bounds, rounding, and report rules.
  - Acceptance: set/replace/clear/omit behave consistently; invalid mixed submissions
    change nothing; cleared cells, averages and reports display ungraded values.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **4. Preserve Unicode in multipart forms**
  - Branch: `codex/fix-multipart-unicode`. Status: planned.
  - Plan: preserve multipart/file bytes and decode text as UTF-8. Preserve upload
    limits and file validation. Reject malformed bodies before mutations. Do not
    guess repairs for previously corrupted stored text.
  - Acceptance: accents/non-Latin text/emoji round-trip; mixed text/file checksums,
    quoted/unquoted boundaries, empty fields, malformed bodies, upload rejections.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **5. Make school-date calculations timezone independent**
  - Branch: `codex/timezone-safe-school-dates`. Status: planned.
  - Plan: UTC date-only calendar helpers, real date validation and ordered school
    year ranges, consistently used for year/period calculations. Preserve inclusive
    days, explicit period links/IDs, and stored historical dates.
  - Acceptance: UTC, America/New_York, Pacific/Auckland agree across DST/leap/year
    boundaries; reject impossible/reversed dates atomically; unchanged IDs survive.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **6. Validate database constraints before restore**
  - Branch: `codex/validate-backup-constraints`. Status: planned.
  - Plan: validate required PK/UNIQUE/FK constraints, compatible column declarations,
    and application upsert targets through semantic SQLite metadata, not generated
    index names. Reject unsupported staged schemas before replacement; preserve
    supported additive upgrades and historical orphan reporting. Do not rebuild
    damaged tables or expose records through errors.
  - Acceptance: missing constraints rejected while current DB stays usable; current
    and supported older restores succeed; Windows WAL/lock, migration, replacement,
    reopen, verification failures recover. Document compatibility and recovery.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

## Part B — First six Nexus patterns

- [ ] **7. Establish domain routes, services, and validation boundaries**
  - Branch: `codex/domain-boundaries`. Status: planned.
  - Plan: separate dispatch, dependency-free input validation, business operations,
    database access and rendering. Group authentication/people/academics/admin;
    entry point composes/starts app. Shared services own authorization/transactions.
    Preserve URLs, fields, responses, schema and server-rendered pages.
  - Acceptance: integrations and focused authorization/validation/rollback service
    tests pass; representative response comparisons and before/after grade/Setup
    benchmarks show no material regression.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **8. Standardize request handling and errors**
  - Branch: `codex/shared-request-errors`. Status: planned.
  - Plan: shared browser timeout/auth-loss/error/request-ID handling; consistent
    validation/forbidden/conflict/oversize/unexpected errors, established success
    fields retained. Safe form errors retain appropriate submitted values; hide
    stacks/DB details. Central body limits preserve route-specific uploads. Add
    personalized no-store. Preserve queue; explicit latest-value score retry only,
    no generic mutation/restore/update retry.
  - Acceptance: timeout/auth loss/malformed response/validation/denial/oversize/500
    give useful safe feedback and request IDs without sensitive internals.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

- [ ] **9. Introduce versioned database migrations**
  - Branch: `codex/versioned-database-migrations`. Status: planned.
  - Plan: ordered SQLite user_version registry. Recognize/upgrade/validate supported
    unversioned schemas and establish baseline; transactionally advance versions
    only on success; reject future versions before data changes. Startup and staged
    restores share registry. Preserve historical diagnostics; no implicit downgrade.
  - Acceptance: fresh/historical/current/repeated/future/partial fixtures and injected
    failure preserve records, roll back fully, and retain version on failure.
    Document schema compatibility/recovery: reverting code does not undo migration.
  - PR / implementation / validation / screenshots / compatibility / merge: Pending.

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
