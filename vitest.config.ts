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
      // Regression gate, not a target. Thresholds are floored to the nearest 5%
      // below the current numbers so CI stays green today (measured: lines
      // 69.96%, functions 74.75%, statements 66.86%). Ratchet up over time as
      // coverage improves — the point is to PREVENT a drop, not to chase 100%.
      thresholds: {
        lines: 65,
        functions: 70,
        statements: 65,
      },
    },
  },
});
