# Performance verification

## Grade calculations (PR 9)

Measured on Windows with Node 26.13, using `npm run benchmark:grades`. Baseline
implementation is frozen from commit f7ceef41 after the correctness fixes.
The script asserts identical results before timing both versions on the same data.

Fixture: 30 students, 6 subjects, 300 assignments per subject, 6 marking periods.
Includes missing/zero scores, category aliases, explicit periods and date fallback.
SQLite runs in memory; each median uses five measured runs after warmup.

| Operation | Before queries | After queries | Before rows | After rows | Before median | After median |
|---|---:|---:|---:|---:|---:|---:|
| Full graph | 108 | 3 | 307,116 | 51,166 | 725.60 ms | 86.00 ms |
| Single period | 3 | 3 | 8,531 | 1,398 | 23.26 ms | 1.42 ms |

Rows include loaded score and weight records. Graph query count remains constant
as subjects and periods increase. A single-period calculation loads only scores
matching that period and the supplied authorized student IDs.

`EXPLAIN QUERY PLAN` uses the existing assignment year/grade/subject index and
the unique assignment/student score index; no additional index was added.

These are synthetic calculation measurements, not production HTTP latency or a
multi-user load test. Timings vary by host. No persistent grade cache is introduced.

## Setup rendering (PR 10)

Measured on Windows/Node 26.13 with `npm run benchmark:setup`. The frozen baseline
is the Setup renderer from commit 0f088ec3. Both renderers use the same SQLite data
and stable helper/IO fixtures; normalized HTML is compared before measurements.

Fixture: 400 families and 1,200 students. Each median uses 15 measured runs after
warmup. This measures rendering/data loading, excluding real disk/network delays
and the outer HTTP page wrapper. The real HTTP/browser checks cover that integration.

| Section | Before queries | After queries | Before rows | After rows | Before median | After median |
|---|---:|---:|---:|---:|---:|---:|
| Network Access | 20 | 2 | 1,613 | 1 | 2.46 ms | 0.03 ms |
| System Settings | 20 | 2 | 1,613 | 1 | 2.39 ms | 0.02 ms |
| Families | 20 | 11 | 1,613 | 404 | 2.36 ms | 0.99 ms |

The navigation uses aggregate counts. The active section alone loads detail records
and constructs its HTML. Families loads children only for the selected household.
Instrumented tests verify backup-directory, update-status and network-interface
helpers execute only in their corresponding sections. All 14 sections preserve
navigation counts and normalized baseline HTML for administrator/principal fixtures;
real HTTP tests also cover submissions, selected records and demo-mode exclusions.

No persistent cache, UI redesign, external update installation or production load
test is involved. Helper fixtures omit incidental settings/network lookups, so these
query counts describe the isolated benchmark rather than complete HTTP requests.
