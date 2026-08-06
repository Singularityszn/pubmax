import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { planMemberCookieName } from "@/lib/planMemberCapability";

// Design-QA artifacts for the Gate-Z baseline. The configured Playwright
// projects own the desktop/mobile and light/dark matrix.
//
// NOT part of the default `npm run test:e2e` run — see playwright.config.ts.
// Invoke explicitly:
//
//   npm run shots
//
// Primary deliverables land in docs/screenshots/ (committed reference PNGs).
// A mirror also writes to e2e/screenshots/ (gitignored local artifacts).

const DOCS_DIR = process.env.SHOTS_DOCS_DIR ?? "docs/screenshots";
const OUT_DIR = process.env.SHOTS_OUT_DIR ?? "e2e/screenshots";

type PaintedMapTapPoint = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
};

type GeolocationFix = {
  latitude: number;
  longitude: number;
};

async function mockGeolocation(page: Page, fix: GeolocationFix): Promise<void> {
  await page.addInitScript(({ latitude, longitude }) => {
    let requestCount = 0;
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          const current = requestCount++ === 0
            ? { latitude: 51.527, longitude: -0.08 }
            : { latitude, longitude };
          queueMicrotask(() => {
            success({
              coords: {
                latitude: current.latitude,
                longitude: current.longitude,
                accuracy: 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          });
        },
        watchPosition() {
          return 0;
        },
        clearWatch() {},
      },
    });
  }, fix);
}

async function waitForStableAreaStep(page: Page): Promise<void> {
  await page
    .getByRole("heading", { name: "When are you heading out?" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByRole("heading", { name: "Where should the night happen?" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await expect(page.locator(".planIntake__locate")).toBeEnabled({ timeout: 15_000 });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // Arm pin-reveal before any /map navigation so waitForLoadedMap can see it.
    const revealWindow = window as typeof window & {
      __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
    };
    if (!revealWindow.__pubmaxPinRevealTrace) {
      const trace: Array<{ reason: string; generation: number }> = [];
      revealWindow.__pubmaxPinRevealTrace = trace;
      window.addEventListener("pubmax:pin-reveal", (event) => {
        trace.push(
          (event as CustomEvent<{ reason: string; generation: number }>).detail,
        );
      });
    }
  }, theme);
}

/** Count pub marks the map is painting right now (pins + clusters). */
async function paintedMapMarkCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => PaintedMapTapPoint[];
      }
    ).__pubmaxPaintedMapTapPoints;
    return probe?.().length ?? 0;
  });
}

async function pinRevealCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
        }
      ).__pubmaxPinRevealTrace?.length ?? 0,
  );
}

/**
 * Wait until the MapLibre scene has painted pubs.
 * A fixed sleep after `.mapCanvasWrap` is not enough: the wrap appears while
 * the loading shell still says "Rounding up the pubs", and a green gate that
 * only waits for the wrap lies. `paintedPinProbe` + `pubmax:pin-reveal` are
 * the product-owned ready signals (see repo CLAUDE.md).
 *
 * `requireTappableMarks` is for clean map shots: the probe only returns marks
 * not covered by chrome. A venue sheet can cover every pin, so deep-link
 * shots rely on pin-reveal instead and still fail on the loading fallback.
 */
async function waitForLoadedMap(
  page: Page,
  options: { requireTappableMarks?: boolean } = {},
): Promise<void> {
  const { requireTappableMarks = false } = options;
  await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20_000 });

  // Fail fast if the GL stack never arrives: the honest fallback is not a map.
  await expect(page.locator(".mapFallback")).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const marks = await paintedMapMarkCount(page);
        const reveals = await pinRevealCount(page);
        if (requireTappableMarks) return marks;
        // pin-reveal proves symbols painted; tappable marks prove chrome-clear
        // pins. Either is enough when the sheet may cover the pin the reader
        // is already looking at.
        return Math.max(marks, reveals);
      },
      {
        message: requireTappableMarks
          ? "map visual gate requires at least one tappable painted pub mark"
          : "map visual gate requires pin-reveal or a painted pub mark",
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(0);

  await expect(page.locator(".mapLoading")).toHaveCount(0);
  await expect(page.getByText("Rounding up the pubs")).toHaveCount(0);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".maplibreMap canvas, .maplibregl-canvas").first()).toBeVisible();
}

async function waitForMobileVenueSheet(page: Page): Promise<void> {
  // Match the mobile sheet contract other e2e specs use: the shared right
  // drawer owns the inspector, and the name may land in the peek summary
  // before the expanded h3 is fully interactive.
  const sheet = page.locator(".mobileSharedSheet.right");
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  await expect(sheet.locator(".venueInspector")).toContainText("Arnos Arms", {
    timeout: 60_000,
  });
}

async function shot(page: Page, basename: string): Promise<void> {
  // Gate-Z compares the configured acceptance viewport. Full-document captures
  // are both noisy (dynamic feeds) and prone to hanging on scroll animations.
  // setTheme emulates reduced motion before navigation so the app's own final-
  // state rules remain authoritative; `animation: none` would hide elements
  // whose visible opacity normally comes from a forwards-filled animation.
  const png = await page.screenshot({ fullPage: false });
  await Promise.all([mkdir(DOCS_DIR, { recursive: true }), mkdir(OUT_DIR, { recursive: true })]);
  await Promise.all([
    writeFile(`${DOCS_DIR}/${basename}.png`, png),
    writeFile(`${OUT_DIR}/${basename}.png`, png),
  ]);
}

const ARNOS_ARMS_ID = "venue-xjf3n0";

type PlanFixture = { id: string; memberToken: string; startTime: string };

async function createPlanFixture(
  request: APIRequestContext,
  status: "ready" | "active",
): Promise<PlanFixture> {
  const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: status === "active" ? "The Gate Zero night" : "Friday around Arnos Grove",
      startTime,
      creatorName: "Karan",
      stops: [{ venueId: ARNOS_ARMS_ID }],
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { plan: { plan: { id: string } }; memberToken: string };
  const planId = body.plan.plan.id;

  const ready = await request.patch(`/api/plans/${planId}`, {
    data: { memberToken: body.memberToken, status: "ready" },
  });
  expect(ready.ok()).toBeTruthy();
  if (status === "active") {
    const active = await request.patch(`/api/plans/${planId}`, {
      data: { memberToken: body.memberToken, status: "active" },
    });
    expect(active.ok()).toBeTruthy();
  } else {
    const joined = await request.post(`/api/plans/${planId}/join`, {
      headers: { "idempotency-key": randomUUID() },
      data: { name: "Luna" },
    });
    expect(joined.ok()).toBeTruthy();
  }

  return { id: planId, memberToken: body.memberToken, startTime };
}

test.describe("screenshot baseline", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  let theme: "light" | "dark";
  let viewportName: "390" | "430" | "1280" | "1440";
  let isDesktop: boolean;

  test.beforeEach(({}, testInfo) => {
    const metadata = testInfo.project.metadata as {
      screenshotTheme?: "light" | "dark";
      screenshotFormFactor?: "desktop" | "mobile";
      screenshotViewport?: "390" | "430" | "1280" | "1440";
    };

    if (!metadata.screenshotTheme || !metadata.screenshotFormFactor || !metadata.screenshotViewport) {
      throw new Error("screenshots.spec.ts must run through a configured shots-* project");
    }

    theme = metadata.screenshotTheme;
    isDesktop = metadata.screenshotFormFactor === "desktop";
    viewportName = metadata.screenshotViewport;
  });

      test("landing", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `landing-${theme}-${viewportName}`);
      });

      test("map clean", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/map");
        expect(response?.status()).toBe(200);
        // Clean map: pins must be tappable, not hidden under chrome/fallback.
        await waitForLoadedMap(page, { requireTappableMarks: true });
        expect(await paintedMapMarkCount(page)).toBeGreaterThan(0);
        await shot(page, `map-clean-${theme}-${viewportName}`);
      });

      test("map with sheet open", async ({ page }) => {
        // The mobile venue sheet is a bottom-drawer; on desktop the inspector
        // is a side panel, so this mobile-specific wait doesn't apply.
        test.skip(isDesktop, "mobile bottom-sheet only");
        await setTheme(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        // Sheet may cover pins; pin-reveal still proves the map painted.
        await waitForLoadedMap(page);
        await waitForMobileVenueSheet(page);
        await shot(page, `map-sheet-${theme}-${viewportName}`);
      });

      test("map log intent", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/map?log=1");
        expect(response?.status()).toBe(200);
        // Log chrome can cover pins; pin-reveal still proves the map painted.
        await waitForLoadedMap(page);
        await shot(page, `map-log-${theme}-${viewportName}`);
      });

      test("tonight", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/tonight");
        expect(response?.status()).toBe(200);
        // Deterministic: the tonight screen mounts with this testid once it
        // has rendered real content (or the honest empty/thin state) — never
        // the loading/error shell.
        await page.getByTestId("tonight-screen").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `tonight-${theme}-${viewportName}`);
      });

      test("plan", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        // Deterministic: the plan builder's h1 guards against shooting a
        // loading/error shell.
        await page
          .getByRole("heading", { level: 1, name: "Describe the night. We’ll put it in order." })
          .waitFor({ state: "visible", timeout: 15000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `plan-${theme}-${viewportName}`);
      });

      test("plan location success", async ({ page }) => {
        test.skip(isDesktop || viewportName !== "390", "390px mobile evidence only");
        await setTheme(page, theme);
        await mockGeolocation(page, { latitude: 51.527, longitude: -0.08 });
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        await waitForStableAreaStep(page);
        const locate = page.locator(".planIntake__locate");
        await locate.click();
        await expect(page.locator(".planIntake__locationStatus")).toContainText(
          "Shoreditch is your nearest supported area",
          { timeout: 15_000 },
        );
        await shot(page, `plan-location-success-${theme}-${viewportName}`);
      });

      test("plan location failure", async ({ page }) => {
        test.skip(isDesktop || viewportName !== "390", "390px mobile evidence only");
        await setTheme(page, theme);
        await mockGeolocation(page, { latitude: 53.48, longitude: -2.24 });
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        await waitForStableAreaStep(page);
        await page.getByRole("button", { name: "Clapham" }).click();
        const locate = page.locator(".planIntake__locate");
        await locate.click();
        await expect(page.locator(".planIntake__locationStatus")).toContainText(
          "outside London",
          { timeout: 15_000 },
        );
        await expect(page.getByRole("button", { name: "Clapham" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await shot(page, `plan-location-failure-${theme}-${viewportName}`);
      });

      test("today title diversity", async ({ page }) => {
        test.skip(isDesktop || viewportName !== "390", "390px mobile evidence only");
        await setTheme(page, theme);
        const response = await page.goto("/today");
        expect(response?.status()).toBe(200);
        await page.getByTestId("today-screen").waitFor({ state: "visible", timeout: 15_000 });
        const titles = await page.locator(".todayPickTitle").allTextContents();
        const normalized = titles.map((title) =>
          title.normalize("NFKC").toLocaleLowerCase("en-GB").trim().replace(/\s+/g, " "),
        );
        expect(new Set(normalized).size).toBe(normalized.length);
        await shot(page, `today-diversity-${theme}-${viewportName}`);
      });

      test("shared planned night", async ({ page, request, context }) => {
        await setTheme(page, theme);
        const fixture = await createPlanFixture(request, "ready");
        await context.clearCookies({ name: planMemberCookieName(fixture.id) });
        const response = await page.goto(`/plan/${fixture.id}`);
        expect(response?.status()).toBe(200);
        // §4.10: the shared-link surface is the privacy-safe preview. The user
        // title ("Friday around Arnos Grove") and guest roster never land in
        // the public HTML; host display name and stop count do.
        await page
          .getByRole("heading", { level: 1, name: "Your night out" })
          .waitFor({ state: "visible", timeout: 15_000 });
        await expect(page.getByText("Karan", { exact: true })).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByText("1 pub", { exact: true })).toBeVisible({
          timeout: 15_000,
        });
        // Fixture still has the private title server-side; the page must not
        // leak it into the anonymous snapshot.
        await expect(page.getByText("Friday around Arnos Grove")).toHaveCount(0);
        await shot(page, `planned-night-shared-${theme}-${viewportName}`);
      });

      test("active night", async ({ page, request }) => {
        await setTheme(page, theme);
        const fixture = await createPlanFixture(request, "active");
        await page.addInitScript(
          ({ id, startTime, token }) => {
            window.localStorage.setItem(
              "pubmax_active_plan",
              JSON.stringify({ id, startTime, stopIndex: 0 }),
            );
            // Legacy recovery path for host capability (member route upgrade
            // still needs friendMemberRehydrationV2; the card mounts either way).
            window.sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
          },
          { id: fixture.id, startTime: fixture.startTime, token: fixture.memberToken },
        );
        // NightModeCard is deliberately null on /map (the map owns its own
        // plan sheet). Capture the shell card on an in-app route that still
        // mounts the deferred pill.
        const response = await page.goto("/tonight");
        expect(response?.status()).toBe(200);
        await page.getByTestId("tonight-screen").waitFor({
          state: "visible",
          timeout: 15_000,
        });
        await page
          .getByRole("button", { name: "Show tonight's plan" })
          .click({ timeout: 30_000 });
        const tonight = page.getByRole("dialog", { name: "Tonight's plan" });
        await tonight.waitFor({ state: "visible", timeout: 15_000 });
        await expect(tonight.locator(".nightCard__now")).toHaveText("Arnos Arms", {
          timeout: 30_000,
        });
        await expect(tonight.locator(".nightCard__loading")).toHaveCount(0);
        await shot(page, `active-night-${theme}-${viewportName}`);
      });

      test("venue sheet desktop", async ({ page }) => {
        test.skip(!isDesktop, "desktop inspector only");
        await setTheme(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        await waitForLoadedMap(page);
        // Deterministic: wait for the selected venue's inspector content (the
        // desktop docked panel) instead of a fixed sleep.
        const inspector = page.locator(".venueInspector");
        await inspector.waitFor({ state: "visible", timeout: 15_000 });
        await inspector
          .getByText("Arnos Arms")
          .first()
          .waitFor({ state: "visible", timeout: 15_000 });
        await shot(page, `venue-desktop-${theme}-${viewportName}`);
      });

      test("feed", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/feed");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `feed-${theme}-${viewportName}`);
      });

      test("crawls", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/crawls");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `crawls-${theme}-${viewportName}`);
      });

      test("profile /u/you", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/u/you");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `profile-you-${theme}-${viewportName}`);
      });

      test("activity", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/activity");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `activity-${theme}-${viewportName}`);
      });
});
