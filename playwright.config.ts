import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// P3.11 browser smoke suite. One chromium project, one webServer that builds and
// serves a production build on a fixed port (kept off 3000 so it won't collide
// with a hand-run `next dev`). Assertions are WebGL-agnostic so headless boxes
// with no GPU don't false-fail — see e2e/smoke.spec.ts.
const PORT = Number(process.env.PW_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_RUN = !!process.env.PW_SCREENSHOTS;
const SKIP_WEBSERVER = process.env.PW_SKIP_WEBSERVER === "1";
const NEXT_DIST_DIR =
  process.env.PW_NEXT_DIST_DIR ?? (SCREENSHOT_RUN ? ".next" : ".next-e2e");
// Production-style browser tests retain the keyless in-memory stores, but
// trusted Plan claims never use that storage escape hatch. Give each Playwright
// invocation a fresh process-only signing key shared by its build/start shell.
// webServer.env keeps both values out of the command string and process argv.
const E2E_PLAN_SIGNING_SECRET = randomBytes(32).toString("base64url");
// Public-only deterministic test key. The private half is neither needed nor
// present: E2E stubs the browser subscription while exercising the real UI and
// registration POST. NEXT_PUBLIC_* must be present at Next build time.
const E2E_VAPID_PUBLIC_KEY = "BJVNwV9XflSMFMBkpBQ8zuzYIfru_xnE_LnqA3x8ENQl2ehKJYw_20TE1UTVr_7vQ207rjQwC1FHbbKE9QeOk4w";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: process.env.PUBMAX_GATE_Z_VIDEO ? "on" : "off",
  },
  // Screenshots are design-QA artifacts, not assertions: kept out of the
  // `chromium` project (testIgnore below) and out of `playwright test`'s
  // project list entirely by default — Playwright runs every configured
  // project when no --project filter is given, so the "screenshots" project
  // below are only added to the array when PW_SCREENSHOTS=1 is set. Each
  // device/theme combination is a real Playwright project so `npm run shots`
  // exercises (and reports) the complete design-QA matrix explicitly.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The GL-specific specs need launch flags (SwiftShader / --disable-webgl)
      // that only make sense in their own projects below; the default box is
      // WebGL-agnostic (smoke.spec asserts canvas-OR-fallback), so running them
      // here would false-fail. Screenshots are design-QA artifacts, excluded too.
      testIgnore: [
        "**/screenshots.spec.ts",
        "**/map-gl.spec.ts",
        "**/map-fallback.spec.ts",
      ],
    },
    {
      // GPU-present project: SwiftShader gives Chromium a real software WebGL2
      // context even on a GPU-less box, so map-gl.spec can assert the canvas
      // genuinely paints and the fallback never shows.
      // --enable-unsafe-swiftshader is required in recent Chromium to permit the
      // software rasterizer for WebGL after the "unsafe SwiftShader" gating.
      name: "chromium-gl",
      // GL-requiring specs: map-gl asserts the canvas paints; map-console-health
      // asserts the scene stays error-free across repeated navigation. Both need
      // a real WebGL2 context (SwiftShader), so both run here.
      testMatch: ["**/map-gl.spec.ts", "**/map-console-health.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
        // OfflineReady (components/OfflineReady.tsx) only registers public/sw.js
        // in production, and this project's webServer runs a production build —
        // so without this, the SW's stale-while-revalidate tile cache serves
        // tiles.openfreemap.org responses from cache, bypassing page.route()
        // network interception entirely (SW fetch handling happens outside
        // Playwright's request interception). That silently defeated the
        // "delayed tiles" scenario in map-gl.spec.ts (pin-reveal reason came
        // back "tiles" instead of the expected "timeout"). Blocking SW
        // registration for this project keeps every route()-based delay/failure
        // simulation honest.
        serviceWorkers: "block",
      },
    },
    {
      // No-WebGL project: both WebGL entry points disabled so the MapLibre
      // constructor gets no context, exercising the honest fallback path in
      // map-fallback.spec.
      name: "chromium-no-gl",
      testMatch: "**/map-fallback.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--disable-webgl", "--disable-webgl2"],
        },
      },
    },
    ...(process.env.PW_SCREENSHOTS
      ? [
          ...(["light", "dark"] as const).flatMap((theme) =>
            [
              { width: 390, height: 844, formFactor: "mobile" },
              { width: 430, height: 932, formFactor: "mobile" },
              { width: 1280, height: 800, formFactor: "desktop" },
              { width: 1440, height: 900, formFactor: "desktop" },
            ].map(({ width, height, formFactor }) => ({
              name: `shots-${width}-${theme}`,
              metadata: {
                screenshotTheme: theme,
                screenshotFormFactor: formFactor,
                screenshotViewport: String(width),
              },
              use: {
                ...(formFactor === "mobile" ? devices["iPhone 13"] : devices["Desktop Chrome"]),
                browserName: "chromium" as const,
                viewport: { width, height },
                ...(formFactor === "desktop"
                  ? {
                      launchOptions: {
                        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                      },
                    }
                  : {}),
              },
              testMatch: "**/screenshots.spec.ts",
            })),
          ),
        ]
      : []),
  ],
  webServer: SKIP_WEBSERVER
    ? undefined
    : {
        command: SCREENSHOT_RUN
          ? `npm run start -- --port ${PORT}`
          : `npm run build && npm run start -- --port ${PORT}`,
        // Trusted Plan claims never touch the keyless escape hatch: give each run a
        // fresh process-only signing key via env so it stays out of the command argv.
        env: {
          NEXT_DIST_DIR,
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
          PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
          PUBMAX_E2E_KEYLESS: "1",
        },
        url: BASE_URL,
        reuseExistingServer: !process.env.CI && !SCREENSHOT_RUN,
        // Production build can take a while cold; give it room in CI.
        timeout: 600_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
