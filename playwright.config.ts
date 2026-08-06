import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// P3.11 browser smoke suite. Chromium projects use production builds on
// fixed ports (kept off 3000 so they won't collide
// with a hand-run `next dev`). Assertions are WebGL-agnostic so headless boxes
// with no GPU don't false-fail — see e2e/smoke.spec.ts.
const PORT = Number(process.env.PW_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const KEYLESS_PORT = Number(process.env.PW_KEYLESS_PORT ?? PORT + 1);
const KEYLESS_BASE_URL = `http://localhost:${KEYLESS_PORT}`;
const SCREENSHOT_RUN = !!process.env.PW_SCREENSHOTS;
const SKIP_WEBSERVER = process.env.PW_SKIP_WEBSERVER === "1";
const FIREFOX_DESKTOP_MAP_CHROME_FIT =
  process.env.PW_FIREFOX_DESKTOP_MAP_CHROME_FIT === "1";
// Prefer an explicit Playwright override, then an inherited NEXT_DIST_DIR from
// scripts/run-with-restored-next-env.mjs (shots / shots:extended build into a
// unique .next-isolated dir and must start the same tree), then the defaults.
const NEXT_DIST_DIR =
  process.env.PW_NEXT_DIST_DIR ??
  process.env.NEXT_DIST_DIR ??
  (SCREENSHOT_RUN ? ".next" : ".next-e2e");
const KEYLESS_NEXT_DIST_DIR =
  process.env.PW_KEYLESS_NEXT_DIST_DIR ?? `${NEXT_DIST_DIR}-keyless`;
// Production-style browser tests retain the keyless in-memory stores, but
// trusted Plan claims never use that storage escape hatch. Give each Playwright
// invocation a fresh process-only signing key shared by its build/start shell.
// webServer.env keeps both values out of the command string and process argv.
const E2E_PLAN_SIGNING_SECRET = randomBytes(32).toString("base64url");
// Public-only deterministic test key. The private half is neither needed nor
// present: E2E stubs the browser subscription while exercising the real UI and
// registration POST. NEXT_PUBLIC_* must be present at Next build time.
const E2E_VAPID_PUBLIC_KEY = "BJVNwV9XflSMFMBkpBQ8zuzYIfru_xnE_LnqA3x8ENQl2ehKJYw_20TE1UTVr_7vQ207rjQwC1FHbbKE9QeOk4w";
const E2E_POSTHOG_PROJECT_TOKEN = "phc_pubmaxx_e2e_public_test";
const E2E_SUPABASE_URL = "https://pubmaxx-e2e.supabase.co";
const E2E_SUPABASE_PUBLISHABLE_KEY = "pubmaxx-e2e-publishable-key";
const REAL_AUTH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

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
    // Existing journeys start as returning visitors who already declined, so
    // the first-visit prompt cannot cover controls unrelated to their test.
    // The consent spec overrides this with an empty browser state.
    storageState: {
      cookies: [],
      origins: [{
        origin: BASE_URL,
        localStorage: [{
          name: "pubmaxx:analytics-consent:v1",
          value: "denied",
        }],
      }],
    },
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
        "**/price-contribution-auth.spec.ts",
        "**/price-contribution-entry.spec.ts",
        "**/map-gl.spec.ts",
        "**/map-fallback.spec.ts",
        "**/map-service-worker.spec.ts",
        "**/map-uk-base-layer.spec.ts",
        // Flag-ON specs run only in the chromium-flag-on project against a
        // flag-on build (L20 zero-skip contract) — never in the default
        // flag-off suite, where their assertions would false-fail.
        "**/*.flag-on.spec.ts",
      ],
    },
    ...(FIREFOX_DESKTOP_MAP_CHROME_FIT
      ? [{
          name: "firefox-desktop-map-chrome-fit",
          testMatch: [
            "**/desktop-map-chrome-fit.spec.ts",
            "**/map-surface-history.spec.ts",
          ],
          timeout: 60_000,
          use: { ...devices["Desktop Firefox"] },
        }]
      : []),
    {
      name: "chromium-keyless",
      testMatch: "**/price-contribution-entry.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: KEYLESS_BASE_URL,
        storageState: {
          cookies: [],
          origins: [{
            origin: KEYLESS_BASE_URL,
            localStorage: [{
              name: "pubmaxx:analytics-consent:v1",
              value: "denied",
            }],
          }],
        },
      },
    },
    ...(REAL_AUTH_CONFIGURED
      ? [{
          name: "chromium-real-auth",
          testMatch: "**/price-contribution-auth.spec.ts",
          use: { ...devices["Desktop Chrome"] },
        }]
      : []),
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
      testMatch: [
        "**/map-gl.spec.ts",
        "**/map-console-health.spec.ts",
        // Synthetic webglcontextlost recovery — needs a real GL canvas.
        "**/map-webgl-recovery.spec.ts",
        // UK base layer: asserts the zoom gate + a real tap on a painted pin.
        "**/map-uk-base-layer.spec.ts",
      ],
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
        // delayed-tile scenarios in map-gl.spec.ts. Blocking SW registration
        // keeps route()-based delays on the page's network path, including the
        // phone readiness-ceiling case that must reach the no-frame fallback.
        serviceWorkers: "block",
      },
    },
    {
      // Service-worker map regression. Keeps SW interception enabled and uses
      // SwiftShader so the quota-pressure test reaches a real MapLibre canvas.
      name: "chromium-sw-gl",
      testMatch: "**/map-service-worker.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
        serviceWorkers: "allow",
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
    {
      // Flag-ON half of the trusted-handoff matrix (L20 zero-skip contract).
      // Runs ONLY the *.flag-on.spec.ts files, and only when invoked
      // explicitly with the relevant PUBMAX_* flags exported — the shared
      // webServer then builds a flag-on server (env pass-through below), so each
      // spec's assertion always executes with no runtime test.skip. Kept out of
      // a bare `playwright test` (no flags) because its specs assume a flag-on
      // build; the assembly gate runs it as its own flag-set invocation.
      name: "chromium-flag-on",
      testMatch: "**/*.flag-on.spec.ts",
      use: { ...devices["Desktop Chrome"] },
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
                // Mobile and desktop both need a real GL stack: without
                // SwiftShader headless Chromium can sit forever on the map
                // loading shell and the visual gate would snapshot a lie.
                launchOptions: {
                  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
                },
              },
              testMatch: "**/screenshots.spec.ts",
            })),
          ),
        ]
      : []),
  ],
  webServer: SKIP_WEBSERVER
    ? undefined
    : [
      {
        command: SCREENSHOT_RUN
          ? `npm run start -- --port ${PORT}`
          : `node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port ${PORT}`,
        // Trusted Plan claims never touch the keyless escape hatch: give each run a
        // fresh process-only signing key via env so it stays out of the command argv.
        env: {
          NEXT_DIST_DIR,
          NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
          NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: E2E_POSTHOG_PROJECT_TOKEN,
          // Browser auth stays provider-shaped in keyless E2E. Identity specs
          // seed a Supabase session and intercept this non-routable boundary;
          // server stores remain keyless and in memory.
          NEXT_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            E2E_SUPABASE_PUBLISHABLE_KEY,
          PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
          PUBMAX_E2E_KEYLESS: "1",
          // Auth regressions may opt into the real public Supabase project.
          // Keep these as pass-throughs: browser tests must not fake auth over
          // the wire, and ordinary keyless runs remain network-independent.
          ...(process.env.NEXT_PUBLIC_SUPABASE_URL
            ? {
                NEXT_PUBLIC_SUPABASE_URL:
                  process.env.NEXT_PUBLIC_SUPABASE_URL,
              }
            : {}),
          ...(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            ? {
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
                  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              }
            : {}),
          // Pass-through for lane e2e that must exercise a flag-on server
          // (L19 landing hierarchy). Unknown/absent stays off (strict 0|1).
          ...(process.env.PUBMAX_LANDING_FIND_MY_PINT
            ? { PUBMAX_LANDING_FIND_MY_PINT: process.env.PUBMAX_LANDING_FIND_MY_PINT }
            : {}),
          // Trusted-handoff flag pass-throughs for the deferred lane e2e (L20
          // prep): each stays off unless the run exports it, so a flag-ON spec
          // (test.skip-gated on the same var) drives a matching flag-on server.
          ...(process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_READ
            ? { PUBMAX_TRUSTED_HANDOFF_INTENT_READ: process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_READ }
            : {}),
          ...(process.env.PUBMAX_ANCHORED_GENERATION
            ? { PUBMAX_ANCHORED_GENERATION: process.env.PUBMAX_ANCHORED_GENERATION }
            : {}),
          ...(process.env.PUBMAX_MAP_ROUTE_TRANSFER
            ? { PUBMAX_MAP_ROUTE_TRANSFER: process.env.PUBMAX_MAP_ROUTE_TRANSFER }
            : {}),
          ...(process.env.PUBMAX_PAL_HANDOFF
            ? { PUBMAX_PAL_HANDOFF: process.env.PUBMAX_PAL_HANDOFF }
            : {}),
          // L15 Tonight trusted UI: the canonical grouping/layout and the explicit
          // Venue acceptance are each flag-ON server behaviour, so the flag-ON spec
          // exports these to drive a matching server. Absent stays off (strict 0|1).
          ...(process.env.PUBMAX_TONIGHT_GROUPING
            ? { PUBMAX_TONIGHT_GROUPING: process.env.PUBMAX_TONIGHT_GROUPING }
            : {}),
          ...(process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2
            ? { PUBMAX_FRIEND_MEMBER_REHYDRATION_V2: process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 }
            : {}),
          ...(process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE
            ? { PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE: process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE }
            : {}),
        },
        url: BASE_URL,
        reuseExistingServer: !process.env.CI && !SCREENSHOT_RUN,
        // Production build can take a while cold; give it room in CI.
        timeout: 600_000,
        stdout: "pipe",
        stderr: "pipe",
      },
      ...(!SCREENSHOT_RUN && !FIREFOX_DESKTOP_MAP_CHROME_FIT
        ? [{
            command:
              `node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port ${KEYLESS_PORT}`,
            env: {
              NEXT_DIST_DIR: KEYLESS_NEXT_DIST_DIR,
              NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
              NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
              NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
                E2E_POSTHOG_PROJECT_TOKEN,
              NEXT_PUBLIC_SUPABASE_URL: "",
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
              PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
              PUBMAX_E2E_KEYLESS: "1",
            },
            url: KEYLESS_BASE_URL,
            reuseExistingServer: !process.env.CI,
            timeout: 600_000,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
          }]
        : []),
    ],
});
