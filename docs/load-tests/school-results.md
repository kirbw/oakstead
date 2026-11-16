# School-sized load test — 50 teachers, 500 students

Follow-up: [profile, focused fixes and before/after results](school-optimization.md).

Measured 2026-11-16 on Windows with Node 26.13.1 and the code merged in PR #53.
Client and server run on the same development PC. No production service or user
demo is targeted. Each run uses a new temporary database and real application
process with demo mode off; cleanup closes the database and stops the process.

## Fixture and workload

- 50 separate teacher records, accounts and classrooms, across ten grades.
- 500 enrolled students, ten per classroom, and 500 synthetic families.
- Five subjects, six marking periods, twenty assignments per subject/period/class.
- 30,000 assignments and 300,000 populated scores.
- A selected gradebook renders ten students x twenty assignments: 200 input cells.
- Every actor logs in, opens Dashboard, opens its authorized gradebook, saves a
  single score, then repeats page/read/write cycles without any typing/think time.
  Saves are sequential within an actor and concurrent across teachers, on distinct
  assignment/student targets. Full response bodies are consumed and validated.
- Gradebook HTML must include the expected assignment and, in the final repeat,
  exactly 200 score inputs. Each phase verifies the final saved score for every
  participating teacher. Integrity and foreign-key checks run after the workload.
- An independent readiness probe runs every 100ms, with only one probe outstanding.
  Requests time out after 30 seconds. Errors and timeouts are counted.

This is HTTP endpoint load, not 50 rendered browser instances. Browser rendering,
TLS, Wi-Fi latency, uploads, backup jobs and long-term soak behavior are excluded.
The shared fixture password hash has normal scrypt cost; authentication is real.
No passwords, session tokens or cookies appear in the results.

## Normal activity ramp: repeated from a fresh database

Eight seconds per phase at 1, 5, 10, 20, 35, 50, 50, then 1 actor. Users sign in at
the start of each phase and stay logged in while cycling through reads and saves.
Times below are per-request 95th percentiles: 95% of responses finished within them.

| Concurrent teachers | Gradebook p95 | Save p95 | Login-flow p95 | Failures |
| --- | --- | --- | --- | --- |
| 1 | 5ms | 2ms | 55ms | 0 |
| 5 | 18ms | 16ms | 63ms | 0 |
| 10 | 40ms | 34ms | 116ms | 0 |
| 20 | 62ms | 70ms | 243ms | 0 |
| 35 | 109ms | 118ms | 666ms | 0 |
| 50, first phase | 144ms | 168ms | 1,129ms | 0 |
| 50, repeated phase | 139ms | 159ms | 1,126ms | 0 |
| 1, recovery | 5ms | 2ms | 27ms | 0 |

Raw record: [normal ramp](school-2026-11-16T22-59-02-213Z.json).
An additional independent 15-second 50-actor phase measured gradebook p95 177ms,
save p95 202ms and login p95 1,252ms, also without failures, followed by recovery:
[15-second run](school-2026-11-16T22-57-44-627Z.json).

## Login-heavy mixed ramp

The first full ramp used the same school size, but each actor signed in again
every three grading cycles. This intentionally makes authentication overlap other
teachers' browsing/saving much more often than normal classroom use.

At 20 teachers login p95 was 216ms. At 35 it was 478ms. The two 50-actor phases
measured login p95 968–1,118ms, gradebook p95 89–98ms and save p95 117–126ms.
There were no failures, final grades matched, and recovery returned close to
baseline. Reads/saves can finish sooner in this scenario because more actors are
waiting for password verification rather than issuing page requests constantly.

Raw record: [login-heavy ramp](school-2026-11-16T22-56-33-573Z.json).
The earlier [one-second smoke test](school-2026-11-16T22-56-07-168Z.json) is retained
for provenance, but is not used as the main latency measurement.

## Where it slows

The normal ramp's throughput levels out around 5–10 continuously active teachers:
roughly 376–396 completed operations/second from 5 through 50 actors. Each login
operation includes two HTTP requests; the throughput count also includes probes,
so this is not a raw HTTP requests/second figure. More actors then primarily add
queueing delay. At 35–50 teachers this is apparent in request times, and the
simultaneous login burst reaches roughly one second at 50.

The 15-second run's server logs show dashboard p95 6.5ms, gradebook p95 4.1ms and
save p95 1.7ms once the handler is running, despite much higher client end-to-end
times. No individual database operation exceeded the existing 100ms warning
threshold. This is consistent with queueing around many short synchronous request/
database operations and the bounded password worker pool, rather than evidence
of one slow SQL statement. CPU, disk saturation and individual query plans were
not profiled; those would be the next investigation before choosing an optimization.

We did not find a failure boundary through 50 teachers. All final scores checked
correctly, integrity was `ok`, foreign-key violations were zero and readiness was
`ready` after each run. Recovery indicates no persistent slowdown in this test.
This does not establish a hard teacher capacity limit: the artificial clients
never pause to read or type. It is a short local stress test, not a production SLA.

## Reproduce

PowerShell, normal activity:

```powershell
$env:LOAD_LEVELS='1,5,10,20,35,50,50,1'
$env:LOAD_REAUTH_EVERY='0'
$env:LOAD_STAGE_SECONDS='8'
node scripts/load-test-school.js
```

For the login-heavy variant set LOAD_REAUTH_EVERY to 3. For a longer phase set
LOAD_STAGE_SECONDS up to 60. The script accepts no application URL or database
argument and only uses the disposable harness. Each run saves a timestamped JSON
report. Hardware identity is recorded in the later reports. No dependencies or
application behavior were changed. `node --check scripts/load-test-school.js`
passed; a full application regression suite was not rerun for this test-only work.
