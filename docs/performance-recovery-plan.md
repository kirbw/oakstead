# Performance, maintainability, and recovery

Eight sequential PRs, authorized November 17, 2026. Preserve earlier checklists.
Each branch starts from updated main. Merge only after validation, confirm the
merge, update main, and delete the local/remote branch before the next item.
Record completion in the following PR; use a final documentation-only PR after
item 8. No deployment, dependencies, production data, or Cloudflare changes.

Already retained: asynchronous password verification, personalized no-store
headers, and initial frontend extraction from server.js.

## Checklist

- [x] 1. Asynchronous, bounded release checks — `codex/async-release-checks`
  - Git argument arrays, noninteractive environment, hidden Windows processes,
    bounded output, 20-second overall check deadline, process-tree termination,
    shutdown cleanup, and one check/update at a time with a busy response.
  - Preserve channels/status/response fields and separate update worker; bound
    worker command execution without redesigning restart/update behavior.
  - Validate hangs, missing Git, network failures, output limits, concurrent
    requests, health/grade-save responsiveness, and Windows process cleanup.
  - Implemented: async Git with 20-second shared deadline, 1 MiB output cap,
    noninteractive execution, Windows tree termination, shutdown cancellation,
    and HTTP 409 for check/update conflicts. Worker commands have 120s limits.
  - Validation: 85 tests pass on Node 26.13.1 and 22.13.0; syntax/refactor checks
    pass. Real Windows parent/descendant timeout verified outside sandbox.
    Disposable app permits health and persisted grade saves during delayed Git.
  - Browser: check button disables during delay, then stable fixture v998.0.0
    appears; no real Git operation or update performed. Screenshot:
    [Release check](performance-recovery/release-check.jpg).
  - Compatibility: no schema/dependency changes; existing successful response
    fields retained. New 409 response for concurrent check/update requests.
  - Status: merged; branch deleted. PR: https://github.com/kirbw/oakstead/pull/55.
    Merge: 46f2d713385543eb2b1b216abd4c9b9268816420.
- [x] 2. Async response work — `codex/async-response-work`
  - Async dynamic gzip, maximum four concurrent jobs, uncompressed fallback
    without a queue, safe header/disconnect/error handling. Static compression
    remains at startup. Async bounded account hashing before transactions;
    recheck actor/target after await. Preserve password format.
  - Validate overload, failures, shutdown, authorization races, equivalent HTML;
    compare identical 50-teacher/500-student gzip-enabled load tests.
  - Implemented: async level-1 gzip, four-job cap, 10ms wait and busy-request
    identity fallback; bounded async account hashing and actor/target rechecks.
  - Validation: 90 tests pass on Node 26.13.1 and 22.13.0; npm syntax/refactor
    checks pass. Browser verified login, grade entry, updated averages and Saved.
    [Screenshot](performance-recovery/async-response-gradebook.jpg).
    [Load measurements](performance-recovery/async-response-results.md): 50-actor
    throughput 422–424 to 627–634 ops/s; no failures or incorrect final scores.
  - Compatibility: schema/hash format unchanged; more uncompressed HTML under
    load, no WAN benchmark. Concurrent target changes return 409; full hash
    capacity returns 503.
  - Status: merged; PR https://github.com/kirbw/oakstead/pull/56; branch deleted.
    Merge: 767013cbb6aef6e01d39d26f6a357aae73c34887.
- [x] 3. Browser source files — `codex/browser-source-files`
  - Ordinary JS/CSS, dependency-free startup assembly, existing URLs/content
    hashes/precompression, directly testable helpers without function-string
    serialization, demo configuration via escaped HTML data attribute.
  - Include files in Windows packages and syntax checks. Browser-check login,
    grade autosave/retry/navigation, updates and demo; desktop/iPhone screenshots.
  - Implemented: ordinary sources in server/browser; startup concatenation and
    content hashes; Node compatibility exports retained. Demo offset reads an
    escaped root data attribute. Syntax gate now checks all server/browser JS.
  - Validation: 92 tests pass on Node 26.13.1 and 22.13.0, syntax/refactor gates
    pass. Standalone Windows package-layout copy loads identical assets; source
    changes alter hashes. Full installer build not run (vendor binaries absent).
  - Browser: login, save-before-navigation (91), simulated failed save/retry (92),
    fake Git update check, and demo at 390x844 verified; no horizontal overflow.
    [Desktop](performance-recovery/browser-sources-desktop.jpg),
    [iPhone](performance-recovery/browser-sources-iphone.jpg).
  - Compatibility: URLs/CSP/layout/role rules unchanged; assets refresh through
    content hashes. No schema or dependency changes.
  - Status: merged; PR https://github.com/kirbw/oakstead/pull/57; branch deleted.
    Merge: e71e4cb33e59e507d5668d705d2e75af10fdae63.
- [x] 4. Bound database writes — `codex/parameterized-database-writes`
  - Single-statement parameterized reads/writes/inserted IDs; trusted schema
    scripts stay separate. Convert authentication, users, settings, people,
    academic mutations and authorization lookups. Structured transactional score
    operations. Allowlist identifiers. Preserve null/blank/zero/omission semantics.
  - Test Unicode/quotes/SQL-looking values, bulk rollback, access and insert IDs.
  - Implemented: positional parameters for mutations and their authorization
    lookups; structured score and marking-period operations inside synchronous
    transactions. Trusted initialization scripts remain separate.
  - Validation: 95 tests pass on Windows with Node 26.13.1 and 22.13.0;
    syntax/refactor gates pass. Added literal Unicode/SQL-looking text, inserted
    IDs, empty/null/zero values, reopen and rollback coverage. Existing tests
    cover every score form, mixed unauthorized batches, account races and restores.
  - Browser attempt: CUA initialization and retry both failed with "trusted Node
    process exited unexpectedly; kernel reset". No screenshot captured. Manual
    checks: sign in as admin, create/edit a family with O'Brien and Unicode text,
    reload it; as teacher save 90, then 0, then clear a grade and reload; confirm
    inaccessible students/assignments remain unavailable. HTTP fixture checks
    cover persistence and access; visual behavior was not verified in this PR.
  - Compatibility: no schema, dependencies, URLs or permission changes. Optional
    blank fields still map to NULL; bound APIs also support explicit empty text.
    Remaining display reads are reserved for item 5. No injection vulnerability
    is claimed; this change makes value handling easier to audit.
  - Benchmarks: correctness comparisons pass; current graph 95.03ms, single
    period 1.43ms; Setup Network 0.04ms, Families 1.09ms. Historical fixture
    comparisons are not a before/after performance claim for this PR.
  - Status: merged; PR https://github.com/kirbw/oakstead/pull/58; branch deleted.
    Merge: 962086c1cdd16fd9eaa341a99151df4fffe58499.
- [x] 5. Bound reads and measured reuse — `codex/parameterized-database-reads`
  - Convert remaining runtime reads/access filters and IN lists; document safe
    structural SQL. Benchmark preparation with grade/Setup fixtures.
  - Include connection-local 128-entry LRU statements only with >=5% median gain
    over three comparable runs and no material p95 regression. Clear on migration,
    close, restore/reopen. Never cache results. Test lists, eviction and recovery.
  - Implemented: remaining runtime reads use positional values, including
    varying IN lists, report/dashboard permissions and explicit/date periods.
    Removed legacy interpolation fallbacks from shared access predicates.
  - Validation: 96 tests pass on Windows under Node 26.13.1 and 22.13.0;
    syntax/refactor checks pass. Empty/changing lists and SQL-looking text covered;
    rendered Setup equivalence, grade fixtures, role access and restores pass.
  - Cache decision: omitted. Three comparable rounds do not demonstrate a 5%
    graph median improvement; one round worsens median and p95. No eviction or
    invalidation state is introduced. [Measurements and SQL audit](performance-recovery/bound-reads-results.md).
  - Browser tooling failed during this session's initialization and retry with
    a trusted Node process crash. No screenshot available. Manual checks: open
    Dashboard, Gradebook, Reports, parent graphs and every Setup section; compare
    counts, rows, selection, ordering and averages for each allowed role.
  - Compatibility: schema, permissions, URLs and response fields unchanged.
    No persistent cache, dependencies or production data changes.
  - Load check: same-session baseline versus bound reads at 50 actors averages
    477.8 versus 476.3 ops/s; gradebook p95 132.7 versus 133.0ms. Zero failures,
    correct final scores and clean integrity in both runs; raw reports linked.
  - Status: merged; PR https://github.com/kirbw/oakstead/pull/59; branch deleted.
    Merge: 1ba2aedf71de700797e6639101493ae29cee4b97.
- [x] 6. Academic history — `codex/academic-change-history`
  - Versioned additive append-only history: actor identity/role snapshot, UTC,
    request ID, operation/record IDs, before/after values. All score paths,
    assignment interpretation edits/deletion/affected scores, attendance writes.
  - Atomic with mutation; no no-op or failed-write history. Survives source
    deletion; no fabricated historical events. Demo actor/reset supported.
  - Admin/principal-only filtered read-only history, stable 50-event pagination,
    gradebook/attendance links; retain indefinitely. Test migration/rollback,
    authorization, deletion, zero/clear/bulk and older restores.
  - Restore rolls history back too; later events survive only in pre-restore
    backup. Document operational (not tamper-proof) nature and code downgrade risk.
  - Implemented: schema version 2 adds history without source-record foreign
    keys. Academic service captures changes within its existing transaction;
    failed history writes roll back the academic write. Score comparisons load
    only submitted students, except assignment deletion captures all scores.
    No-op saves produce no entries. Actor snapshots survive account deletion.
  - UI: admin/principal-only /history with numeric ID, UTC date and event filters,
    stable 50-event pagination and Gradebook/Absences links. Demo actor label and
    reset behavior included; Backup Settings explains history rollback.
  - Validation: 102 tests pass; syntax/refactor gates pass on Node 26.13.1 and
    22.13.0 on Windows. Tests cover every score form, zero/clear/no-op, mixed
    denial, cascades, history-write failure, actor deletion, filters/pagination,
    escaping/no-store, migration rollback and version-one restore.
  - Load: same 50-teacher/500-student fixture yields 480.0/482.4 ops/s at the two
    50-actor stages, gradebook p95 134.2/133.0ms, save p95 129.9/123.2ms; zero
    failures, correct final scores and clean integrity. Prior bound-read run:
    473.3/479.2 ops/s, gradebook p95 129.2/136.9ms, save p95 124.2/124.4ms.
    [Raw report](load-tests/school-2026-11-19T19-10-01-599Z.json). No speedup claimed.
  - Browser initialization attempted again; trusted Node process crashed before
    a page could open. No screenshots. [Manual checks and recovery notes](academic-history.md).
  - Compatibility: additive migration only, no historical backfill/repair.
    Older backup restores begin empty history; later events remain in pre-restore
    backup. Do not downgrade code/schema; use compatible code and validated backup.
  - Status: merged; PR https://github.com/kirbw/oakstead/pull/60; branch deleted.
    Merge: fb04a11c72d96fbda756fb7229044135be7ad8dd.
- [ ] 7. Opt-in backup retention — `codex/safe-backup-retention`
  - Keep all by default; admin option newest N scheduled backups (minimum 3,
    suggested 30), preview before save, no deletion on settings save. Cleanup
    only after successful validated scheduled backup. Preserve manual/uploaded/
    pre-restore/pre-update/unknown files. Verify direct regular paths; no symlinks.
  - Stage/validate/rename backups; failure preserves good files and success time.
    Report cleanup independently. Test Windows locks, traversal, timestamps,
    partial failures, boundary counts and retained backup restores.
  - Implemented: administrator-only GET preview followed by explicit policy save;
    saving and manual backups never clean files. Scheduled backups publish through
    a private exclusive temporary file, convert that copy out of WAL, validate,
    then rename. Random suffixes prevent same-millisecond filename collisions.
    Strict scheduled-name/date validation, direct regular files and no symlinks;
    deterministic ties. Cleanup reports deleted/remaining files separately.
  - Validation: 107 tests pass with syntax/refactor gates on Windows, Node
    26.13.1 and 22.13.0. Real Windows exclusive file handle preserves a locked
    backup and retries after release. Tests cover copy/validation/rename failures,
    partial cleanup, symlinks/path escapes, disabled/boundary policy and restores.
  - Browser attempt failed during initialization (trusted Node process exited;
    kernel reset); no screenshot. Manual: Backup Settings defaults to keep-all;
    enable N=3 and preview candidates; saving removes none; principal cannot
    change policy. After a successful scheduled backup inspect remaining files
    and cleanup notice. Check desktop and 390x844 layouts.
  - Compatibility: old backup names remain usable; new names add a unique suffix.
    No schema change or existing policy activation. Manual/uploaded/pre-restore/
    pre-update/unrecognized files preserved. Copying remains synchronous.
  - Status: validated; PR https://github.com/kirbw/oakstead/pull/61; merge pending.
- [ ] 8. Recovery visibility — `codex/recovery-health-visibility`
  - Backup/operations screens: durable safe success/failure/cleanup status,
    count/size and async free-space checks for data/backup locations; unavailable
    fallback. Advisory warning below max(1 GiB, twice DB size).
  - Distinguish creation/validation/cleanup/restore errors. No sensitive contents
    or raw DB errors. Verify no-store for downloads/history/errors/redirects/
    operations. Document protected off-machine copies and restore/history limits.
  - Test full disk/permissions/restart/stale status/recovery; mobile/desktop shots.
  - Status/PR/validation/compatibility/merge: pending.

## Gates and boundaries

Each PR: targeted tests then npm test on Node 22.13 and development runtime.
Temporary databases/disposable processes/fake commands/controlled clocks only.
Windows coverage for process trees, packaging, retention, migrations/restores.
Relevant grade/Setup and identical school load benchmarks: timing, throughput,
errors, persisted scores. Browser screenshots for changed flows; if unavailable,
record attempt/failure and exact manual checks. Preserve routes, roles, grading,
backup compatibility and data. No implicit schema downgrade or historical repair.
Security hardening is separate. Synchronous demo reseeding and backup copying
remain known blocking operations outside this plan.
