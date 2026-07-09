import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Node environment: we test pure functions (venues, curation) and the API route
// handler by calling it directly — no DOM needed. "@/..." resolves to repo root,
// matching tsconfig paths.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // v8 coverage instrumentation slows async tests enough to trip the default
    // 5s per-test timeout under `npm run coverage`; 20s absorbs that overhead
    // without masking a genuine hang. Plain `npm test` finishes in seconds.
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Score the business logic (pure libs) and the API route handlers — the
      // surfaces where a regression actually breaks the app. UI components are
      // excluded; they're covered by the Playwright E2E suite instead.
      include: ["lib/**", "app/api/**"],
      // Regression gate, not a target. Thresholds sit ~2% under the measured
      // numbers so CI stays green today (2026-07-09: lines 75.86%, functions
      // 78.82%, statements 72.86% — up from 74.03/77.43/71.04).
      // RATCHET RULE: thresholds only ever rise; re-floor them after each wave
      // that lands fully-tested pure libs. The point is to PREVENT a drop.
      thresholds: {
        lines: 74,
        functions: 77,
        statements: 71,
      },
    },
  },
});
