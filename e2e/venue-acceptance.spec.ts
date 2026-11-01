import { expect, test, type Page } from "@playwright/test";

import { proofShotPath } from "./helpers/proofShot";

const VENUE_ID = "venue-xjf3n0";
const VENUE_NAME = "Arnos Arms";
const INTENT_KEY = "pubmax:planning-intent:v1";
const CONSENT_KEY = "pubmaxx:analytics-consent:v1";

async function captureAnalytics(page: Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("390px Map acceptance persists before Plan receives Stop 1", async ({ page }, testInfo) => {
  await page.goto(`/map?sel=${VENUE_ID}`);
  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  // With no crawl in progress the phone sheet's ONE plan door is the peek's
  // coral `Make it Stop 1` (lib/venuePlanDoor.ts); the footer bar has none.
  const accept = portal
    .locator(".mobileVenuePeekSummary")
    .getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(accept).toBeVisible({ timeout: 30_000 });
  await expect(portal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` })).toHaveCount(1);

  const [box, overflow] = await Promise.all([
    accept.boundingBox(),
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ]);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(overflow).toBeLessThanOrEqual(1);

  await accept.click();
  await expect(page).toHaveURL(/\/plan$/);
  const intent = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, INTENT_KEY);
  expect(intent).toMatchObject({
    source: "map-search",
    acceptedVenueId: VENUE_ID,
  });
  await expect(page.getByText("Carried over from what you accepted")).toBeVisible();
  await expect(page.locator(".planStop__name").first()).toHaveText(VENUE_NAME);
  await page.evaluate(() => {
    localStorage.setItem("pubmax-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({ path: proofShotPath(testInfo, "docs/proof/venue-acceptance/accepted-plan-390-light.png") });
  await page.evaluate(() => {
    localStorage.setItem("pubmax-theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: proofShotPath(testInfo, "docs/proof/venue-acceptance/accepted-plan-390-dark.png") });
});

/**
 * ONE PLAN DOOR, AND IT FITS (owner decision option C, 16 Oct 2026). The phone
 * footer bar is Share alone, and a lone ghost is the size of its label rather
 * than an edge-to-edge slab (components/map/venueSheet.css). The peek's
 * `Make it Stop 1` is the longest label the plan door carries, so it is the one
 * measured at 320 with large text: Android's system font scale is a root font
 * size, the same emulation e2e/mobile-large-text.spec.ts uses.
 */
for (const width of [320, 390] as const) {
  for (const textScale of [1, 1.5, 2] as const) {
    test(`Venue actions fit ${width}px at ${textScale}x text`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/map?sel=${VENUE_ID}`);
      const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
      const toolbar = portal.getByRole("toolbar", { name: "Venue actions" });
      await expect(toolbar).toBeVisible({ timeout: 30_000 });
      // Hydration rewrites the root's style attribute, so the scale is set once
      // the sheet is up, as e2e/mobile-large-text.spec.ts does, then read back.
      await expect(async () => {
        const rootFontPx = await page.evaluate(async (scale) => {
          const root = document.documentElement;
          root.setAttribute("data-text-scale", scale === 1 ? "default" : "large");
          root.style.fontSize = `${scale * 100}%`;
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
          return Number.parseFloat(getComputedStyle(root).fontSize);
        }, textScale);
        expect(rootFontPx).toBeCloseTo(16 * textScale);
      }).toPass({ timeout: 10_000 });
      const share = toolbar.getByRole("button", { name: `Share ${VENUE_NAME}` });
      await expect(share).toBeVisible();
      // "Ask for a table" and Share: the action card's second row.
      await expect(toolbar.getByRole("button")).toHaveCount(2);

      const door = portal
        .locator(".mobileVenuePeekSummary")
        .getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
      await expect(door).toHaveText("Make it Stop 1");
      await page.evaluate(() => document.fonts.ready);

      const geometry = await page.evaluate(() => {
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const portalRoot = document.querySelector('.mobileSheetPortal[data-sheet-kind="venue"]')!;
        const row = portalRoot.querySelector(".mobileVenuePeekSummary")!;
        const door = row.querySelector(".mobileVenuePeekPlanDoor")!;
        const label = document.createRange();
        label.selectNodeContents(door);
        const bar = portalRoot.querySelector(".venueSheetStickyBar")!;
        const share = bar.querySelector('button[aria-label^="Share"]')!;
        const [price, walk] = Array.from(row.querySelectorAll(":scope > span, :scope > .mobileVenuePeekDrop"));
        return {
          row: box(row),
          cells: [box(price), box(walk), box(door)],
          door: box(door),
          label: box(label),
          labelClipped: door.scrollWidth > door.clientWidth + 1,
          bar: box(bar),
          share: box(share),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      // The door's label sits inside the door, and the door inside its row and the phone.
      expect(geometry.labelClipped).toBe(false);
      expect(geometry.label.left).toBeGreaterThanOrEqual(geometry.door.left - 0.5);
      expect(geometry.label.right).toBeLessThanOrEqual(geometry.door.right + 0.5);
      expect(geometry.label.top).toBeGreaterThanOrEqual(geometry.door.top - 0.5);
      expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.door.bottom + 0.5);
      expect(geometry.door.right).toBeLessThanOrEqual(geometry.row.right + 0.5);
      expect(geometry.door.right).toBeLessThanOrEqual(width);
      expect(geometry.door.height).toBeGreaterThanOrEqual(44);
      // No cell of the peek is drawn over another: large text moves the door to
      // its own line rather than squeezing the price plaque under the walk.
      const [price, walk, doorCell] = geometry.cells;
      const apart = (a: typeof price, b: typeof price) =>
        a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
      expect(apart(price, walk), "price and walk").toBe(true);
      expect(apart(walk, doorCell), "walk and door").toBe(true);
      expect(apart(price, doorCell), "price and door").toBe(true);
      // Share shares its row with "Ask for a table": a thumb target, never the
      // whole width of the card.
      expect(geometry.share.height).toBeGreaterThanOrEqual(44);
      expect(geometry.share.width).toBeGreaterThanOrEqual(44);
      expect(geometry.share.width).toBeLessThan(geometry.bar.width);
      expect(geometry.overflow).toBeLessThanOrEqual(1);

      if (textScale === 1 || textScale === 2) {
        await page.screenshot({
          path: proofShotPath(
            testInfo,
            `docs/proof/one-plan-door/stop-1-${width}${textScale === 1 ? "" : "-large-text"}.png`,
          ),
        });
      }
    });
  }
}

test("1440px accepted arrival keeps receipt, focus, and Near provenance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(([key, venueId]) => {
    const now = Date.now();
    sessionStorage.setItem(key, JSON.stringify({
      version: 1,
      source: "near",
      cityId: "london",
      acceptedVenueId: venueId,
      acceptedArea: { kind: "borough", name: "Camden" },
      startsAt: new Date(now + 60 * 60 * 1000).toISOString(),
      displayEvidence: {
        kind: "price",
        observedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
  }, [INTENT_KEY, VENUE_ID] as const);

  await page.goto(`/map?sel=${VENUE_ID}&accept=1&src=near`);
  await expect(page.getByText("Kept for tonight. Make it Stop 1 when you are ready.")).toBeVisible({
    timeout: 30_000,
  });
  const accept = page.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` });
  await expect(accept).toBeVisible();
  await accept.focus();
  await expect(accept).toBeFocused();
  expect(await accept.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");

  await accept.click();
  await expect(page).toHaveURL(/\/plan$/);
  const intent = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, INTENT_KEY);
  expect(intent).toMatchObject({
    source: "near",
    acceptedArea: { kind: "borough", name: "Camden" },
    displayEvidence: { kind: "price", observedAt: expect.any(String) },
  });
});

test("storage denial stays on Venue and emits no acceptance events", async ({ page }) => {
  await page.addInitScript(([intentKey, consentKey]) => {
    localStorage.setItem(consentKey, "granted");
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === sessionStorage && key === intentKey) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return nativeSetItem.call(this, key, value);
    };
  }, [INTENT_KEY, CONSENT_KEY] as const);
  const payloads = await captureAnalytics(page);

  await page.goto(`/map?sel=${VENUE_ID}`);
  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await portal.getByRole("button", { name: `Make ${VENUE_NAME} Stop 1` }).click();

  await expect(page).toHaveURL(new RegExp(`/map\\?sel=${VENUE_ID}$`));
  await expect(portal.getByRole("alert")).toHaveText(
    "Couldn’t keep this pub on this device. Try again.",
  );
  // Visible error is action completion. Storage failed before trackEvent, so
  // no analytics request can be queued after this state.
  const acceptanceNames = payloads.flatMap((payload) => (
    payload && typeof payload === "object" && typeof (payload as { name?: unknown }).name === "string"
      ? [(payload as { name: string }).name]
      : []
  )).filter((name) => name === "venue_accepted" || name === "planning_handoff_opened");
  expect(acceptanceNames).toEqual([]);
});
