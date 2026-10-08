import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  desktopPlannerDrawer,
  desktopVenueDrawer,
  expectSoleDesktopDrawer,
} from "./helpers/mapSurfaceDrawers";
import {
  expectMapToolbarReady,
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
  test.setTimeout(120_000);

  test("venue to planner leaves exactly one desktop drawer", async ({ page }) => {
    test.setTimeout(180_000);
    await prepareMap(page);
    // Golden Lion (Soho) is in the core slim shard; deep-link the drawer under
    // test so toolbar timing does not gate the planner transition under test.
    await openMap(page, "/map?q=Soho&sel=venue-15i2wst");
    await expectSoleDrawer(page, "venue");

    // The desktop venue drawer is modal (map-accessibility.spec.ts pins
    // aria-modal and its focus trap), so the map stage and its toolbar are
    // inert while it is open. A drinker closes the venue, then plans; the
    // deep-linked `sel=` must not reopen it over the planner.
    // The restored drawer is already hydrated. Close it once, then wait for
    // its result. An outer retry deadline can reject a successful slow click.
    const closeVenue = venue(page).getByRole("button", { name: /Close/ });
    await closeVenue.click();
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/, { timeout: 60_000 });

    // Plan an outing is a toggle that relabels itself "Close plan" once the
    // planner opens, so a retry may tap it only while the planner is still
    // closed. The sole-drawer wait below owns the drawers settling, which a
    // loaded runner can stretch past one try.
    const planOuting = page.locator(".mapToolbar").getByRole("button", { name: "Plan an outing" });
    await expect(async () => {
      if ((await planner(page).getAttribute("aria-hidden")) !== "false") {
        await planOuting.click();
      }
      await expect(planner(page)).toHaveAttribute("aria-hidden", "false", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
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
    test.setTimeout(120_000);
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

    const closeVenue = venue(page).getByRole("button", { name: /Close/ });
    await expect(async () => {
      await closeVenue.click();
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/, { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
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
    await expect(clearSearch).toBeEnabled();
    await expect(async () => {
      const reachable = await clearSearch.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top === element || element.contains(top);
      });
      expect(reachable).toBe(true);
    }).toPass({ timeout: 30_000 });
    await expect(async () => {
      await clearSearch.click();
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
    await selectFirstToolbarVenue(page, "The French House");
    await expectSoleDrawer(page, "venue");
    await expect(page).toHaveURL(/\/map\?.*sel=/);

    // Click and Back have to share one turn. A Playwright click waits for
    // actionability, so it cannot race the history pop the way this case does.
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
    const stopIds = [
      "venue-1ufn31x",
      "venue-1t8siin",
      "venue-xiesdn",
      "venue-phqazo",
      "venue-15i2wst",
    ];
    await openMap(page, `/map?mode=build&plan=1&q=Soho&pubs=${stopIds.join(",")}`);
    await expectSoleDrawer(page, "planner");
    const heldStops = planner(page).locator(".routeList > li");
    await expect(heldStops).toHaveCount(stopIds.length);
    const stopOpen = heldStops.first().getByRole("button").first();
    await stopOpen.click({ noWaitAfter: true });
    await expectSoleDrawer(page, "venue");

    await page.keyboard.press("Escape");

    await expectSoleDrawer(page, "planner");
    await expect(planner(page).locator("#railSearchInput")).toHaveValue("Soho");
    await expect(heldStops).toHaveCount(stopIds.length);
    await heldStops.first().getByRole("button").first().click({ noWaitAfter: true });
    await expectSoleDrawer(page, "venue");
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
    // Mobile venue sheets expose drag through `sheet-dragging`; data-sheet-motion
    // can lag a frame on slow runners while the class is already live.
    await expect(async () => {
      await expect(sheet).toHaveClass(/sheet-dragging/);
    }).toPass({ timeout: 5_000 });
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
