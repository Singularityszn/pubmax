import { defineConfig, devices } from "@playwright/test";

// P3.11 browser smoke suite. One chromium project, one webServer that builds and
// serves a production build on a fixed port (kept off 3000 so it won't collide
// with a hand-run `next dev`). Assertions are WebGL-agnostic so headless boxes
// with no GPU don't false-fail — see e2e/smoke.spec.ts.
const PORT = Number(process.env.PW_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_RUN = !!process.env.PW_SCREENSHOTS;

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
  webServer: {
    command: SCREENSHOT_RUN
      ? `PUBMAX_E2E_KEYLESS=1 npm run start -- --port ${PORT}`
      : `NEXT_DIST_DIR=.next-e2e PUBMAX_E2E_KEYLESS=1 npm run build && NEXT_DIST_DIR=.next-e2e PUBMAX_E2E_KEYLESS=1 npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !SCREENSHOT_RUN,
    // Production build can take a while cold; give it room in CI.
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
