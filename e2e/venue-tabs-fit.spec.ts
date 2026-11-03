import { expect, test, type Page } from "@playwright/test";

// EVERY VENUE SECTION IS ON SCREEN. verify-preview-4 (5 Sep 2026, section 6):
// the venue sheet's tab strip scrolled sideways under a fade, and at 390 the
// seventh tab (Train) sat at x 368 to 412 past the viewport edge, while 320
// hid Lore, Ask and Train. The wrap that fixed it drew two rows (site audit 13
// Sep 2026, D10), so the sheet has five tabs now, in one row at default text
// size, and large text wraps the strip rather than clipping a label
// (components/map/venueSheet.css). This reads the RENDERED boxes: no overflow,
// one row, every tab inside the viewport, every tab owning the point at its own
// centre; and at 200% text, a wrapped strip with every label inside its own tab
// and no two tabs overlapping.

const WIDTHS = [320, 390] as const;
const VENUE_URL = "/map?sel=venue-1vle947";
const PORTAL = '.mobileSheetPortal[data-sheet-kind="venue"]';

async function preparePage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const width of WIDTHS) {
  test(`phone ${width}: all five venue tabs fit one row and own their centres`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await preparePage(page);
    await page.goto(VENUE_URL);

    const strip = page.locator(`${PORTAL} .venueTabs`);
    await expect(strip).toBeVisible({ timeout: 30_000 });
    const tabs = strip.locator(".venueTab");
    await expect(tabs).toHaveCount(5);
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
    // One row: every tab shares one top edge.
    expect(new Set(geometry.tabs.map((tab) => Math.round(tab.top))).size).toBe(1);
    for (const tab of geometry.tabs) {
      expect(tab.left, `${tab.label} starts inside the viewport`).toBeGreaterThanOrEqual(0);
      expect(tab.right, `${tab.label} ends inside the viewport`).toBeLessThanOrEqual(width);
      expect(tab.insideStrip, `${tab.label} sits inside the strip`).toBe(true);
      expect(tab.ownsCentre, `${tab.label} owns its own centre`).toBe(true);
      expect(tab.bottom - tab.top, `${tab.label} keeps the 44px floor`).toBeGreaterThanOrEqual(44);
    }
  });
}

test("phone 390 at 200% text: the tab strip wraps with every label whole inside its own tab", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page);
  await page.goto(VENUE_URL);

  const strip = page.locator(`${PORTAL} .venueTabs`);
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(strip.locator(".venueTab")).toHaveCount(5);
  // The user's own text size: the tab labels are sized in rem, so doubling the
  // root doubles every label.
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  // Reduced motion still leaves a near-zero `transition` on every element, so
  // the root reads 16px until the next frame. Measure only once it is doubled.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    .toBe("32px");
  await strip.scrollIntoViewIfNeeded();

  const geometry = await strip.evaluate((el) => {
    const strip = el.getBoundingClientRect();
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      stripLeft: strip.left,
      stripRight: strip.right,
      tabs: [...el.querySelectorAll<HTMLElement>(".venueTab")].map((tab) => {
        const r = tab.getBoundingClientRect();
        const label = [...tab.children].find(
          (child) => getComputedStyle(child).display !== "none",
        );
        const range = document.createRange();
        if (label) range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        return {
          label: tab.getAttribute("aria-label"),
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          textLeft: text.left,
          textRight: text.right,
          textWidth: text.width,
        };
      }),
    };
  });

  // Large text wraps rather than shrinking a label past its pill.
  expect(new Set(geometry.tabs.map((tab) => Math.round(tab.top))).size).toBeGreaterThan(1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  for (const tab of geometry.tabs) {
    expect(tab.textWidth, `${tab.label} label is painted`).toBeGreaterThan(0);
    expect(tab.left, `${tab.label} starts inside the strip`).toBeGreaterThanOrEqual(geometry.stripLeft - 0.5);
    expect(tab.right, `${tab.label} ends inside the strip`).toBeLessThanOrEqual(geometry.stripRight + 0.5);
    expect(tab.textLeft, `${tab.label} label is not cut on the left`).toBeGreaterThanOrEqual(tab.left - 0.5);
    expect(tab.textRight, `${tab.label} label is not cut on the right`).toBeLessThanOrEqual(tab.right + 0.5);
  }
  for (let i = 0; i < geometry.tabs.length; i += 1) {
    for (let j = i + 1; j < geometry.tabs.length; j += 1) {
      const a = geometry.tabs[i];
      const b = geometry.tabs[j];
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      expect(overlapX > 0.5 && overlapY > 0.5, `${a.label} and ${b.label} do not overlap`).toBe(false);
    }
  }
});

// Named photo fallbacks now draw a sign in a short reserved frame. The old
// placeholder was one line. The price and the five tabs must remain usable.
// The Sir Christopher Hatton has no photo.
for (const viewport of [
  { width: 390, height: 844, scope: PORTAL },
  { width: 1440, height: 900, scope: ".venueInspector" },
] as const) {
  test(`${viewport.width}: the illustrated header is short and the tabs remain usable`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await preparePage(page);
    await page.goto(VENUE_URL);

    const photo = page
      .locator(`${viewport.scope} .venueBaselinePhoto.venueImage--empty`)
      .filter({ visible: true })
      .first();
    await expect(photo).toBeVisible({ timeout: 30_000 });
    await expect(photo.getByRole("img", { name: /Illustrated sign for The Sir Christopher Hatton/ })).toBeVisible();
    await expect(photo.locator(".venueImage__provenance")).toHaveCount(0);
    await expect(photo.locator(".pubSign__plaque, .pubSign__since")).toHaveCount(0);
    const box = await photo.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const column = element.parentElement as HTMLElement;
      const style = getComputedStyle(column);
      return {
        width: rect.width,
        height: rect.height,
        columnWidth: column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(box.height).toBeCloseTo(112, 0);
    expect(Math.abs(box.width - box.columnWidth)).toBeLessThanOrEqual(2);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);

    const photosTab = page.locator(`${viewport.scope} .venueTabs`).getByRole("tab", { name: "Photos", exact: true });
    await photosTab.scrollIntoViewIfNeeded();
    await photosTab.focus();
    await expect(photosTab).toBeFocused();
    await expect(async () => {
      await photosTab.click();
      await expect(photosTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  });

  test(`${viewport.width}: a real photo retains its existing frame`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await preparePage(page);
    // Keep the real pub's photo path, but serve local image bytes so this
    // geometry check does not depend on the pub website answering.
    await page.route("**/api/image-proxy?**", (route) => route.fulfill({
      path: "public/landing/hero-thames-1024.jpg", contentType: "image/jpeg",
    }));
    await page.goto("/map?sel=venue-1eycmcw");
    const photo = page.locator(`${viewport.scope} .venueBaselinePhoto:not(.venueImage--empty)`).filter({ visible: true }).first();
    await expect(photo).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => photo.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(photo.locator(".pubSign")).toHaveCount(0);
    await expect(photo.locator(".venueImage__provenance")).toHaveText("Photo: pub website");
    const frame = await photo.boundingBox();
    expect(frame).not.toBeNull();
    if (viewport.width >= 1024) expect(frame!.height).toBeCloseTo(220, 0);
    else expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1);
  });
}
