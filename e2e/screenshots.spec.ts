import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

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

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

async function waitForMobileVenueSheet(page: Page): Promise<void> {
  const inspector = page.locator(".venueInspector");
  await inspector.waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await inspector.getByRole("heading", { level: 3, name: "Arnos Arms" }).waitFor({
    state: "visible",
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
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(1500);
        await shot(page, `map-clean-${theme}-${viewportName}`);
      });

      test("map with sheet open", async ({ page }) => {
        // The mobile venue sheet is a bottom-drawer; on desktop the inspector
        // is a side panel, so this mobile-specific wait doesn't apply.
        test.skip(isDesktop, "mobile bottom-sheet only");
        await setTheme(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await waitForMobileVenueSheet(page);
        await shot(page, `map-sheet-${theme}-${viewportName}`);
      });

      test("map log intent", async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/map?log=1");
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(2000);
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

      test("plan location success", async ({ page, context }) => {
        test.skip(isDesktop || viewportName !== "390", "390px mobile evidence only");
        await setTheme(page, theme);
        await context.grantPermissions(["geolocation"]);
        await context.setGeolocation({ latitude: 51.527, longitude: -0.08 });
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        await page.getByRole("button", { name: "Use my location" }).click();
        await expect(page.locator(".planIntake__locationStatus")).toContainText(
          "Shoreditch is your nearest supported area",
        );
        await shot(page, `plan-location-success-${theme}-${viewportName}`);
      });

      test("plan location failure", async ({ page, context }) => {
        test.skip(isDesktop || viewportName !== "390", "390px mobile evidence only");
        await setTheme(page, theme);
        await context.grantPermissions(["geolocation"]);
        await context.setGeolocation({ latitude: 53.48, longitude: -2.24 });
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        await page.getByRole("button", { name: "Clapham" }).click();
        await page.getByRole("button", { name: "Use my location" }).click();
        await expect(page.locator(".planIntake__locationStatus")).toContainText(
          "outside London",
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

      test("shared planned night", async ({ page, request }) => {
        await setTheme(page, theme);
        const fixture = await createPlanFixture(request, "ready");
        const response = await page.goto(`/plan/${fixture.id}`);
        expect(response?.status()).toBe(200);
        await page.getByRole("heading", { level: 1, name: "Friday around Arnos Grove" }).waitFor();
        await expect(page.getByText("Karan", { exact: true })).toBeVisible();
        await expect(page.getByText("Luna", { exact: true })).toBeVisible();
        await shot(page, `planned-night-shared-${theme}-${viewportName}`);
      });

      test("active night", async ({ page, request }) => {
        await setTheme(page, theme);
        const fixture = await createPlanFixture(request, "active");
        await page.addInitScript(({ id, startTime }) => {
          window.localStorage.setItem(
            "pubmax_active_plan",
            JSON.stringify({ id, startTime, stopIndex: 0 }),
          );
        }, fixture);
        const response = await page.goto("/map");
        expect(response?.status()).toBe(200);
        await page.getByRole("region", { name: "Map" }).waitFor({
          state: "visible",
          timeout: 20_000,
        });
        await page.getByRole("region", { name: "Tonight's plan" }).waitFor({
          state: "visible",
          timeout: 15000,
        });
        await expect(page.getByText("On tonight · The Gate Zero night")).toBeVisible({
          timeout: 60_000,
        });
        await shot(page, `active-night-${theme}-${viewportName}`);
      });

      test("venue sheet desktop", async ({ page }) => {
        test.skip(!isDesktop, "desktop inspector only");
        await setTheme(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        // Deterministic: wait for the selected venue's inspector content (the
        // desktop docked panel) instead of a fixed sleep.
        const inspector = page.locator(".venueInspector");
        await inspector.waitFor({ state: "visible", timeout: 15000 });
        await inspector
          .getByText("Arnos Arms")
          .first()
          .waitFor({ state: "visible", timeout: 15000 });
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
