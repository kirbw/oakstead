# Oakstead quality improvement checklist

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
- [ ] 5. Run recurring backups — codex/run-recurring-backups
  - Startup plus five-minute due checks; read current frequency, prevent overlap,
    unref/clean timer, retry failures without advancing success timestamp.
  - Preserve daily/weekly/30-day semantics. Acceptance: controlled-clock coverage for
    due/not-due/manual/settings changes/failure/overlap.
  - Implemented five-minute unreferenced scheduler with exit cleanup and live settings;
    backup success metadata now commits atomically after file creation/stat. npm test
    and all 13 tests on Node 22.13 pass, including controlled-clock/retry/overlap and
    injected metadata rollback. No screen or form behavior changed. PR/merge: pending.
- [ ] 6. Fix session expiration — codex/fix-session-expiration
  - Normalize existing ISO expiry using SQLite date functions; share validity
    predicate with cleanup; invalid timestamps expire. Keep 12 hours and cookies.
  - Acceptance: same-day/midnight/exact-boundary/future/invalid timestamps and cleanup
    agree without destructive migration. PR/validation/merge: pending.
- [ ] 7. Fix ungraded-period averages — codex/fix-ungraded-period-averages
  - Shared averaging excludes null/undefined/blank/non-finite before conversion;
    update both graphs and audit callers; preserve zero and rounding.
  - Acceptance: [90,null,null,null,null,null] = 90, [90,0] = 45, all missing = no
    average; parent/staff/report results agree. PR/validation/merge: pending.
- [ ] 8. Enforce database relationships — codex/enforce-database-relationships
  - Enable foreign keys on every connection/reopen. Audit seed/init/mutations;
    replace unsafe REPLACE writes, transact related writes, honor cascades and
    explain restrictive-delete conflicts.
  - Preserve legacy violations; report table/row/relationship after init/restore in
    startup logs and administrator-only diagnostics, including period/person-role
    references not covered by declared constraints.
  - Acceptance: reject new violations, cascade scores, preserve/report old orphans,
    no partial restrictive writes; init/demo/reopen/restore work. PR/validation/merge: pending.
- [ ] 9. Optimize grade calculations — codex/optimize-grade-calculations
  - Separate loading/pure calculation; period-filter single-period requests; load
    authorized graph scores/weights once and group by subject/student/period/category.
  - Request-local reuse only; preserve weights/rounding/access/output/serialized saves
    and mean-of-graded-student class averages. Add indexes only with query-plan evidence.
  - Acceptance: parity fixtures; bounded graph query counts, no other-period loading;
    demonstrate before/after rows/query counts/median timings. PR/validation/merge: pending.
- [ ] 10. Optimize Setup rendering — codex/optimize-setup-rendering
  - Shared lightweight count navigation and selected-section loaders/renderers;
    related dropdowns and backup/network/update reads only where needed.
  - Preserve all forms/URLs/selections/counts/roles/demo exclusions; no persistent cache
    or redesign. Acceptance: all section flows/browser checks, loader isolation,
    screenshots and before/after timing. PR/validation/merge: pending.

## Exclusions

Broad restructuring, dependency changes, asynchronous hashing/compression and Git
update performance changes are outside these PRs. Code rollback does not undo data
changes; document compatibility/recovery especially for PRs 3, 4 and 8.

