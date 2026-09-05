import { expect, test, type Page } from "@playwright/test";

// EVERY VENUE SECTION IS ON SCREEN. verify-preview-4 (5 Sep 2026, section 6):
// the venue sheet's tab strip scrolled sideways under a fade, and at 390 the
// seventh tab (Train) sat at x 368 to 412 past the viewport edge, while 320
// hid Lore, Ask and Train. The strip wraps on a phone now
// (components/map/venueSheet.css); this reads the RENDERED boxes at both
// widths: no overflow, every tab inside the viewport, every tab owning the
// point at its own centre.

const WIDTHS = [320, 390] as const;
const VENUE_URL = "/map?sel=venue-1vle947";

async function preparePage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const width of WIDTHS) {
  test(`phone ${width}: all seven venue tabs fit, wrap, and own their centres`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await preparePage(page);
    await page.goto(VENUE_URL);

    const strip = page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .venueTabs');
    await expect(strip).toBeVisible({ timeout: 30_000 });
    const tabs = strip.locator(".venueTab");
    await expect(tabs).toHaveCount(7);
    // The sheet opens at half, and on a 568px-tall phone its scroll body is
    // shorter than the head above the strip, so the strip is brought into the
    // body's own box first: what is measured is the strip, not the snap.
    await strip.scrollIntoViewIfNeeded();

    const geometry = await strip.evaluate((el) => {
      const strip = el.getBoundingClientRect();
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        fade: el.getAttribute("data-trailing-fade"),
        tabs: [...el.querySelectorAll(".venueTab")].map((tab) => {
          const r = tab.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            label: tab.getAttribute("aria-label"),
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            ownsCentre: hit === tab || tab.contains(hit),
            insideStrip: r.top >= strip.top - 0.5 && r.bottom <= strip.bottom + 0.5,
          };
        }),
      };
    });

    // Nothing scrolls sideways, so nothing is hidden and no fade claims it is.
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.fade).toBe("off");
    // Two rows of the same pill: more than one distinct top edge.
    expect(new Set(geometry.tabs.map((tab) => Math.round(tab.top))).size).toBeGreaterThan(1);
    for (const tab of geometry.tabs) {
      expect(tab.left, `${tab.label} starts inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(tab.right, `${tab.label} ends inside the viewport`).toBeLessThanOrEqual(width);
      expect(tab.insideStrip, `${tab.label} sits inside the strip`).toBe(true);
      expect(tab.ownsCentre, `${tab.label} owns its own centre`).toBe(true);
      expect(tab.bottom - tab.top, `${tab.label} keeps the 44px floor`).toBeGreaterThanOrEqual(44);
    }
  });
}
