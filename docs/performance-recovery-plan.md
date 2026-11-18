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
- [ ] 3. Browser source files — `codex/browser-source-files`
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
  - Status: validated; PR https://github.com/kirbw/oakstead/pull/57; merge pending.
- [ ] 4. Bound database writes — `codex/parameterized-database-writes`
  - Single-statement parameterized reads/writes/inserted IDs; trusted schema
    scripts stay separate. Convert authentication, users, settings, people,
    academic mutations and authorization lookups. Structured transactional score
    operations. Allowlist identifiers. Preserve null/blank/zero/omission semantics.
  - Test Unicode/quotes/SQL-looking values, bulk rollback, access and insert IDs.
  - Status/PR/validation/compatibility/merge: pending.
- [ ] 5. Bound reads and measured reuse — `codex/parameterized-database-reads`
  - Convert remaining runtime reads/access filters and IN lists; document safe
    structural SQL. Benchmark preparation with grade/Setup fixtures.
  - Include connection-local 128-entry LRU statements only with >=5% median gain
    over three comparable runs and no material p95 regression. Clear on migration,
    close, restore/reopen. Never cache results. Test lists, eviction and recovery.
  - Status/PR/validation/compatibility/merge: pending.
- [ ] 6. Academic history — `codex/academic-change-history`
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
  - Status/PR/validation/compatibility/merge: pending.
- [ ] 7. Opt-in backup retention — `codex/safe-backup-retention`
  - Keep all by default; admin option newest N scheduled backups (minimum 3,
    suggested 30), preview before save, no deletion on settings save. Cleanup
    only after successful validated scheduled backup. Preserve manual/uploaded/
    pre-restore/pre-update/unknown files. Verify direct regular paths; no symlinks.
  - Stage/validate/rename backups; failure preserves good files and success time.
    Report cleanup independently. Test Windows locks, traversal, timestamps,
    partial failures, boundary counts and retained backup restores.
  - Status/PR/validation/compatibility/merge: pending.
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
