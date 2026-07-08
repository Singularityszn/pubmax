import { test, expect, type Page } from "@playwright/test";

// Mobile screenshots — design-QA artifacts, not assertions. Captures the five
// key surfaces at 390×844 (iPhone-class width, the same viewport smoke.spec's
// nav-overflow / mobile-sheet tests use) in BOTH themes, so a reviewer can eyeball
// visual regressions without running the app locally.
//
// NOT part of the default `npm run test:e2e` run — see playwright.config.ts's
// `testIgnore`/`testMatch` split. Invoke explicitly:
//
//   npx playwright test --project=screenshots
//
// Output lands in e2e/screenshots/ (gitignored — these are local artifacts, not
// checked-in fixtures). Each test only asserts the page loaded (status 200);
// the screenshot itself is the deliverable, so there is nothing else to assert.

const VIEWPORT = { width: 390, height: 844 };
const OUT_DIR = "e2e/screenshots";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  // Matches e2e/smoke.spec.ts's documented storage key/behaviour: the ThemeToggle
  // persists to localStorage and re-applies data-theme on mount. Setting it before
  // navigation (addInitScript) avoids a flash and the toggle-click round trip.
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
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

const THEMES: Array<"light" | "dark"> = ["light", "dark"];

for (const theme of THEMES) {
  test.describe(`screenshots @ 390x844 — ${theme} theme`, () => {
    test.use({ viewport: VIEWPORT });

    test(`landing (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.screenshot({ path: `${OUT_DIR}/landing-${theme}.png`, fullPage: true });
    });

    test(`map with sheet open (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      // Same known seed venue id the other new specs deep-link to, so the sheet
      // opens deterministically without a canvas pin click.
      const ARNOS_ARMS_ID = "venue-xjf3n0"; // Arnos Arms — same FNV-1a id as e2e/smoke.spec.ts
      const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
      expect(response?.status()).toBe(200);
      await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
      await waitForMobileVenueSheet(page);
      await page.screenshot({ path: `${OUT_DIR}/map-sheet-${theme}.png` });
    });

    test(`feed (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      const response = await page.goto("/feed");
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.screenshot({ path: `${OUT_DIR}/feed-${theme}.png`, fullPage: true });
    });

    test(`profile /u/you (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      const response = await page.goto("/u/you");
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.screenshot({ path: `${OUT_DIR}/profile-you-${theme}.png`, fullPage: true });
    });

    test(`activity (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      const response = await page.goto("/activity");
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.screenshot({ path: `${OUT_DIR}/activity-${theme}.png`, fullPage: true });
    });
  });
}
