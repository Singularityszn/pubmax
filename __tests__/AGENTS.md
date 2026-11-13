# Unit fences and the test harness

The unit suite: the PostgreSQL harness, the jsdom runtime and the fences that own a launch contract. Browser rules are in [e2e/AGENTS.md](../e2e/AGENTS.md). Repo-wide rules, including what to test, are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **One PostgreSQL harness.** Boot clusters only through `__tests__/helpers/postgres.ts`. `scripts/rls/postgresHost.mjs` owns the binary search, the skip rule and the host budget of 6 clusters. `scripts/rls/postgresSuites.mjs` is the closed list of suites that use it. `__tests__/postgresSuiteInventory.test.ts` holds that list to the code and to CI.
- **A skipped proof is a failure.** Only `PUBMAX_RLS_NO_PG=1` skips on purpose. A missing PostgreSQL that nobody opted out of throws.
- **The harness cleans its own SysV segments.** macOS allows 32. A proof calls `stop()` in `afterAll`. Never kill a cluster by hand with SIGKILL.
- **A hang fails in seconds.** The harness sets lock, statement and idle-in-transaction timeouts on every cluster.
- **A jsdom test gets `localStorage` from `vitest.setup.ts`.** Node shadows jsdom's storage. Do not restore it again in a suite.
- **A test never builds gitignored generated data.** `vitest.config.mts` builds it once before the workers start. A test reads what the setup built.
- **A port read from the Playwright config is stubbed first.** Copy the loader in `__tests__/trustedSigning.test.ts`.

## Detail

Full rules, pins and history: [`docs/rules/tests-harness-and-fences.md`](../docs/rules/tests-harness-and-fences.md).
