import { randomBytes } from "node:crypto";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// One fresh key per Vitest invocation, serialized through test.env to every
// worker. This keeps production-mode unit tests realistic without weakening
// application policy or placing secret material in npm commands / process argv.
const VITEST_PLAN_SIGNING_SECRET = randomBytes(32).toString("base64url");

// Node environment: we test pure functions (venues, curation) and the API route
// handler by calling it directly — no DOM needed. "@/..." resolves to repo root,
// matching tsconfig paths.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    env: {
      PLAN_IDEMPOTENCY_SECRET: VITEST_PLAN_SIGNING_SECRET,
    },
    // Strips Vercel deployment env vars (VERCEL_ENV, VERCEL) so build-pipeline
    // test runs don't masquerade as production runtimes — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    // v8 coverage instrumentation plus concurrent agent worktrees can starve
    // repository-wide scans and subprocess validation past the default 5s.
    // Keep a bounded 60s ceiling so those real assertions remain deterministic
    // without turning a genuine hang into an unbounded release wait.
    testTimeout: 60000,
    // A cluster boot plus a migration chain is a hook, not a test, and vitest's
    // default hook ceiling is 10s. 180s is the same ceiling every Postgres-
    // backed suite declares on its own beforeAll.
    hookTimeout: 180000,
    // BOUNDED FILE PARALLELISM. Unbounded workers ran 28 throwaway PostgreSQL
    // clusters at once against a macOS default of `kern.sysv.shmmni = 32`, and
    // the same commit on the same machine then exited 1 on a cold run and 0 on
    // a warm one - the flake the 5 September 2026 reviews both landed on. Four
    // is the `--maxWorkers=4` path `npm run coverage` already passes on, so
    // `npm test` and the coverage gate now run the same way; the host-wide
    // cluster budget in scripts/rls/postgresHost.mjs is the second line,
    // because two worktrees can run this suite at once.
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Score the business logic (pure libs) and the API route handlers — the
      // surfaces where a regression actually breaks the app. UI components are
      // excluded; they're covered by the Playwright E2E suite instead.
      include: ["lib/**", "app/api/**"],
      exclude: ["**/*.d.ts", "**/*.d.mts", "**/*.md"],
      // Regression gate, not a target. Thresholds sit ~2% under the measured
      // numbers so CI stays green today (2026-09-06, full suite, 1464 files:
      // statements 81.35%, branches 74.62%, functions 85.57%, lines 85.08% —
      // up from 72.86/-/78.82/75.86 measured 2026-07-09, whose floors of
      // 71/-/77/74 had drifted 8 to 11 points below the real figures and so
      // would have passed a large regression without a word).
      // BRANCHES is scored from this wave on: it was the one metric with no
      // floor at all, which is where an untested error path hides.
      // RATCHET RULE: thresholds only ever rise; re-floor them after each wave
      // that lands fully-tested pure libs. The point is to PREVENT a drop.
      thresholds: {
        statements: 79,
        branches: 72,
        functions: 83,
        lines: 83,
      },
    },
  },
});
