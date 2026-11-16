# School-sized load investigation and optimization

## Finding and fix

The original request handlers queued under load because of repeated synchronous
work on the request thread. An opt-in disposable profiler measured SQL totals,
SQLite query plans and V8 CPU samples. The largest query was the dashboard's
recent-assignment list: it joined and averaged scores for every accessible
assignment, grouped/sorted the results, and only then applied LIMIT 8.

In the teacher fixture that meant calculating averages across 600 assignments
and 6,000 scores to display eight assignments. A materialized CTE now selects
the latest eight authorized assignments, including their valid subject join,
before score aggregation. The same teacher/student authorization clauses,
ordering, zero/missing-value behavior and rounding remain. No results are cached.

The profile also identified repeated en-US weekday formatting in recentSchoolDays.
It now uses fixed English weekday labels indexed by the same UTC weekday. The
calculation still runs for every request, so dates update across midnight.

No database schema/index, password settings, request concurrency, UI design,
grading rules, authorization rules or dependencies changed.

## Query and CPU evidence

Separate five-second 1/50-actor profiler runs (not the timing benchmark):

- [Before](school-2026-11-16T23-03-41-532Z.json): recent-list query averaged 2.74ms
  per call. Its score join/grouping precedes the final ordering/LIMIT.
- [After](school-2026-11-16T23-06-18-995Z.json): same result query averaged 0.52ms
  per call, about 81% lower. EXPLAIN shows MATERIALIZE recent_assignments followed
  by a scan of that limited result and indexed score lookups.
- The earlier profiler's recentSchoolDays frame accounted for 261 self samples;
  it no longer appears among the after profile's top twenty frames. Sampling
  proportions are exploratory and do not establish exact per-function speedups.
- [Intermediate query-only fix](school-2026-11-16T23-04-48-434Z.json) is retained
  to distinguish the SQL change from the date-label change.

The test-only profiler wraps the disposable application's database adapter and
collects normalized SQL, counts, rows, elapsed time, query plans and CPU frames.
It is not loaded during normal startup. SQL literal values are stripped; output
contains no passwords or session tokens. Sampling snapshots occur every two
seconds, so final aggregates may omit the last partial interval. Profiling adds
overhead; only unprofiled runs are compared for end-to-end performance.

## Same normal-activity ramp, before and after

Same Windows PC/runtime, fresh 50-teacher/500-student fixtures, 30,000 assignments,
300,000 scores, no think time, same HTTP requests and eight-second phases at
1/5/10/20/35/50/50/1 concurrent actors. All actors sign in at each phase's start,
then cycle Dashboard → 200-cell gradebook → single-cell save. Load client and
server share the machine. No other test suite ran during either load measurement.

| At 50 concurrent actors, both phases | Before | After |
| --- | --- | --- |
| Dashboard p95 | 158–166ms | 106–111ms |
| Gradebook p95 | 139–144ms | 98ms |
| Score-save p95 | 159–168ms | 102–107ms |
| Login-flow p95 | 1,126–1,129ms | 824–830ms |
| Completed workload operations/second | 392–396 | 557–561 |
| Failed requests | 0 | 0 |

This is roughly 42% higher throughput, with gradebook tails about 30% lower and
save tails about 36% lower. Login parameters are unchanged; login latency also
benefits when the request thread spends less time on other work.

Raw unprofiled runs:
[before](school-2026-11-16T22-59-02-213Z.json),
[after](school-2026-11-16T23-06-30-310Z.json).
After: 10,805 successful save responses; final values verified per actor after
each phase. Database integrity was ok, foreign-key violations zero, and final
readiness ready. The final one-actor recovery phase returned close to baseline.

These are short local stress tests, not a production SLA or evidence of unlimited
capacity. Short synchronous work still queues at high concurrency. Weekly graph
queries, SQL preparation, response rendering and logging remain measurable costs;
this change removes the largest demonstrated avoidable work without broad changes.
Physical devices, browser rendering, network/TLS and backup overlap are excluded.

## Same login-heavy ramp

The full eight-phase ramp was also rerun with reauthentication every three cycles,
matching the earlier mixed login/read/write scenario. At fifty actors:

| Measure, both 50-actor phases | Before | After |
| --- | --- | --- |
| Login p95 | 968–1,118ms | 661–699ms |
| Gradebook p95 | 89–98ms | 67–68ms |
| Save p95 | 117–126ms | 74–77ms |
| Completed operations/second | 306–313 | 430–443 |

[Before mixed workload](school-2026-11-16T22-56-33-573Z.json),
[after mixed workload](school-2026-11-16T23-09-14-569Z.json).
Again no failures, final scores matched, integrity/foreign-key checks passed and
readiness remained ready. Recovery returned close to baseline. The same bounded
asynchronous password verification is used on both sides of this comparison.

## Validation and reproduction

- npm test: all 80 tests pass on Node 26.13.1.
- Node 22.13 syntax, refactor checks and full suite: all 80 pass on Windows.
- Regression compares recent-list ordering/averages against the prior full-group
  query for teacher/admin/principal with more than eight assignments, tied dates,
  unauthorized newer assignments, zero/null/missing scores and zero-point work.
- UTC school-day labels checked against prior locale output around weekends,
  New Year and DST boundaries. Existing authorization/grade tests continue passing.
- Browser: real teacher login, scoped counts, recent assignments, ungraded dash,
  90.0% average and weekly graph verified against disposable fixture data.
  Screenshot: [teacher dashboard](optimized-dashboard-browser.jpg).

Normal workload: use the PowerShell settings in school-results.md.
For profiling set LOAD_PROFILE=1, LOAD_LEVELS=1,50 and LOAD_STAGE_SECONDS=5;
leave LOAD_REAUTH_EVERY=0. Remove LOAD_PROFILE before timing comparison runs.
No production or user demo data is touched.

Implementation PR: https://github.com/kirbw/oakstead/pull/54.
