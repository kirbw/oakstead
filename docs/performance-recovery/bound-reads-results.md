# Bound reads and statement reuse

Windows, Node 26.13.1, November 19, 2026. Run
`node scripts/benchmark-statements.js` to repeat the experiment. Each round has
21 measured samples after warmup; the second round reverses execution order.
Both modes use the same bound queries and fixtures. Results are asserted equal.

Graph fixture: 30 students, six subjects, 1,800 assignments. Setup fixture:
400 families, 1,200 students, navigation counts plus Families and Network loaders.
Experimental reuse is a connection-local, 128-entry LRU implemented only in the
benchmark. It never caches results.

| Round / workload | Fresh median / p95 ms | Reused median / p95 ms |
| --- | --- | --- |
| 1 graph | 67.351 / 77.694 | 64.678 / 76.709 |
| 2 graph | 69.967 / 82.685 | 74.959 / 88.695 |
| 3 graph | 69.513 / 98.387 | 68.921 / 93.526 |
| 1 Setup | 0.752 / 0.945 | 0.608 / 0.777 |
| 2 Setup | 0.721 / 0.797 | 0.601 / 0.665 |
| 3 Setup | 1.214 / 1.236 | 0.589 / 0.937 |

**Decision: do not add an application statement cache.** Setup improves, but graph
median gains are 4.0%, -7.1%, and 0.9%; round two also worsens p95. This does not
meet the requirement for a repeatable 5% improvement without a material p95
regression. Avoiding the cache also avoids eviction and restore/migration
invalidation state. Existing reopen/restore tests still exercise fresh statements.

## SQL interpolation audit

Runtime values use positional bindings, including varying ID lists and date
filters. List interpolation emits only question-mark placeholders. Access and
period fragments contain fixed SQL and append values in placeholder order.
Enrollment aliases are restricted to `sy` and `os_student_years`; student alias
is `st`. Person-role lookups select between fixed family/teacher table names.
The session expiry predicate is a fixed source constant.

Trusted schema and migration scripts still execute through the script API.
Schema metadata queries interpolate table names derived from the application's
own schema definition, not submitted form data. Savepoint names come from a
connection-local counter. Demo seed and historical benchmark fixture scripts
remain trusted development inputs. `sqlValue` remains a legacy utility for such
scripts; runtime display and mutation queries no longer use it to embed values.

Grade fixture equivalence covers weighting, explicit periods/date fallback,
zeroes, missing grades and changing student lists. Setup fixtures compare rendered
HTML and navigation counts against the preserved baseline. These are correctness
comparisons, not a claim that binding alone speeds up the application.

## Same-session school load comparison

Identical 50-teacher/500-student, 30,000-assignment/300,000-score workload;
eight-second stages 1, 5, 10, 20, 35, 50, 50, 1, login once per stage,
gzip-capable HTTP clients. The merged item-4 baseline was run from an isolated
checkout immediately after the changed code. Both runs used disposable data.

| 50-actor stage | Baseline ops/s | Bound reads ops/s | Baseline gradebook/save p95 ms | Bound reads gradebook/save p95 ms |
| --- | --- | --- | --- | --- |
| First | 459.7 | 473.3 | 144.6 / 130.1 | 129.2 / 124.2 |
| Second | 495.9 | 479.2 | 120.8 / 115.8 | 136.9 / 124.4 |

The repeated-stage throughput averages are 477.8 and 476.3 ops/s (0.3% lower).
Gradebook p95 averages are 132.7 and 133.0 ms; save p95 averages are 123.0 and
124.3 ms. There is no consistent material regression across the repeated stages.
Both runs had zero failures, all final scores verified, integrity `ok`, and zero
foreign-key violations. The older 627–634 ops/s result is not representative of
today's machine conditions: today's baseline is also lower. No speedup is claimed.

Raw reports: [baseline](../load-tests/school-2026-11-19T12-38-09-466Z.json),
[bound reads](../load-tests/school-2026-11-19T12-36-53-669Z.json).
