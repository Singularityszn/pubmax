import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "@/e2e/helpers/communitySheetFixture";
import { expect, test } from "@playwright/test";

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("mobile venue Share clipboard fallback and the one Plan door stay tappable in build mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-shared-url", value);
        },
      },
    });
  });

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build&pubs=${COMMUNITY_SHEET_FIXTURE_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toHaveClass(/open/);
  await portal.getByRole("tab", { name: "Prices", exact: true }).click();
  await expect(sheet).toHaveClass(/sheet-half/);

  const stickyActions = portal.getByRole("group", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();
  const more = stickyActions.getByRole("button", { name: "More actions for Arnos Arms" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  const moreActions = stickyActions.getByRole("group", { name: "More actions for Arnos Arms" });
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(moreActions.getByRole("button")).toHaveText([
    "Plan stop",
    "Ask for a table",
    "Summon mates",
    "Share",
  ]);

  await moreActions.getByRole("button", { name: /share arnos arms/i }).click();
  await expect(stickyActions.getByRole("status")).toHaveText(
    "Share failed, but the link was copied.",
  );
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-shared-url"))).toContain(
    `/map?sel=${ARNOS_ARMS_ID}`,
  );

  // With no fresh drinker price, the More section also carries the plan door.
  await portal.getByRole("tab", { name: "Overview", exact: true }).click();
  const planDoor = portal.locator(".venueActionCard").getByRole("button", { name: "Plan stop", exact: true });
  await expect(planDoor).toHaveAttribute("aria-pressed", "false");
  await planDoor.click();
  const inPlan = portal.locator(".venueActionCard").getByRole("button", { name: "In plan", exact: true });
  await expect(inPlan).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(`${COMMUNITY_SHEET_FIXTURE_VENUE_ID},${ARNOS_ARMS_ID}`);
  await inPlan.click();
  await expect(planDoor).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => new URL(page.url()).searchParams.get("pubs")).toBe(COMMUNITY_SHEET_FIXTURE_VENUE_ID);

});

test("mobile sticky actions stay reachable across content tabs and the sheet reopens cleanly", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toHaveClass(/open/);
  await portal.getByRole("tab", { name: "Prices", exact: true }).click();
  await expect(sheet).toHaveClass(/sheet-half/);

  const stickyActions = portal.getByRole("group", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  // The tab row is navigation; the strip holds actions only. A second content
  // tab keeps the sheet where it was.
  const loreTab = portal.getByRole("tab", { name: "Lore", exact: true });
  await loreTab.click();
  await expect(loreTab).toHaveAttribute("aria-selected", "true");
  await expect(portal.locator("#venuePanel-story")).toBeVisible();
  await expect(sheet).toHaveClass(/sheet-half/);

  // Trusted-handoff §4.6: a reload while the Venue is selected retains it (the
  // sentinel keeps `sel` in the URL), so the sheet reopens cleanly at Overview.
  // (Close now pops the selected entry with Back — covered in
  // e2e/map-selection-history.spec.ts — so we reload with the sheet still open.)
  await page.reload();
  const reopenedPortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(reopenedPortal).toBeVisible();
  await expect(reopenedPortal.locator(".mobileSharedSheet")).toHaveClass(/open/);
  await expect(reopenedPortal.getByRole("group", { name: "Venue actions" })).toBeVisible();
  await expect(reopenedPortal.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(reopenedPortal.locator("#venuePanel-overview")).toBeVisible();
});

for (const width of [320, 540, 640]) {
  test(`${width}px: the collapsed More bar does not cover the primary price-log target`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const log = portal.getByRole("button", { name: "Log what you paid at Arnos Arms", exact: true });
    await expect(log).toBeVisible();
    await expect(portal.getByRole("button", { name: "More actions for Arnos Arms" })).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({ path: testInfo.outputPath("price-log-targets.png") });
    expect(await log.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const midX = box.left + box.width / 2;
      const midY = box.top + box.height / 2;
      return [[box.left + 1, midY], [box.right - 1, midY], [midX, box.top + 1], [midX, box.bottom - 1], [midX, midY]]
        .map(([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? null);
    })).toEqual(Array(5).fill("Log what you paid at Arnos Arms"));
    await log.click();
    await expect(page.locator(".spillPriceStep")).toBeVisible();
  });
}

/**
 * At large text the footer stacks or wraps and never overlaps itself (#3329,
 * #3348). The price's plaque and its words (caption, date, source) are the
 * price's honesty, so they stay inside the price column, clear of the walk
 * and of every button, and the row stays inside the card. The coral is "Log
 * what you paid" for a listed price, and the plan door once a drinker has
 * logged a fresh one. Each coral and More keep a 44px target and do not touch.
 */
const FRESH_DROP = {
  id: "5d0c1f7e-6a43-4c57-9a3e-2f6b8f0d9c11",
  venueId: ARNOS_ARMS_ID,
  handle: "tester",
  drink: "Lager",
  priceGbp: 4.5,
  passedDownNote: "",
  era: "",
  provenance: "contributor",
  status: "visible",
  visibility: "public",
  pintPhotoUrl: null,
  venuePhotoUrl: null,
  venueName: "Arnos Arms",
  venueMapUrl: `/map?sel=${ARNOS_ARMS_ID}`,
};

for (const { viewport, fontPx } of [
  { viewport: { width: 280, height: 653 }, fontPx: 32 },
  { viewport: { width: 320, height: 568 }, fontPx: 32 },
  { viewport: { width: 375, height: 667 }, fontPx: 24 },
  { viewport: { width: 390, height: 844 }, fontPx: 32 },
] as const) {
  for (const coral of ["Log what you paid", "Make it Stop 1"] as const) {
    test(`${fontPx}px text @${viewport.width}x${viewport.height}, ${coral}: the price footer does not overlap itself`, async ({
      page,
      context,
    }) => {
      if (coral === "Make it Stop 1") {
        const drop = { ...FRESH_DROP, createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() };
        await page.route("**/api/pint-drops**", (route) => {
          const venueId = new URL(route.request().url()).searchParams.get("venueId");
          const drops = venueId && venueId !== ARNOS_ARMS_ID ? [] : [drop];
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drops }) });
        });
      }
      await page.setViewportSize(viewport);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontPx } });
      await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
      const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
      const card = portal.locator(".venueActionCard");
      await expect(card.locator(".mobileVenuePeekSummary .priceBadge")).toBeVisible();
      await expect(card.getByRole("button", { name: `${coral}${coral === "Make it Stop 1" ? ":" : " at"} Arnos Arms`, exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "More actions for Arnos Arms" })).toBeVisible();

      await expect
        .poll(() =>
          card.evaluate((root) => {
            type Box = { left: number; top: number; right: number; bottom: number };
            const textBoxes = (element: Element): Box[] => {
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              const boxes: Box[] = [];
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                boxes.push(...range.getClientRects());
              }
              return boxes;
            };
            const meets = (a: Box, b: Box) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
            const row = root.querySelector(".mobileVenuePeekSummary")!;
            const rowBox = row.getBoundingClientRect();
            const priceCell = row.firstElementChild!;
            const cellBox = priceCell.getBoundingClientRect();
            const price = [
              priceCell.querySelector(".priceBadge")!.getBoundingClientRect(),
              ...[...priceCell.querySelectorAll("small")].flatMap(textBoxes),
            ];
            const walk = textBoxes(row.querySelector(":scope > span:has(.mobileVenuePeekNearMe)")!);
            const door = row.querySelector(":scope > button")!.getBoundingClientRect();
            const more = root.querySelector(".venueActionMoreToggle")!.getBoundingClientRect();
            const overlaps: string[] = [];
            for (const box of price) {
              if (box.left < cellBox.left - 0.5 || box.right > cellBox.right + 0.5) overlaps.push("price leaves its column");
              if (walk.some((words) => meets(box, words))) overlaps.push("price meets the walk");
              if (meets(box, door)) overlaps.push("price meets the coral");
              if (meets(box, more)) overlaps.push("price meets More");
            }
            for (const cell of row.children) {
              const box = cell.getBoundingClientRect();
              if (box.left < rowBox.left - 0.5 || box.right > rowBox.right + 0.5) overlaps.push("a cell leaves the card");
            }
            if (meets(door, more)) overlaps.push("the coral meets More");
            const small = [
              ["the coral", door],
              ["More", more],
            ]
              .filter(([, box]) => (box as DOMRect).width < 44 || (box as DOMRect).height < 44)
              .map(([name]) => `${name} under 44px`);
            return [...new Set([...overlaps, ...small])];
          }),
        )
        .toEqual([]);
    });
  }
}
