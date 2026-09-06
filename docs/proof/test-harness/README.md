# One Postgres harness, one host budget, and gates that run

Method and figures for the 5 September 2026 test-gate lane. Two reviews landed
on the same defect from opposite sides: `data/review-merged-code/report.md`
(F-15, F-16, F-19) and `data/review-thermonuclear/report.md` (P0-1, P0-2, P1-1,
P1-5).

## The flake, measured

`kern.sysv.shmmni` on this Mac is **32**. Every running PostgreSQL cluster
claims one SysV segment for the postmaster interlock whatever
`shared_memory_type` says, and 28 suites each booted their own under unbounded
vitest file parallelism. The failure is not a code defect and does not name
itself as a budget:

```
FATAL:  could not create shared memory segment: No space left on device
DETAIL: Failed system call was shmget(key=47187408, size=56, 03600).
HINT:   ... the system's overall limit for shared memory has been reached.
```

The reviews recorded the same command exiting 1 on a cold run (433s, wide
overlap) and 0 on a warm one (189s, narrow overlap) at one commit on one
machine.

## What changed

| Before | After |
|---|---|
| 16 hand-copied `missingPostgresReason`, 16 binary searches, different `initdb` flags | `scripts/rls/postgresHost.mjs` owns the search, the skip predicate and the cluster budget |
| 27 hand-rolled cluster boots in test files | `__tests__/helpers/postgres.ts` boots the one cluster; 31 suites read it |
| Unbounded file parallelism | `vitest.config.ts` `maxWorkers: 4`, plus a host-wide slot budget (`PUBMAX_PG_MAX_CLUSTERS`, default 6) |
| `npm run test:rls` exited 0 on a skip | exits 1 unless `PUBMAX_RLS_ALLOW_SKIP=1` admits it |
| 6 suites in `RLS_SUITES`, 3 new proofs in a job with no PostgreSQL | `scripts/rls/postgresSuites.mjs` is the closed list of 31, read by the runner, the CI exclusions and a fence |
| `gate:e2e-skips`, `gate:playwright`, `check:freshness` invoked by nothing | static gates in `verify`; the report gate beside the browser suite in `e2e.yml` |
| `weather` dated by a file a serverless filesystem cannot write | store-stamped; the committed file is a declared `degraded-fallback` |

## The runs

Two consecutive full runs on this machine, no serial rerun, no `--no-file-parallelism`:

```
$ npm test -- --run          # run 1
 Test Files  1482 passed | 1 skipped (1483)
      Tests  15586 passed | 1 skipped (15587)
exit 0

$ npm test -- --run          # run 2, immediately after
 Test Files  1482 passed | 1 skipped (1483)
      Tests  15586 passed | 1 skipped (15587)
exit 0
```

Zero `shmget` failures in either log, no serial rerun, and no
`--no-file-parallelism`. Live clusters during a run peaked at the budget rather
than at the number of Postgres-backed suites.

## The gates, proved

```
$ PUBMAX_RLS_NO_PG=1 npm run test:rls                              exit 1
$ PUBMAX_RLS_ALLOW_SKIP=1 PUBMAX_RLS_NO_PG=1 npm run test:rls      exit 0
$ npm run gate:e2e-skips        conditional skip scan passed: 215 spec file(s), exit 0
$ node scripts/check_freshness.mjs                                  exit 0
$ node scripts/check_freshness.mjs --require-store                  exit 1
```
