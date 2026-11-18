# Asynchronous response work

Same Windows machine, Node 26.13.1, isolated 50-teacher/500-student fixture, 30,000 assignments and 300,000 scores. Eight-second stages, no think time, login at the start of each stage. Node fetch advertises gzip automatically; real HTTP regression coverage also checks explicit gzip/identity negotiation.

Before: [raw report](../load-tests/school-2026-11-17T23-37-37-303Z.json). After: [raw report](../load-tests/school-2026-11-18T12-28-51-490Z.json). Runs were on adjacent days; same workload and fixture, synthetic localhost measurements, not production latency.

| Actors | Before ops/s | After ops/s | Before grid p95 ms | After grid p95 ms | Before save p95 ms | After save p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 384.5 | 437.5 | 5.0 | 4.4 | 2.2 | 2.0 |
| 5 | 441.0 | 636.4 | 18.8 | 18.5 | 15.1 | 7.9 |
| 10 | 450.1 | 587.5 | 34.4 | 32.3 | 29.9 | 19.1 |
| 20 | 412.8 | 574.2 | 58.0 | 62.9 | 59.0 | 41.1 |
| 35 | 429.5 | 606.0 | 95.7 | 75.3 | 102.2 | 64.8 |
| 50 | 421.9 | 626.6 | 138.2 | 96.0 | 149.1 | 89.6 |
| 50 | 424.0 | 634.1 | 131.8 | 91.7 | 143.3 | 87.7 |
| 1 | 383.4 | 480.0 | 5.1 | 3.9 | 2.3 | 1.6 |

All stages: zero request failures, final score verification succeeds, integrity OK, zero foreign-key violations.

Dynamic compression uses async level-1 gzip, at most four jobs and no queue. It skips compression when another request is active and falls back to identity after a 10ms optional wait (the timer remains subject to event-loop scheduling). Timed-out work retains its slot until its callback completes. Static assets remain precompressed. This exchanges bandwidth for responsiveness under concurrent load; WAN throughput is not measured here.

Intermediate Nov 17 reports at 23:39, 23:40, 23:41 and 23:42 record investigation, not the final implementation. Unconditional async compression increased page tail latency; the final busy-request admission rule resolves the 50-actor regression. The 23:39 run overlapped regression testing and is not a comparison baseline.

Account hashing is bounded at four concurrent jobs without a queue. Verification remains unchanged. Revalidate actor and target after hashing; transact only the final synchronous write. No schema or password-format changes.

Browser: disposable admin login and gradebook entry save 90 successfully, with updated averages and Saved status. [Screenshot](async-response-gradebook.jpg).
