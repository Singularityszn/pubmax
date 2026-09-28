import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  desktopPlannerDrawer,
  desktopVenueDrawer,
  expectSoleDesktopDrawer,
} from "./helpers/mapSurfaceDrawers";
import {
  applyToolbarAreaQuery,
  expectMapToolbarReady,
  mapToolbar,
  selectFirstToolbarVenue,
} from "./helpers/mapToolbar";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function prepareMap(page: Page, viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem(
      "pubmax:map-first-visit-arrival:v1",
      "dismissed",
    );
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: null,
        weather: null,
        tubeLines: [],
        signals: [],
      }),
    }),
  );
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: null,
        sourceObservedAt: null,
        sourceFreshnessKind: "unknown",
      }),
    }),
  );
}

async function openMap(page: Page, path = "/map"): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 640) {
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 60_000 });
    return;
  }
  await expectMapToolbarReady(page);
}

async function selectToolbarVenue(page: Page, query = "The French House"): Promise<void> {
  const search = mapToolbar(page).getByRole("combobox", { name: "Search pubs" });
  const option = page.getByRole("option", { name: new RegExp(query, "i") }).first();
  await expect(async () => {
    await search.click();
    await search.fill(query);
    await expect(option).toBeVisible({ timeout: 2_000 });
    await option.evaluate((node) => (node as HTMLElement).click());
    await expect(page).toHaveURL(/sel=/, { timeout: 2_000 });
  }).toPass({ timeout: 120_000 });
}

function planner(page: Page) {
  return desktopPlannerDrawer(page);
}

function venue(page: Page) {
  return desktopVenueDrawer(page);
}

async function expectSoleDrawer(
  page: Page,
  owner: "planner" | "venue",
  timeout = 90_000,
): Promise<void> {
  await expectSoleDesktopDrawer(page, owner, timeout);
}

test.describe("one Map surface history owner", () => {
  test.use({ serviceWorkers: "block" });
  test.setTimeout(240_000);

  test("venue to planner leaves exactly one desktop drawer", async ({ page }) => {
    await prepareMap(page);
    await openMap(page);
    await applyToolbarAreaQuery(page, "Soho");
    await selectFirstToolbarVenue(page, "Soho");
    await expectSoleDrawer(page, "venue");

    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .evaluate((button) => (button as HTMLElement).click());

    await expectSoleDrawer(page, "planner");
  });

  test("planner to venue leaves exactly one desktop drawer", async ({ page }) => {
    await prepareMap(page);
    await openMap(page);
    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .click();
    await expectSoleDrawer(page, "planner");

    await selectFirstToolbarVenue(page, "Soho");

    await expectSoleDrawer(page, "venue");
  });

  test("clearing a restored query after closing its Venue does not reopen it", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await prepareMap(page);
    // First visit loads the core slim shard only. The French House is unique
    // in that shard, so ?q= restore can select it without waiting for later
    // spatial rings. `sel=` pins that same pub on slow runners where the
    // one-shot restore loses to the readiness ceiling; the regression under
    // test is clearing ?q= after Close, not how the sheet first opened.
    await openMap(page, "/map?q=The+French+House&sel=venue-1kpe609");

    const toolbar = page.locator(".mapToolbar");
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await expect(search).toHaveValue("The French House");
    await expectSoleDrawer(page, "venue", 120_000);

    await expect(async () => {
      await venue(page)
        .getByRole("button", { name: /Close/ })
        .evaluate((button) => (button as HTMLElement).click());
    }).toPass({ timeout: 30_000 });
    // Old restore replayed after Close while ?q= still matched one pub, which
    // put detail-open back on #main. That class makes the toolbar ignore
    // pointer events, so Clear search never received the click. Wait past the
    // restore timeout (0ms) and the typed-search debounce (320ms), then require
    // the overlay gone before clearing.
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/, {
      timeout: 60_000,
    });
    await expect(venue(page)).toHaveAttribute("aria-hidden", "true", {
      timeout: 60_000,
    });

    const searchCell = toolbar.locator(".mapToolbarSearch");
    const clearSearch = searchCell.getByRole("button", { name: "Clear search" });
    await expect(async () => {
      await expect(clearSearch).toBeVisible({ timeout: 2_000 });
      await clearSearch.click({ force: true });
      await expect(search).toHaveValue("", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(venue(page)).toHaveAttribute("aria-hidden", "true", {
      timeout: 60_000,
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const params = new URL(window.location.href).searchParams;
            return { query: params.get("q"), selectedVenueId: params.get("sel") };
          }),
        { timeout: 60_000 },
      )
      .toEqual({ query: null, selectedVenueId: null });
  });

  test("loaded crawl browser Back restores populated planner", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(DESKTOP);
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem(
        "pubmax:map-first-visit-arrival:v1",
        "dismissed",
      );
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    await page.route("**/api/whats-on**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          asOf: null,
          sourceObservedAt: null,
          sourceFreshnessKind: "unknown",
        }),
      }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page, "/map?history-loaded-crawl=1");

    const onboarding = page.getByRole("dialog", { name: "Start with a story" });
    await expect(onboarding).toBeVisible({ timeout: 20_000 });
    await onboarding
      .getByRole("button", {
        name: "Load the Victorian Soho crawl, 5 stops",
      })
      .click();

    await expectSoleDrawer(page, "venue");
    await page.goBack();

    await expect(async () => {
      await expectSoleDrawer(page, "planner");
      await expect(planner(page).locator(".routeList > li")).toHaveCount(5, {
        timeout: 2_000,
      });
    }).toPass({ timeout: 60_000 });
  });

  test("immediate Back after venue to planner transition keeps correct surface with real predecessor", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await prepareMap(page);
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await openMap(page, "/map?history-race=1");
    await selectToolbarVenue(page);
    await expectSoleDrawer(page, "venue");
    await expect(page).toHaveURL(/\/map\?.*sel=/);

    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .evaluate((button) => {
        (button as HTMLElement).click();
        window.history.back();
      });

    await expectSoleDrawer(page, "venue");
    await expect(page).toHaveURL(/\/map\?.*sel=/);
  });

  test("Escape restores populated planner from venue", async ({ page }) => {
    await prepareMap(page);
    await openMap(page);
    const toolbar = page.locator(".mapToolbar");
    await applyToolbarAreaQuery(page, "Soho");
    await toolbar.getByRole("button", { name: "Plan an outing" }).click();
    const heldStops = planner(page).locator(".routeList > li");
    await expect(async () => {
      await expectSoleDrawer(page, "planner", 5_000);
      await expect(heldStops.first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
    await expect(async () => {
      await heldStops.first().getByRole("button").evaluate((button) => {
        (button as HTMLElement).click();
      });
      await expectSoleDrawer(page, "venue", 5_000);
    }).toPass({ timeout: 90_000 });

    await page.keyboard.press("Escape");

    await expectSoleDrawer(page, "planner");
    await expect(planner(page).locator("#railSearchInput")).toHaveValue("Soho");
  });

  test("phone fling-dismiss leaves venue sheet for Map", async ({ page }) => {
    await prepareMap(page, PHONE);
    await openMap(page, "/map?sel=venue-xjf3n0");

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(portal).toBeVisible({ timeout: 20_000 });
    const sheet = portal.locator(".mobileSharedSheet");
    const dragTarget = portal.locator(".mobileSharedSheetHeader");
    const [headerBox, sheetBox] = await Promise.all([
      dragTarget.boundingBox(),
      sheet.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    if (!headerBox || !sheetBox) throw new Error("phone sheet has no rendered box");
    const x = headerBox.x + 18;
    const y = headerBox.y + headerBox.height - 10;
    const dismissDistance = sheetBox.height - PHONE.height * 0.11 + 24;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x,
      Math.min(PHONE.height - 8, y + dismissDistance),
      { steps: 2 },
    );
    await expect(sheet).toHaveAttribute("data-sheet-motion", "dragging");
    await page.mouse.up();

    await expect(portal).toHaveCount(0, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/map(?:\?.*)?$/);
  });

  test("captures light and dark proof at required viewports", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(180_000);
    for (const theme of ["light", "dark"] as const) {
      await prepareMap(page, PHONE);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await openMap(page, `/map?sel=venue-xjf3n0&history-proof=${theme}-390`);
      await expect(
        page
          .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
          .getByRole("heading", { name: "Arnos Arms" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileSharedSheet'),
      ).toHaveAttribute("data-sheet-motion", "idle", { timeout: 30_000 });
      await page.screenshot({
        path: testInfo.outputPath(`history-owner-390-${theme}-firefox.png`),
        animations: "disabled",
      });

      await page.setViewportSize(DESKTOP);
      await openMap(page, `/map?history-proof=${theme}-1440`);
      await page
        .locator(".mapToolbar")
        .getByRole("button", { name: "Plan an outing" })
        .click();
      await expectSoleDrawer(page, "planner");
      await expect(
        planner(page).getByText("Victorian Soho", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await page.screenshot({
        path: testInfo.outputPath(`history-owner-1440-${theme}-firefox.png`),
        animations: "disabled",
      });
    }
  });
});
