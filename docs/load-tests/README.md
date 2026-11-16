# Concurrent teacher load test

Run `node scripts/load-test.js`. It starts the real app against temporary synthetic
data with demo mode OFF, uses 20 distinct teacher accounts with real salted password
verification, and cleans up its process/database. No dependencies or application
behavior changed. Your local demo and production data are untouched.

Three sequential runs on this Windows PC, Node 26.13.1:

| Scenario | Observed range | Failures |
| --- | --- | --- |
| One login | 56–62 ms | 0 |
| Five simultaneous logins | Last login completed in 133–139 ms | 0 |
| Twenty simultaneous logins | Last login completed in 506–577 ms | 0 |
| Twenty sessions, 200 dashboard/gradebook reads | Per-request p95 41–58 ms; max 63 ms | 0 |
| Twenty simultaneous score saves | Last response in 14–16 ms | 0 |

All 20 stored score percentages were verified after every run. Database integrity
was OK, declared foreign-key checks had no violations, and final health was ready.
Login timing includes CSRF page retrieval and credential submission; browser
rendering/assets, TLS and network latency are excluded. Browsing uses five cycles
per actor with no think time. Every save targets a distinct assignment/student pair.

Fixture: 37 students, 2,400 assignments, 8,880 scores. Twenty login accounts share
five seeded teacher records/authorization scopes. Archived JSON field teachers:20
means accounts. New runs label accounts and teacher records separately.

Other requests briefly queue during sign-in: health probes took 447–519 ms during
20 concurrent logins, versus 3–8 ms at the single-login baseline. Password checking
uses scryptSync, which blocks the event loop; the pause is consistent with that
implementation. A bounded asynchronous password-verification implementation is a
potential improvement to test separately; this test does not change hashing.

Health probes run every 50 ms with only one pending probe. Score saves completed
before a probe was collected; a zero probe count is not zero latency. Requests
have a 30-second timeout. All credentials were valid; failed-login throttling was
not disabled or tested.

These results are local fixture measurements, not a production capacity guarantee.
A larger enrollment/history dataset, longer mixed workload, slower hosting hardware,
and backup activity should be tested before setting production expectations.
No physical browsers, Safari, real phones, or long-running sessions were tested.

run-1.json through run-3.json preserve measurements; latest.json is overwritten on
rerun. Existing npm test passed all 74 tests. Application code was not changed.

## Nonblocking verification comparison

After switching login password checks to asynchronous scrypt, three sequential
runs of the identical script/fixture on the same machine produced:

| Measure | Synchronous baseline | Asynchronous verification |
| --- | --- | --- |
| Last of 20 login flows | 506–577 ms | 141–157 ms |
| Login-flow p95 | 482–547 ms | 140–154 ms |
| Health probe maximum during 20-login burst | 447–519 ms | 1.5–1.9 ms |
| Browsing per-request p95 (200 requests) | 41–58 ms | 40–54 ms |
| Last of 20 grade saves | 14–16 ms | 14–16 ms |
| Failures / incorrectly persisted scores | 0 / 0 | 0 / 0 |

Raw results are async-run-1.json through async-run-3.json. Timing varies with
machine load; health results have only two samples per async login burst, so these
are observed maxima rather than a broad latency guarantee. Earlier baseline runs
had one health sample per burst. All phases consume complete response bodies.

The verifier permits four active jobs and at most 64 waiting jobs. Additional
callers receive a safe 503 with Retry-After: 1; they are not counted as incorrect
password attempts. Existing scrypt hash format, parameters and timing-safe comparison
remain. Password creation/hashing outside the login verification path is unchanged.
Lockout and current account/password are rechecked after awaiting verification so
parallel attempts, deleted users or rotated passwords cannot mint an invalid session.
No database transaction spans a password-check await.

Validation: all 78 tests pass on both Node 26.13.1 and minimum Node 22.13 on Windows,
including compatibility, wrong/malformed passwords, queue bounds/failure cleanup,
post-await lockout/password change/deletion, and real session creation. Browser
check in a disposable non-demo app confirmed incorrect-password feedback and valid
login reaching Dashboard; screenshot: async-login-browser.jpg. No production data,
new dependencies, password migrations or reduced hashing strength.
