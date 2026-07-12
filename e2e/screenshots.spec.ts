import { test, expect, type Page } from "@playwright/test";

// Mobile screenshots — design-QA artifacts for Loop 0 demo gate. Captures key
// surfaces at 390×844 and 430×932 in BOTH themes.
//
// NOT part of the default `npm run test:e2e` run — see playwright.config.ts.
// Invoke explicitly:
//
//   PW_SCREENSHOTS=1 npx playwright test --project=screenshots
//
// Primary deliverables land in docs/screenshots/ (committed reference PNGs).
// A mirror also writes to e2e/screenshots/ (gitignored local artifacts).

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  // Desktop pass for the design-consistency audit (z-index/nav/spill/focus).
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
] as const;

const DOCS_DIR = "docs/screenshots";
const OUT_DIR = "e2e/screenshots";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  }, theme);
}

async function waitForMobileVenueSheet(page: Page): Promise<void> {
  await page.locator(".mapDrawer.right.open .venueInspector").waitFor({
    state: "visible",
    timeout: 10000,
  });
  await page.waitForFunction(() => {
    const drawer = document.querySelector<HTMLElement>(".mapDrawer.right.open");
    if (!drawer) return false;

    const rect = drawer.getBoundingClientRect();
    const style = window.getComputedStyle(drawer);
    return (
      style.bottom !== "auto" &&
      rect.left >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.width >= window.innerWidth - 2
    );
  });
}

async function shot(page: Page, basename: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: `${DOCS_DIR}/${basename}.png`, fullPage });
  await page.screenshot({ path: `${OUT_DIR}/${basename}.png`, fullPage });
}

const THEMES: Array<"light" | "dark"> = ["light", "dark"];
const ARNOS_ARMS_ID = "venue-xjf3n0";

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`screenshots @ ${viewport.width}x${viewport.height} — ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`landing (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `landing-${theme}-${viewport.name}`, true);
      });

      test(`map clean (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/map");
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(1500);
        await shot(page, `map-clean-${theme}-${viewport.name}`);
      });

      test(`map with sheet open (${theme}, ${viewport.name})`, async ({ page }) => {
        // The mobile venue sheet is a bottom-drawer; on desktop the inspector
        // is a side panel, so this mobile-specific wait doesn't apply.
        test.skip(viewport.width >= 1024, "mobile bottom-sheet only");
        await setTheme(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await waitForMobileVenueSheet(page);
        await shot(page, `map-sheet-${theme}-${viewport.name}`);
      });

      test(`map log intent (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/map?log=1");
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(2000);
        await shot(page, `map-log-${theme}-${viewport.name}`);
      });

      test(`tonight (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/tonight");
        expect(response?.status()).toBe(200);
        // Deterministic: the tonight screen mounts with this testid once it
        // has rendered real content (or the honest empty/thin state) — never
        // the loading/error shell.
        await page.getByTestId("tonight-screen").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `tonight-${theme}-${viewport.name}`, true);
      });

      test(`plan (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/plan");
        expect(response?.status()).toBe(200);
        // Deterministic: the plan builder's h1 guards against shooting a
        // loading/error shell.
        await page
          .getByRole("heading", { level: 1, name: "Put the night in order." })
          .waitFor({ state: "visible", timeout: 15000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `plan-${theme}-${viewport.name}`, true);
      });

      test(`venue sheet desktop (${theme}, ${viewport.name})`, async ({ page }) => {
        test.skip(viewport.width < 1024, "desktop inspector only");
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
        await shot(page, `venue-desktop-${theme}-${viewport.name}`);
      });

      test(`feed (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/feed");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `feed-${theme}-${viewport.name}`, true);
      });

      test(`crawls (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/crawls");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `crawls-${theme}-${viewport.name}`, true);
      });

      test(`profile /u/you (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/u/you");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `profile-you-${theme}-${viewport.name}`, true);
      });

      test(`activity (${theme}, ${viewport.name})`, async ({ page }) => {
        await setTheme(page, theme);
        const response = await page.goto("/activity");
        expect(response?.status()).toBe(200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await shot(page, `activity-${theme}-${viewport.name}`, true);
      });
    });
  }
}
