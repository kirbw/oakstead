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
