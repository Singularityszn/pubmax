import { defineConfig, devices } from "@playwright/test";

// P3.11 browser smoke suite. One chromium project, one webServer that builds and
// serves a production build on a fixed port (kept off 3000 so it won't collide
// with a hand-run `next dev`). Assertions are WebGL-agnostic so headless boxes
// with no GPU don't false-fail — see e2e/smoke.spec.ts.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

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
  // below is only added to the array when PW_SCREENSHOTS=1 is set. Invoke
  // explicitly:
  //   PW_SCREENSHOTS=1 npx playwright test --project=screenshots
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
          {
            name: "screenshots",
            use: { ...devices["Desktop Chrome"] },
            testMatch: "**/screenshots.spec.ts",
          },
        ]
      : []),
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    // Production build can take a while cold; give it room in CI.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
