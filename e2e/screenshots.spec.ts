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
] as const;

const DOCS_DIR = "docs/screenshots";
const OUT_DIR = "e2e/screenshots";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
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
