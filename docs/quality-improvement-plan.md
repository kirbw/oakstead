# Oakstead quality improvement checklist

Completed November 13, 2026. All ten PRs were merged in order before the next
branch was started. Final validation: syntax/refactor checks and all 27 tests passed
on Windows with Node 22.13 and 26.13. All 14 Setup sections were browser-verified.
Performance measurements and reproducible commands are in performance-results.md.
No deployment or production-data changes were performed.

Work in this order. Merge each PR before creating the next branch from updated main.
Check off only after merge; record completion in the next PR, and use a final
tracking commit after PR 10. PR creation and merge do not imply deployment.

## Shared merge gates

- Separate codex/ branches and focused PRs; no new dependencies or production data changes.
- Run npm test (syntax, existing refactor checks, and Node regression/integration tests).
- Use temporary databases. Test minimum Node 22.13 and the development runtime.
- Browser-check changed screens/flows and capture screenshots, or record the failed
  attempt and manual checks. Restore tests require Windows coverage.
- Record implementation, PR URL, commands/outcomes, compatibility, and recovery notes.
- Preserve/report ambiguous historical data; repairs need separate authorization.

## Sequence

- [x] 1. Handle malformed cookies without crashing — codex/fix-malformed-cookies
  - Ignore individual undecodable cookies and retain valid neighbours. Put request
    initialization inside the error boundary. Add real-server temporary-data harness.
  - Acceptance: malformed escapes/session cookies cannot terminate the server;
    subsequent requests, login, and valid/invalid CSRF checks behave correctly.
  - Implemented: tolerant decoding, protected initialization, reusable child-process
    integration harness, and aggregate npm test command. PR: https://github.com/kirbw/oakstead/pull/26.
  - Validation: npm test passed on Node 26.13; integration and refactor checks passed on Node 22.13. Browser sign-in/dashboard verified; screenshot retained as pr1-login-verified.png. Merged: 9e32c626.
- [x] 2. Enforce assignment access consistently — codex/fix-assignment-authorization
  - Shared actual-assignment authorization for reads, edits, deletion and every
    individual/bulk score path; validate all targets before writes. Remove permissive
    fallback reads. Preserve grade-based teacher access, not creator ownership.
  - Acceptance: cross-grade/year and mixed unauthorized requests cannot read/change
    records; authorized roles retain access.
  - Implemented shared assignment/roster checks and filtered lists/fallback reads.
    Validation: npm test and Node 22.13 tests pass; browser allowed/denied views verified;
    screenshot pr2-authorized-assignment.png. PR: https://github.com/kirbw/oakstead/pull/27; merged 191fa9c7.
- [x] 3. Preserve marking-period links — codex/preserve-marking-period-links
  - Update existing IDs by year/period number; insert additions, reject removal of
    referenced periods, remove unused surplus periods, transact related updates.
  - Report dangling links without guessing repairs. Preserve explicit-ID precedence.
  - Acceptance: unchanged/date/count edits preserve links; rejected and failed writes
    roll back completely.
  - Implemented stable-ID upserts, transactional settings, referenced-period conflict
    checks and non-mutating dangling-link logs. npm test and Node 22.13 tests pass;
    browser save verified; pr3-period-settings.png captured. PR: https://github.com/kirbw/oakstead/pull/28; merged 5e3cf5d5.
  - Compatibility: no historical reassignment; reverting code cannot recover links
    already broken by older versions. Existing dangling links require explicit repair.
- [x] 4. Validate database restores — codex/validate-database-restores
  - Separate integrity/application-schema checks; reject empty/corrupt/unrelated or
    incomplete files. Allow supported additive-column migrations on a staged copy.
  - Smoke-test staged copy, create pre-restore backup after validation, perform closed
    same-volume replacement, verify/reopen and recover original on failure.
  - Acceptance: valid current/older backups work; migration/swap/reopen failures leave
    original usable. Test Windows locks/WAL.
  - Implemented shared schema/additive migration definitions, staged validation and
    migration, closed-file replacement, smoke verification and original-file recovery.
    npm test and Node 22.13 tests pass on Windows (10 tests), including injected
    migration/lock/replacement/reopen/verification failures and real WAL restores.
    Browser create/restore verified; pr4-restore-verified.png captured. PR: https://github.com/kirbw/oakstead/pull/29; merged 0c085f4a.
  - Compatibility: require all current application tables/base columns; only existing
    additive-column migrations are supported. Uploaded sources remain unchanged.
    A recovery failure retains the original in the logged staging directory; stop
    the app and recover that original before retrying.
- [x] 5. Run recurring backups — codex/run-recurring-backups
  - Startup plus five-minute due checks; read current frequency, prevent overlap,
    unref/clean timer, retry failures without advancing success timestamp.
  - Preserve daily/weekly/30-day semantics. Acceptance: controlled-clock coverage for
    due/not-due/manual/settings changes/failure/overlap.
  - Implemented five-minute unreferenced scheduler with exit cleanup and live settings;
    backup success metadata now commits atomically after file creation/stat. npm test
    and all 13 tests on Node 22.13 pass, including controlled-clock/retry/overlap and
    injected metadata rollback. No screen or form behavior changed. PR: https://github.com/kirbw/oakstead/pull/30; merged 7daaba3c.
- [x] 6. Fix session expiration — codex/fix-session-expiration
  - Normalize existing ISO expiry using SQLite date functions; share validity
    predicate with cleanup; invalid timestamps expire. Keep 12 hours and cookies.
  - Acceptance: same-day/midnight/exact-boundary/future/invalid timestamps and cleanup
    agree without destructive migration.
  - Implemented shared julianday/COALESCE validity predicate for auth and cleanup.
    npm test passes (15 tests); Node 22.13 boundary and HTTP tests pass. Browser
    expired-session redirect and fresh login verified; pr6-expired-session.png captured.
    Existing ISO timestamps and 12-hour sessions retained. PR: https://github.com/kirbw/oakstead/pull/31; merged 7e028b19.
- [x] 7. Fix ungraded-period averages — codex/fix-ungraded-period-averages
  - Shared averaging excludes null/undefined/blank/non-finite before conversion;
    update both graphs and audit callers; preserve zero and rounding.
  - Acceptance: [90,null,null,null,null,null] = 90, [90,0] = 45, all missing = no
    average; parent/staff/report results agree.
  - Implemented shared missing-aware numeric conversion/average for calculations,
    graph points and report cards. npm test passes (17 tests); Node 22.13 averaging
    and real graph/report parity tests pass. Browser shows 90% with other periods
    ungraded; pr7-ungraded-periods.png captured. PR: https://github.com/kirbw/oakstead/pull/32; merged cf0fdba3.
- [x] 8. Enforce database relationships — codex/enforce-database-relationships
  - Enable foreign keys on every connection/reopen. Audit seed/init/mutations;
    replace unsafe REPLACE writes, transact related writes, honor cascades and
    explain restrictive-delete conflicts.
  - Preserve legacy violations; report table/row/relationship after init/restore in
    startup logs and administrator-only diagnostics, including period/person-role
    references not covered by declared constraints.
  - Acceptance: reject new violations, cascade scores, preserve/report old orphans,
    no partial restrictive writes; init/demo/reopen/restore work.
  - Implemented foreign_keys=ON on every connection, nested atomic record operations
    with responses delayed until commit, stable enrollment/demo upserts, and ordered
    atomic demo reset. Added administrator-only /system/diagnostics and settings link;
    startup/restore logs include row/relationship identifiers without student details.
    Native constraints reject new declared-FK violations; routes also validate period
    and polymorphic person targets. Historical orphans are retained, not repaired.
  - npm test and all 21 tests on Node 22.13 pass on Windows, including repeated demo
    resets, rollback/cascade/restrict behavior, legacy retention and restore/reopen
    enforcement. Browser diagnostics verified; pr8-data-integrity.png. PR: https://github.com/kirbw/oakstead/pull/33; merged f7ceef41.
  - Compatibility: no destructive migration. Existing invalid links may make related
    edits fail until explicitly repaired. Reverting code disables new enforcement
    but cannot undo already completed cascades; recover from backup if required.
- [x] 9. Optimize grade calculations — codex/optimize-grade-calculations
  - Separate loading/pure calculation; period-filter single-period requests; load
    authorized graph scores/weights once and group by subject/student/period/category.
  - Request-local reuse only; preserve weights/rounding/access/output/serialized saves
    and mean-of-graded-student class averages. Add indexes only with query-plan evidence.
  - Acceptance: parity fixtures; bounded graph query counts, no other-period loading;
    demonstrate before/after rows/query counts/median timings.
  - Implemented pure grouped accumulators and period-filtered loading; graphs load
    scores/weights once, parent views reuse weights, and report cards reuse grouped
    results instead of repeated scans. Letter scales remain loaded once per view/save.
    No persistent cache or added index. npm test passes (23 tests); Node 22.13 parity,
    authorization and report tests pass. Browser autosave/graph verified;
    pr9-grade-autosave.png captured. PR: https://github.com/kirbw/oakstead/pull/34; merged 0f088ec3.
  - Benchmark: graph 108 to 3 queries, 307116 to 51166 loaded rows, median 725.60 to
    86.00 ms; single period 8531 to 1398 rows, 23.26 to 1.42 ms. See performance-results.md.
- [x] 10. Optimize Setup rendering — codex/optimize-setup-rendering
  - Shared lightweight count navigation and selected-section loaders/renderers;
    related dropdowns and backup/network/update reads only where needed.
  - Preserve all forms/URLs/selections/counts/roles/demo exclusions; no persistent cache
    or redesign. Acceptance: all section flows/browser checks, loader isolation,
    screenshots and before/after timing.
  - Implemented explicit section data loaders and named renderers, aggregate navigation
    counts, and selected-family child loading. Backup/network/update IO runs only for
    its section. No redesign or persistent cache. npm test and all 27 tests on Node
    22.13 pass, covering baseline HTML/count parity, role/demo restrictions, selected
    records, loader/IO isolation and actual form submissions.
  - Browser verified all 14 sections and an actual family save; screenshots
    pr10-setup-families.png, pr10-setup-network.png, pr10-setup-settings.png and
    pr10-family-save.png captured. No system update was installed during QA;
    environment-managed network settings were verified as disabled. PR: https://github.com/kirbw/oakstead/pull/35; merged 8151fc56.
  - Synthetic benchmark: Network Settings 20 to 2 queries, 1613 to 1 loaded rows,
    median 2.46 to 0.03 ms; Families 1613 to 404 rows, 2.36 to 0.99 ms.
    See performance-results.md for fixture scope and limitations.

## Exclusions

Broad restructuring, dependency changes, asynchronous hashing/compression and Git
update performance changes are outside these PRs. Code rollback does not undo data
changes; document compatibility/recovery especially for PRs 3, 4 and 8.


## Additional follow-up observed during verification

- Existing compactPercent formatting strips significant trailing zeroes when decimals=0
  (for example, 90 displays as 9 in gradebook summaries). Stored grades and graph values
  are correct. This predates these changes and is outside the ten planned PRs; address
  separately with formatting regression cases for 0, 10, 90, 100 and decimals.
