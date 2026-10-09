import { randomBytes } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

import { assertE2ELoginSafe, isE2ELoginEnabled } from "./lib/e2eReviewAuth";
import { resolvePlaywrightNextDistDir } from "./lib/playwrightDistDir";
import {
  UI_UX_CHROMIUM_ARGS,
  uiUxChromiumProjectUse,
} from "./scripts/lib/uiUxBattleTestBrowser.mjs";

// P3.11 browser smoke suite. Chromium projects use production builds on
// fixed ports (kept off 3000 so they won't collide
// with a hand-run `next dev`). Assertions are WebGL-agnostic so headless boxes
// with no GPU don't false-fail — see e2e/smoke.spec.ts.
const PORT = Number(process.env.PW_PORT ?? 3100);
const BASE_URL = `http://${process.env.PW_DISPOSABLE_PLAN_DB === "1" ? "127.0.0.1" : "localhost"}:${PORT}`;
const KEYLESS_PORT = Number(process.env.PW_KEYLESS_PORT ?? PORT + 1);
const KEYLESS_BASE_URL = `http://localhost:${KEYLESS_PORT}`;
const SCREENSHOT_RUN = !!process.env.PW_SCREENSHOTS;
const SKIP_WEBSERVER = process.env.PW_SKIP_WEBSERVER === "1";
const SKIP_KEYLESS_WEBSERVER = process.env.PW_SKIP_KEYLESS_WEBSERVER === "1";
const DISPOSABLE_PLAN_DB = process.env.PW_DISPOSABLE_PLAN_DB === "1";
const DISPOSABLE_SUPABASE_URL = process.env.PW_DISPOSABLE_SUPABASE_URL;
const DISPOSABLE_SERVICE_ROLE_KEY = process.env.PW_DISPOSABLE_SERVICE_ROLE_KEY;
if (DISPOSABLE_PLAN_DB) {
  const url = DISPOSABLE_SUPABASE_URL && new URL(DISPOSABLE_SUPABASE_URL);
  if (!url || url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
    !DISPOSABLE_SERVICE_ROLE_KEY || !SKIP_KEYLESS_WEBSERVER || SKIP_WEBSERVER ||
    process.env.PW_SCREENSHOTS || process.env.PUBMAX_E2E_LOGIN === "1") {
    throw new Error("Disposable Plan browser needs loopback PostgREST, a private service key, and its owned Playwright server only.");
  }
}
const UI_UX_BROWSER_USE = uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL);
const FIREFOX_DESKTOP_MAP_CHROME_FIT =
  process.env.PW_FIREFOX_DESKTOP_MAP_CHROME_FIT === "1";
// The photo picker defect was an iPhone one, so the crop step is worth running
// on the Safari engine as well. Opt-in like the Firefox project above, because
// a fresh clone installs Chromium alone and an absent browser would fail every
// default `npm run test:e2e`.
const WEBKIT_PROFILE_PHOTO_CROP = process.env.PW_WEBKIT_PROFILE_PHOTO_CROP === "1";
const E2E_LOGIN = isE2ELoginEnabled();
if (E2E_LOGIN) {
  loadEnvConfig(process.cwd());
  assertE2ELoginSafe();
}
const NEXT_DIST_DIR = resolvePlaywrightNextDistDir();
const KEYLESS_NEXT_DIST_DIR =
  process.env.PW_KEYLESS_NEXT_DIST_DIR ?? `${NEXT_DIST_DIR}-keyless`;
const AUTH_PORT = Number(process.env.PW_AUTH_PORT ?? PORT + 2);
const AUTH_BASE_URL = `http://localhost:${AUTH_PORT}`;
const AUTH_NEXT_DIST_DIR =
  process.env.PW_AUTH_NEXT_DIST_DIR ?? `${NEXT_DIST_DIR}-auth`;
const E2E_NODE_OPTIONS = process.env.NODE_OPTIONS ?? "--max-old-space-size=4096";
const E2E_TRACKED_OUTPUTS_ALLOWLIST =
  process.env.PUBMAX_TRACKED_OUTPUTS ?? (process.env.CI ? "public/data" : "");
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
// Production browser builds enforce Supabase key roles. Keep the E2E key fake,
// but give it the same public-key shape as the value it stands in for so the
// browser auth graph remains enabled and route doubles can answer it.
const E2E_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_pubmaxx_e2e";
const E2E_ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";
// The founders' door is read from the environment at build time, so a keyless
// E2E build renders no door at all unless the build is given one. This code is
// deliberately fake: the specs assert the door RENDERS and where it points, and
// a real invite committed here would be a live door into a private room.
const E2E_DISCORD_INVITE_URL = "https://discord.gg/pubmaxx-e2e-invite";
const E2E_RATE_LIMIT_SALT =
  process.env.RATE_LIMIT_SALT ?? "pubmax-e2e-rate-limit-salt-32-chars-min";
// Two Playwright workers share one production-style process and one hashed
// loopback IP. Production stays at 8 / 60s (plans) and 60 / 60s (CityMCP);
// only this harness raises the in-process ceiling so console-error
// assertions do not see the limiter answering the suite.
const E2E_RATE_LIMIT_MAX = process.env.PUBMAX_E2E_RATE_LIMIT_MAX ?? "10000";
const REAL_AUTH_CONFIGURED = Boolean(
  !E2E_LOGIN && !DISPOSABLE_PLAN_DB &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

if (
  E2E_LOGIN &&
  (!process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
) {
  throw new Error(
    "PUBMAX_E2E_LOGIN=1 requires real Supabase URL, publishable key, and service-role key in the local environment.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Observed on the local rig: at four workers the single production-style
  // server died mid-suite and every later context reported connection refused
  // (267 of them). At two workers it stays up. CI shards run a server each, so
  // the cap is the local rig's alone.
  workers: process.env.CI ? undefined : 2,
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
        }, {
          // Default journeys are returning visitors. First-visit specs clear
          // this key explicitly before navigation so arrival coverage remains
          // deliberate instead of leaking into unrelated map assertions.
          name: "pubmax:map-first-visit-arrival:v1",
          value: "dismissed",
        }],
      }],
    },
    trace: "on-first-retry",
    video: process.env.PUBMAX_GATE_Z_VIDEO ? "on" : "off",
  },
  // Screenshot projects produce design-QA artifacts and assert each journey's
  // ready state. e2e/screenshots.spec.ts owns the map-paint requirement. Keep
  // them out of the `chromium` project (testIgnore below) and out of
  // `playwright test`'s project list by default. Playwright runs every
  // configured project when no --project filter is given, so these projects
  // are added only when PW_SCREENSHOTS=1 is set. Each device/theme combination
  // is a real Playwright project, so `npm run shots` reports the matrix.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The GL-specific specs need launch flags (SwiftShader / --disable-webgl)
      // that only make sense in their own projects below; the default box is
      // WebGL-agnostic (smoke.spec asserts canvas-OR-fallback), so running them
      // here would false-fail. Screenshots are design-QA artifacts, excluded too.
      testIgnore: [
        // The production smoke suite drives a deployed site, never this
        // build. playwright.prod-smoke.config.ts owns it.
        "**/prod-smoke/**",
        "**/screenshots.spec.ts",
        ...(DISPOSABLE_PLAN_DB ? [] : ["**/plan-selected-drink-disposable.spec.ts"]),
        "**/price-contribution-auth.spec.ts",
        "**/price-contribution-entry.spec.ts",
        // Keyless-shape composer submit: runs only against the keyless build,
        // where the typed demo handle exists (chromium-keyless below).
        "**/spill-composer-keyless.spec.ts",
        "**/ui-ux-battle-test-keyless.spec.ts",
        "**/map-gl.spec.ts",
        "**/map-gestures.spec.ts",
        "**/map-deep-link-pin.spec.ts",
        // Every WebGL journey belongs to chromium-gl. Keeping these out of the
        // plain Chromium project avoids running the same spec without SwiftShader
        // (and without its blocked service worker) before the GL project runs it.
        "**/map-console-health.spec.ts",
        "**/map-arrival-turn.spec.ts",
        "**/map-you-are-here.spec.ts",
        "**/map-arrival-card-pins.spec.ts",
        "**/map-desktop-arrival-chrome.spec.ts",
        "**/map-tile-retry.spec.ts",
        "**/map-webgl-recovery.spec.ts",
        "**/map-fallback.spec.ts",
        "**/map-service-worker.spec.ts",
        "**/map-uk-base-layer.spec.ts",
        "**/map-london-restaurants.spec.ts",
        "**/map-live-qa-0924.spec.ts",
        "**/plan-route-strip.spec.ts",
        "**/ui-ux-battle-test.spec.ts",
        "**/signed-in-review.spec.ts",
        // The Core Web Vitals sweep owns its own project: it needs a real GL
        // context for the map routes, and it re-emulates device, CPU and
        // network per run, which this project's fixed device would fight.
        "**/cwv-baseline.spec.ts",
      ],
    },
    {
      // The Core Web Vitals baseline and its regression fence
      // (e2e/cwv-baseline.spec.ts). Two of its six routes are the map, and the
      // product timing it exists to record is the first pin a thumb can land
      // on, so it needs the same SwiftShader context chromium-gl uses: without
      // one the canvas never gets a context, the map takes its honest fallback,
      // and the sweep would record the fallback's speed as the product's.
      //
      // It sets its own viewport, CPU throttle and network profile per device
      // (e2e/helpers/webVitals.ts), so the project supplies no device of its
      // own. Service workers are blocked because a cold run has to mean an
      // empty HTTP cache, and a stale-while-revalidate worker would answer from
      // its own store past the cache clear.
      name: "chromium-cwv",
      testMatch: ["**/cwv-baseline.spec.ts"],
      timeout: 3 * 60 * 60_000,
      use: {
        ...devices["Desktop Chrome"],
        ...UI_UX_BROWSER_USE,
        serviceWorkers: "block",
      },
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
    ...(WEBKIT_PROFILE_PHOTO_CROP
      ? [{
          name: "webkit-profile-photo-crop",
          testMatch: ["**/profile-photo-crop.spec.ts"],
          use: {
            ...devices["iPhone 14"],
            // The spec answers the upload route itself. Playwright reaches
            // through a registered service worker in Chromium but not in
            // WebKit, where the POST went past the route to the real keyless
            // server and came back a 403. Keep the worker out of this project.
            serviceWorkers: "block" as const,
          },
        }]
      : []),
    {
      name: "chromium-keyless",
      testMatch: [
        "**/price-contribution-entry.spec.ts",
        "**/spill-composer-keyless.spec.ts",
        "**/ui-ux-battle-test-keyless.spec.ts",
      ],
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
            }, {
              name: "pubmax:map-first-visit-arrival:v1",
              value: "dismissed",
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
    ...(E2E_LOGIN
      ? [{
          name: "chromium-authenticated",
          testMatch: "**/signed-in-review.spec.ts",
          use: {
            ...devices["Desktop Chrome"],
            baseURL: AUTH_BASE_URL,
            storageState: { cookies: [], origins: [] },
          },
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
        // Two-finger rotate and tilt against a real MapLibre canvas.
        "**/map-gestures.spec.ts",
        // The opening turn and the first-visit card's grip on the pins: both
        // read a real camera and a real painted-pin probe.
        "**/map-arrival-turn.spec.ts",
        "**/map-arrival-card-pins.spec.ts",
        // The reader's own dot: a real GeoJSON source on a real scene, and a
        // real camera to hold still while the dot moves.
        "**/map-you-are-here.spec.ts",
        // The arrival chrome count at 1440: a rendered map, so a real canvas.
        "**/map-desktop-arrival-chrome.spec.ts",
        // A deep-linked pin's painted position against the phone sheet's own
        // rendered edge: both need a real MapLibre camera to project from.
        "**/map-deep-link-pin.spec.ts",
        "**/map-console-health.spec.ts",
        // Silent basemap-source retry: needs a real error path off a real scene.
        "**/map-tile-retry.spec.ts",
        // Synthetic webglcontextlost recovery — needs a real GL canvas.
        "**/map-webgl-recovery.spec.ts",
        // UK base layer: asserts the zoom gate + a real tap on a painted pin.
        "**/map-uk-base-layer.spec.ts",
        // London restaurants: one pack read + a real tap on a painted restaurant.
        "**/map-london-restaurants.spec.ts",
        // /map/list opening List view, and a cold /map opening on London: both
        // need rendered venue rows and a real camera probe.
        "**/map-live-qa-0924.spec.ts",
        // The Plan result's route strip: a real MapLibre canvas above the cards.
        "**/plan-route-strip.spec.ts",
        "**/ui-ux-battle-test.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        ...UI_UX_BROWSER_USE,
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
          args: UI_UX_CHROMIUM_ARGS,
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
                  args: UI_UX_CHROMIUM_ARGS,
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
          : `node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port ${PORT}${DISPOSABLE_PLAN_DB ? " --hostname 127.0.0.1" : ""}`,
        // Trusted Plan claims never touch the keyless escape hatch: give each run a
        // fresh process-only signing key via env so it stays out of the command argv.
        env: {
          NODE_OPTIONS: E2E_NODE_OPTIONS,
          NEXT_DIST_DIR,
          // E2E builds run from a checkout whose generated data is stamped
          // `local`. Keep GitHub's GITHUB_SHA from rewriting those tracked
          // fixtures and tripping the restored-build guard.
          NEXT_PUBLIC_SW_VERSION: "local",
          NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
          NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: E2E_POSTHOG_PROJECT_TOKEN,
          // Browser auth stays provider-shaped in keyless E2E. Identity specs
          // seed a Supabase session and intercept this non-routable boundary;
          // server stores remain keyless and in memory.
          NEXT_PUBLIC_SUPABASE_URL: DISPOSABLE_PLAN_DB ? DISPOSABLE_SUPABASE_URL! : E2E_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            E2E_SUPABASE_PUBLISHABLE_KEY,
          SUPABASE_URL: DISPOSABLE_PLAN_DB ? DISPOSABLE_SUPABASE_URL! : "",
          SUPABASE_SERVICE_ROLE_KEY: DISPOSABLE_PLAN_DB ? DISPOSABLE_SERVICE_ROLE_KEY! : "",
          OPENROUTER_API_KEY: DISPOSABLE_PLAN_DB ? "" : process.env.OPENROUTER_API_KEY ?? "",
          VERCEL_ENV: DISPOSABLE_PLAN_DB ? "development" : process.env.VERCEL_ENV ?? "",
          NEXT_PUBLIC_DISCORD_INVITE_URL: E2E_DISCORD_INVITE_URL,
          PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
          ADMIN_TOKEN: E2E_ADMIN_TOKEN,
          RATE_LIMIT_SALT: E2E_RATE_LIMIT_SALT,
          PUBMAX_E2E_RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX,
          PUBMAX_E2E_LOGIN: "0",
          PUBMAX_E2E_KEYLESS: DISPOSABLE_PLAN_DB ? "0" : "1",
          // Auth regressions may opt into the real public Supabase project.
          // Keep these as pass-throughs: browser tests must not fake auth over
          // the wire, and ordinary keyless runs remain network-independent.
          ...(process.env.NEXT_PUBLIC_SUPABASE_URL && !E2E_LOGIN && !DISPOSABLE_PLAN_DB
            ? {
                NEXT_PUBLIC_SUPABASE_URL:
                  process.env.NEXT_PUBLIC_SUPABASE_URL,
              }
            : {}),
          ...(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !E2E_LOGIN && !DISPOSABLE_PLAN_DB
            ? {
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
                  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
              }
            : {}),
          // The one remaining rollout flag: the Social launch rollback switch.
          ...(process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH
            ? { PUBMAX_SOCIAL_FRIENDS_LAUNCH: process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH }
            : {}),
          ...(E2E_TRACKED_OUTPUTS_ALLOWLIST
            ? { PUBMAX_TRACKED_OUTPUTS: E2E_TRACKED_OUTPUTS_ALLOWLIST }
            : {}),
        },
        url: BASE_URL,
        reuseExistingServer: !DISPOSABLE_PLAN_DB && !process.env.CI && !SCREENSHOT_RUN,
        // Production build can take a while cold; give it room in CI.
        timeout: 600_000,
        stdout: "pipe",
        stderr: "pipe",
      },
      ...(!SCREENSHOT_RUN &&
      !FIREFOX_DESKTOP_MAP_CHROME_FIT &&
      !SKIP_KEYLESS_WEBSERVER
        ? [{
            command:
              `node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port ${KEYLESS_PORT}`,
            env: {
              NODE_OPTIONS: E2E_NODE_OPTIONS,
              NEXT_DIST_DIR: KEYLESS_NEXT_DIST_DIR,
              NEXT_PUBLIC_SW_VERSION: "local",
              NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
              NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
              NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
                E2E_POSTHOG_PROJECT_TOKEN,
              NEXT_PUBLIC_SUPABASE_URL: "",
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
              NEXT_PUBLIC_DISCORD_INVITE_URL: E2E_DISCORD_INVITE_URL,
              PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
              PUBMAX_E2E_RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX,
              PUBMAX_E2E_LOGIN: "0",
              PUBMAX_E2E_KEYLESS: "1",
              ...(E2E_TRACKED_OUTPUTS_ALLOWLIST
                ? { PUBMAX_TRACKED_OUTPUTS: E2E_TRACKED_OUTPUTS_ALLOWLIST }
                : {}),
            },
            url: KEYLESS_BASE_URL,
            reuseExistingServer: !process.env.CI,
            timeout: 600_000,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
          }]
        : []),
      ...(E2E_LOGIN
        ? [{
            command:
              `node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port ${AUTH_PORT}`,
            env: {
              NODE_OPTIONS: E2E_NODE_OPTIONS,
              NEXT_DIST_DIR: AUTH_NEXT_DIST_DIR,
              NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
                process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
              SUPABASE_URL: process.env.SUPABASE_URL ?? "",
              SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
              ...(process.env.SUPABASE_STORAGE_BUCKET
                ? { SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET }
                : {}),
              PUBMAX_E2E_LOGIN: "1",
              VERCEL_ENV: "development",
              NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
              NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
              NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: E2E_POSTHOG_PROJECT_TOKEN,
              PLAN_IDEMPOTENCY_SECRET: E2E_PLAN_SIGNING_SECRET,
              ADMIN_TOKEN: E2E_ADMIN_TOKEN,
              RATE_LIMIT_SALT: E2E_RATE_LIMIT_SALT,
              PUBMAX_E2E_RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX,
            },
            url: AUTH_BASE_URL,
            reuseExistingServer: false,
            timeout: 600_000,
            stdout: "pipe" as const,
            stderr: "pipe" as const,
          }]
        : []),
    ],
});
