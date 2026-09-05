import { expect, test, type Locator, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";

/**
 * THE VENUE COMMAND BAR NEVER COVERS A PRICE ROW, AT THE TABLET WIDTHS (#1516).
 *
 * At 641-768 the venue drawer is the legacy inline bottom sheet: viewport-tall,
 * translated down by its snap fraction, so 45dvh of its scrollport hangs under
 * the screen at `half`. Its sticky command bar used to restate that translate
 * as a dvh inset, and the map shell (`main.appShell`) was `overflow: hidden`,
 * which is still a scroll container. One `scrollIntoView` on a price row
 * scrolled the shell 403px up, the drawer's box moved with it, the inset did
 * not, and the bar sat mid-viewport over "Published price" (measured at
 * 768x1024 on origin/main 2d00af6d2: bar 490..555, main.scrollTop 403).
 *
 * The fix is in the primitive: the shell is `overflow: clip`, SpringDrawer
 * publishes the translate it applies as `--drawer-sheet-offset`, and both the
 * drawer's end spacer and the bar's inset derive from it. This spec drives the
 * sheet through every way a reader or a script scrolls it and holds, after
 * each step: the shell did not scroll, the bar is pinned to the bottom edge
 * (never a band mid-viewport), and the row the reader brought into view is
 * not under it. At the end of the scroll every price row sits above the bar,
 * so nothing is parked in the part of the scrollport the translate used to
 * hide. 820 is the side-drawer band above the sheet cut, held to the same bar.
 */

const LISTED_ONLY = "venue-133bdp8";
const PRICE_ROWS = ".contributorPrice, [data-price-door], .venueDrinkPriceRow";
const DRAWER = ".mapDrawer.right.open";
const BAR = `${DRAWER} .venueSheetStickyBar`;

// The bar rests in flow a gutter above the edge at the very end of the scroll
// (venueSheet.css gives the inspector an 8px gutter under it).
const BOTTOM_EDGE_TOLERANCE_PX = 24;

type BarReading = {
  shellScrollTop: number;
  viewportHeight: number;
  bar: { top: number; bottom: number } | null;
  drawerScrollTop: number;
  rowsBelowViewport: number;
  rowsUnderBar: string[];
};

async function readBar(page: Page): Promise<BarReading> {
  return page.evaluate(
    ({ drawerSel, barSel, rowsSel }) => {
      const shell = document.querySelector<HTMLElement>("main.appShell");
      const drawer = document.querySelector<HTMLElement>(drawerSel);
      const bar = document.querySelector<HTMLElement>(barSel);
      const barBox = bar?.getBoundingClientRect() ?? null;
      const rows = Array.from(document.querySelectorAll<HTMLElement>(rowsSel)).filter(
        (row) => row.getBoundingClientRect().height > 0,
      );
      return {
        shellScrollTop: shell?.scrollTop ?? -1,
        viewportHeight: window.innerHeight,
        bar: barBox ? { top: Math.round(barBox.top), bottom: Math.round(barBox.bottom) } : null,
        drawerScrollTop: drawer?.scrollTop ?? -1,
        rowsBelowViewport: rows.filter(
          (row) => row.getBoundingClientRect().top >= window.innerHeight,
        ).length,
        rowsUnderBar: barBox
          ? rows
              .filter((row) => {
                const box = row.getBoundingClientRect();
                return box.bottom > barBox.top + 1 && box.top < barBox.bottom - 1;
              })
              .map((row) => `${row.className} "${row.textContent?.trim().slice(0, 40)}"`)
          : [],
      };
    },
    { drawerSel: DRAWER, barSel: BAR, rowsSel: PRICE_ROWS },
  );
}

function holdBar(reading: BarReading, step: string): void {
  expect(reading.bar, `${step}: the command bar is on the page`).not.toBeNull();
  const bar = reading.bar!;
  expect(reading.shellScrollTop, `${step}: the map shell never scrolls`).toBe(0);
  expect(bar.bottom, `${step}: the bar is inside the viewport`).toBeLessThanOrEqual(
    reading.viewportHeight + 1,
  );
  expect(
    reading.viewportHeight - bar.bottom,
    `${step}: the bar hugs the bottom edge (bar ${bar.top}..${bar.bottom} in ${reading.viewportHeight})`,
  ).toBeLessThanOrEqual(BOTTOM_EDGE_TOLERANCE_PX);
}

/** The row a reader (or a script) brought into view is not under the bar. */
async function holdRowClear(page: Page, row: Locator, step: string): Promise<void> {
  const [rowBox, barBox] = await Promise.all([
    row.boundingBox(),
    page.locator(BAR).boundingBox(),
  ]);
  expect(rowBox, `${step}: the row has a box`).not.toBeNull();
  expect(barBox, `${step}: the bar has a box`).not.toBeNull();
  const rowBottom = rowBox!.y + rowBox!.height;
  expect(
    rowBottom <= barBox!.y + 1 || rowBox!.y >= barBox!.y + barBox!.height - 1,
    `${step}: the row (${Math.round(rowBox!.y)}..${Math.round(rowBottom)}) is not under the bar (${Math.round(barBox!.y)}..${Math.round(barBox!.y + barBox!.height)})`,
  ).toBe(true);
}

async function openListedVenue(page: Page): Promise<void> {
  const stub = await installAuthDoubles(page);
  await page.route("**/api/pint-drops**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: [] }),
    }),
  );
  await page.goto("/");
  await stub.signedInAs("A");
  await page.goto(`/map?sel=${LISTED_ONLY}`);
  await expect(page.locator(`${DRAWER} .venueInspector`)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(`${DRAWER} .contributorPrice`).first()).toBeAttached({
    timeout: 60_000,
  });
  await expect(page.locator(BAR)).toBeVisible({ timeout: 30_000 });
  // The spring publishes its offset a frame after mount; let it settle.
  await page.waitForTimeout(800);
}

test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

test.setTimeout(150_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

for (const viewport of [
  { width: 768, height: 1024, band: "the 641-768 bottom sheet" },
  { width: 820, height: 1180, band: "the side drawer just above the sheet cut" },
]) {
  test.describe(`${viewport.width}x${viewport.height}: ${viewport.band}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the command bar stays on the bottom edge and off the price row in view while the sheet scrolls", async ({
      page,
    }) => {
      await openListedVenue(page);
      holdBar(await readBar(page), "at rest");

      // The trigger from #1516: a script centres the price row. This scrolls
      // every scrollable ancestor it can, so the shell has to be unscrollable.
      const rows = page.locator(`${DRAWER} .contributorPrice`);
      const rowCount = await rows.count();
      expect(rowCount, "a listed pub carries a price row").toBeGreaterThan(0);
      for (let index = 0; index < rowCount; index += 1) {
        const row = rows.nth(index);
        await row.evaluate((node) => node.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(250);
        const step = `price row ${index + 1} centred`;
        holdBar(await readBar(page), step);
        await holdRowClear(page, row, step);
      }
      const door = page.locator(`${DRAWER} [data-price-door]`);
      if ((await door.count()) > 0) {
        await door.first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const step = "price door scrolled into view";
        holdBar(await readBar(page), step);
        await holdRowClear(page, door.first(), step);
      }

      // A reader's wheel, in steps, from the top to the end of the sheet.
      const drawer = page.locator(DRAWER);
      await drawer.evaluate((node) => {
        node.scrollTop = 0;
      });
      const box = await drawer.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, Math.max(1, Math.min(box!.y + 120, viewport.height - 60)));
      let previous = -1;
      for (let step = 0; step < 40; step += 1) {
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(120);
        const reading = await readBar(page);
        holdBar(reading, `wheel step ${step + 1}`);
        if (reading.drawerScrollTop === previous) break;
        previous = reading.drawerScrollTop;
      }

      // At the end of the scroll every price row has been reachable and sits
      // above the bar: none is parked below the viewport in the part of the
      // scrollport the translate used to hide, and none is under the bar.
      await drawer.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await page.waitForTimeout(250);
      const end = await readBar(page);
      holdBar(end, "scrolled to the end");
      expect(end.rowsBelowViewport, "every price row can be scrolled into view").toBe(0);
      expect(end.rowsUnderBar, "at the end no price row is under the bar").toEqual([]);
    });
  });
}
