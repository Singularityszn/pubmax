import { defineConfig, devices } from "@playwright/test";

import { UI_UX_CHROMIUM_ARGS } from "./scripts/lib/uiUxBattleTestBrowser.mjs";

// The production smoke suite: real journeys against a deployed site, nothing
// mocked and no server started here. e2e/prod-smoke/README.md is the runbook.
const BASE_URL = new URL(process.env.SMOKE_BASE_URL ?? "https://pubmaxxing.com");
// Plain http is allowed on loopback only, to rehearse the suite against a
// local production build of a commit before it is deployed.
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"].includes(BASE_URL.hostname);
if (BASE_URL.protocol !== "https:" && !(LOOPBACK && BASE_URL.protocol === "http:")) {
  throw new Error(`SMOKE_BASE_URL must be an https origin, got ${BASE_URL.origin}.`);
}

// The post-deploy job must prove the signed-in journeys. Without this, a
// missing secret would quietly turn the run into the read-only half.
if (
  process.env.SMOKE_REQUIRE_SIGN_IN === "1" &&
  !(process.env.SMOKE_USER_HANDLE && process.env.SMOKE_USER_PASSWORD)
) {
  throw new Error(
    "SMOKE_REQUIRE_SIGN_IN=1 needs SMOKE_USER_HANDLE and SMOKE_USER_PASSWORD.",
  );
}

export default defineConfig({
  testDir: "./e2e/prod-smoke",
  // One worker and no retries: the signed-in journeys share one session, the
  // production limiter counts every request, and a retry would hide the very
  // flake a smoke run exists to report.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Real network, a cold production map and a model-backed Pub Pal reply.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // Playwright's own output folders: gitignored, and skipped by ESLint, which
  // would otherwise lint the HTML report's bundled JavaScript.
  outputDir: "test-results/prod-smoke",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/prod-smoke", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL.origin,
    viewport: { width: 1280, height: 900 },
    // SwiftShader gives headless Chromium a real WebGL2 context, so the map
    // paints pins instead of taking its no-GL fallback.
    launchOptions: { args: [...UI_UX_CHROMIUM_ARGS] },
    screenshot: "only-on-failure",
    // Trace screenshots read pixels back from the SwiftShader canvas on every
    // frame, and that stall alone held the London map past its readiness
    // ceiling (measured 5 Oct 2026: fallback with them, pins in 25s without).
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: true },
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },
});
