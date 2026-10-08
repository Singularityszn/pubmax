import { expect, test, type Locator, type Page } from "@playwright/test";

import { paintedAmbientSurfaces } from "./helpers/ambientMapSurfaces";
import { expectLayoutSettled } from "./helpers/layoutSettled";

const DESKTOP = { width: 1440, height: 900 };
const DESKTOP_WIDTHS = [1024, 1280, 1440, 1600] as const;
const FIRST_RUN_BANNER_WIDTHS = [641, 800, 1023, ...DESKTOP_WIDTHS] as const;
const EXPECTED_PLANNER_RAIL_WIDTHS: Record<
  (typeof DESKTOP_WIDTHS)[number],
  number
> = {
  1024: 376,
  1280: 376,
  1440: 376,
  1600: 376,
};
const EDGE_GUTTER = 16;
const SUBPIXEL_TOLERANCE = 0.5;
const CAPTURE_DRAWER_EXCHANGE =
  process.env.PUBMAX_CAPTURE_DESKTOP_EXCHANGE === "1";

test.use({ storageState: { cookies: [], origins: [] } });

async function renderedBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) throw new Error(`${label} has no rendered box`);
  return box;
}

async function prepareDesktopMap(page: Page, width = DESKTOP.width) {
  await page.setViewportSize({ width, height: DESKTOP.height });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
}

async function stubCityStatus(page: Page) {
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
}

async function toolbarPubOption(page: Page, query: string, name: RegExp) {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  await search.fill(query);
  const option = page.getByRole("option", { name }).first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  return option;
}

async function selectToolbarPub(page: Page, query: string, name: RegExp) {
  const option = await toolbarPubOption(page, query, name);
  await option.click();
}

async function indexedToolbarPubOption(
  page: Page,
  query: string,
  index: number,
) {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  // Exact, because a role name matches by substring: "Venues across city
  // maps" leads the list, and its first "Soho" row is a Birmingham tavern
  // that opens another city's map.
  const option = page
    .getByRole("group", { name: "Venues", exact: true })
    .getByRole("option")
    .nth(index);
  await expect(async () => {
    await search.click();
    await search.fill(query);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  return option;
}

async function captureDrawerExchange(page: Page, name: string) {
  if (!CAPTURE_DRAWER_EXCHANGE) return;
  await page.screenshot({
    path: `docs/evidence/desktop-rail-and-banners/drawer-exchange-${name}-firefox-1440.png`,
    animations: "allow",
  });
}

async function firstDrawerOwnershipCommit(trigger: Locator) {
  return trigger.evaluate((button) => {
    const planner = document.querySelector<HTMLElement>(
      ".mapDrawer.left.springDrawer",
    );
    const venue = document.querySelector<HTMLElement>(
      ".mapDrawer.right.springDrawer",
    );
    if (!planner || !venue) throw new Error("desktop drawers are missing");

    return new Promise<{
      plannerHidden: string | null;
      venueHidden: string | null;
    }>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve({
          plannerHidden: planner.getAttribute("aria-hidden"),
          venueHidden: venue.getAttribute("aria-hidden"),
        });
      });
      for (const drawer of [planner, venue]) {
        observer.observe(drawer, {
          attributes: true,
          attributeFilter: ["aria-hidden"],
        });
      }
      (button as HTMLElement).click();
    });
  });
}

async function installFirstPlannerFrameProbe(
  page: Page,
  expectedSearch: string,
) {
  await page.addInitScript((search) => {
    if (window.location.search !== search) return;

    const measure = () => {
      const shell = document.querySelector(".appShell.planning-open");
      const toolbar = shell?.querySelector<HTMLElement>(".mapToolbar");
      const rail = shell?.querySelector<HTMLElement>(".mapDrawer.left.open");
      if (!toolbar || !rail || !toolbar.style.transform) {
        window.requestAnimationFrame(measure);
        return;
      }

      const toolbarBox = toolbar.getBoundingClientRect();
      const railBox = rail.getBoundingClientRect();
      Object.assign(window, {
        __pubmaxFirstPlannerFrame: {
          toolbarLeft: toolbarBox.left,
          railRight: railBox.right,
        },
      });
    };

    window.requestAnimationFrame(measure);
  }, expectedSearch);
}

async function firstPlannerFrame(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __pubmaxFirstPlannerFrame?: {
                toolbarLeft: number;
                railRight: number;
              };
            }
          ).__pubmaxFirstPlannerFrame ?? null,
      ),
    )
    .not.toBeNull();
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxFirstPlannerFrame: {
            toolbarLeft: number;
            railRight: number;
          };
        }
      ).__pubmaxFirstPlannerFrame,
  );
}

test("1280px plan deep link clears the planner rail on its first spring-owned frame", async ({
  page,
}) => {
  await prepareDesktopMap(page, 1280);
  await stubCityStatus(page);
  await installFirstPlannerFrameProbe(page, "?plan=1");

  const response = await page.goto("/map?plan=1", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const frame = await firstPlannerFrame(page);
  expect(frame.toolbarLeft).toBeGreaterThanOrEqual(
    frame.railRight + EDGE_GUTTER,
  );
});

test("1280px restored planner clears the rail on its first spring-owned frame", async ({
  page,
}) => {
  await prepareDesktopMap(page, 1280);
  await stubCityStatus(page);
  const setup = await page.goto("/map?plan=1", {
    waitUntil: "domcontentloaded",
  });
  expect(setup?.status()).toBe(200);
  await expect(page.locator(".mapDrawer.left.open")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem(
          "pubmaxx.mobile-map-session.v1",
        );
        return value ? JSON.parse(value).openSheet : null;
      }),
    )
    .toBe("planner");

  await installFirstPlannerFrameProbe(page, "");
  const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const frame = await firstPlannerFrame(page);
  expect(frame.toolbarLeft).toBeGreaterThanOrEqual(
    frame.railRight + EDGE_GUTTER,
  );
});

for (const width of DESKTOP_WIDTHS) {
  test(`${width}px open planner keeps toolbar search and Clear search beyond the rail edge`, async ({
    page,
  }) => {
    // A cold map gives the toolbar and the rail up to 20 s each below.
    test.setTimeout(90_000);
    await prepareDesktopMap(page, width);
    await stubCityStatus(page);

    const response = await page.goto(`/map?desktop-rail-fit=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const toolbar = page.locator(".mapToolbar");
    await expect(toolbar).toBeVisible({ timeout: 20_000 });
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await search.fill("Shoreditch");
    await toolbar.getByRole("button", { name: "Plan an outing" }).click();

    const rail = page.locator(".mapDrawer.left.open");
    const searchCell = toolbar.locator(".mapToolbarSearch");
    // The field's own clear control. The toolbar's no-match status carries a
    // second "Clear search" while the venue shards for the query stream in.
    const clearSearch = searchCell.getByRole("button", { name: "Clear search" });
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await expect(clearSearch).toBeVisible();
    await expect
      .poll(async () => Math.abs((await rail.boundingBox())?.x ?? -1000), {
        message: "planner rail has finished its slide to the viewport edge",
      })
      .toBeLessThanOrEqual(1);
    // The rail's spring and the toolbar's shift are measured at rest.
    await expectLayoutSettled(rail);
    await expectLayoutSettled(toolbar);

    const [railBox, toolbarBox, searchBox, clearBox] = await Promise.all([
      renderedBox(rail, "planner rail"),
      renderedBox(toolbar, "desktop toolbar"),
      renderedBox(searchCell, "toolbar search cell"),
      renderedBox(clearSearch, "Clear search"),
    ]);
    const railRight = railBox.x + railBox.width;
    const publishedRailWidth = await rail.evaluate((node) =>
      Number.parseFloat(
        getComputedStyle(node.closest(".appShell")!).getPropertyValue(
          "--desktop-planner-rail-width",
        ),
      ),
    );

    expect(
      railBox.width,
      `${width}px planner rail matches measured Firefox contract`,
    ).toBeCloseTo(EXPECTED_PLANNER_RAIL_WIDTHS[width], 2);
    expect(
      publishedRailWidth,
      `${width}px planner rail publishes measured Firefox contract`,
    ).toBe(EXPECTED_PLANNER_RAIL_WIDTHS[width]);

    expect(
      toolbarBox.x,
      "desktop toolbar clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      searchBox.x,
      "search cell clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      clearBox.x,
      "Clear search clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      toolbarBox.x + toolbarBox.width,
      "desktop toolbar remains inside viewport",
    ).toBeLessThanOrEqual(width - EDGE_GUTTER);
  });
}

test("1440px planner hands ownership to venue and Back restores composed state", async ({
  page,
}) => {
  // The venue list may take up to 90 s to finish counting on a slow runner,
  // so the budget leaves room for that wait plus every step after it.
  test.setTimeout(210_000);
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?list=1&desktop-drawer-exchange=1440", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  const retargetVenue = page
    .locator(".mapVenueListItem")
    .filter({ hasNotText: "Three Sheets Soho" })
    .first();
  // The list says "Counting them up…" until its rows have loaded, and a slow
  // runner can spend longer than the row wait below on that read alone.
  await expect(page.locator(".mapVenueListCount")).toBeVisible();
  await expect(page.locator(".mapVenueListCount")).not.toHaveText(
    "Counting them up…",
    { timeout: 90_000 },
  );
  await expect(retargetVenue).toHaveCount(1, { timeout: 20_000 });
  await toolbar
    .getByRole("button", { name: "Plan an outing" })
    .evaluate((button) => (button as HTMLElement).click());

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  const mapStage = page.locator(".mapStage");
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await expect(planner.locator("#railSearchInput")).toBeVisible();
  await expect(planner.locator(".controlRail")).toHaveCount(1);
  await expect(planner.getByRole("group", { name: "Crawl mode" })).toBeVisible();
  await expect
    .poll(async () => (await renderedBox(planner, "planner rail")).x)
    .toBeCloseTo(0, 0);

  const mapBefore = await renderedBox(mapStage, "map stage before exchange");

  const firstVenueOption = await indexedToolbarPubOption(page, "Soho", 0);
  const toolbarBeforeOwnershipChange = await renderedBox(
    toolbar,
    "toolbar before ownership change",
  );
  await captureDrawerExchange(page, "planner-open");
  // The venue is chosen with a REAL pointer tap, so Playwright checks that a
  // reader can hit the option. The toolbar is read in the page on either side
  // of React's handler: a capture listener on window before the tap, a bubble
  // listener after it.
  await page.evaluate(() => {
    const toolbarX = () => {
      const toolbar = document.querySelector<HTMLElement>(".mapToolbar");
      if (!toolbar) throw new Error("desktop toolbar is missing");
      return toolbar.getBoundingClientRect().x;
    };
    const holder = window as unknown as {
      __ownershipChange?: Promise<{ before: number; after: number }>;
    };
    holder.__ownershipChange = new Promise((resolve) => {
      let before = 0;
      window.addEventListener("click", () => (before = toolbarX()), {
        capture: true,
        once: true,
      });
      window.addEventListener(
        "click",
        () => resolve({ before, after: toolbarX() }),
        { once: true },
      );
    });
  });
  await firstVenueOption.click();
  const ownershipChange = await page.evaluate(() => {
    const holder = window as unknown as {
      __ownershipChange?: Promise<{ before: number; after: number }>;
    };
    if (!holder.__ownershipChange) throw new Error("tap probe was not armed");
    return holder.__ownershipChange;
  });
  expect(
    Math.abs(ownershipChange.after - ownershipChange.before),
  ).toBeLessThan(16);

  // Fully off-screen is also x < -1, so wait for a frame that is still
  // crossing rather than sampling after the spring has finished. Under load the
  // spring can finish before the first sample, so mid-exchange geometry is
  // asserted only when a crossing frame is caught.
  //
  // A crossing frame is one where the planner has covered less than 80% of its
  // exit. Both drawers share one spring response (SpringDrawer), but the venue
  // enters underdamped (SHEET_ENTRANCE_OVERSHOOT_DAMPING) and reaches its rest
  // edge when the critically damped planner has covered about 88%, then
  // overshoots left of it by about 18px. A tail frame of the planner's exit
  // therefore finds the venue at or left of 800 in a correct exchange.
  let caughtMidExchange = false;
  let plannerMid: Awaited<ReturnType<typeof renderedBox>> | null = null;
  let venueMid: Awaited<ReturnType<typeof renderedBox>> | null = null;
  let toolbarMid: Awaited<ReturnType<typeof renderedBox>> | null = null;
  try {
    await expect
      .poll(
        async () => {
          const [plannerBox, venueBox, toolbarBox] = await Promise.all([
            renderedBox(planner, "moving planner"),
            renderedBox(venue, "moving venue"),
            renderedBox(toolbar, "moving toolbar"),
          ]);
          const crossing =
            plannerBox.x < -1 && plannerBox.x > -plannerBox.width * 0.8;
          if (crossing) {
            plannerMid = plannerBox;
            venueMid = venueBox;
            toolbarMid = toolbarBox;
          }
          return crossing;
        },
        {
          intervals: [8, 8, 8, 8, 16, 16, 32],
          timeout: 8_000,
        },
      )
      .toBe(true);
    caughtMidExchange = true;
  } catch {
    caughtMidExchange = false;
  }
  if (caughtMidExchange && plannerMid && venueMid && toolbarMid) {
    expect(plannerMid.x).toBeLessThan(0);
    expect(plannerMid.x).toBeGreaterThan(-plannerMid.width * 0.8);
    expect(venueMid.x).toBeGreaterThan(800);
    expect(venueMid.x).toBeLessThan(DESKTOP.width);
    await captureDrawerExchange(page, "mid-exchange");
  }

  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(venue).toHaveAttribute("aria-hidden", "false");

  const venueBeforeRetarget = await renderedBox(
    venue,
    "venue before mid-spring retarget",
  );
  const retargetVenueName = await retargetVenue.evaluate((button) => {
    const name = button
      .querySelector<HTMLElement>(".mapVenueListItemName")
      ?.innerText.trim();
    if (!name) throw new Error("retarget venue name is missing");
    (button as HTMLElement).click();
    return name;
  });
  await page.waitForTimeout(16);
  const venueAfterRetarget = await renderedBox(
    venue,
    "venue after mid-spring retarget",
  );
  expect(venueAfterRetarget.x).toBeLessThanOrEqual(
    venueBeforeRetarget.x + 10,
  );

  await expect
    .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
      message: "one desktop drawer owns the surface after exchange",
    })
    .toBe(1);
  await expect(
    venue.getByRole("heading", { name: retargetVenueName }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // The open state is measured at rest, once the venue spring and the
  // toolbar's shift have both settled.
  await expectLayoutSettled(venue);
  await expectLayoutSettled(toolbar);
  const [mapAfter, venueOpen, toolbarOpen] = await Promise.all([
    renderedBox(mapStage, "map stage after exchange"),
    renderedBox(venue, "open venue drawer"),
    renderedBox(toolbar, "toolbar beside venue"),
  ]);
  // At rest the venue drawer docks to the right edge at the width it publishes
  // (venueSheet.css: --desktop-venue-drawer-width: min(640px, 46vw), so 800px
  // at 1440). The custom property is an unresolved min(), so its resolved
  // computed width is read instead of restating 640 here.
  const venueRestX = await venue.evaluate(
    (node) => window.innerWidth - Number.parseFloat(getComputedStyle(node).width),
  );
  expect(venueOpen.x).toBeCloseTo(venueRestX, 1);
  expect(toolbarOpen.x + toolbarOpen.width).toBeLessThanOrEqual(
    venueOpen.x - EDGE_GUTTER + SUBPIXEL_TOLERANCE,
  );
  if (toolbarMid) {
    expect(toolbarMid.x).toBeLessThan(toolbarBeforeOwnershipChange.x);
    expect(toolbarMid.x).toBeGreaterThan(toolbarOpen.x);
  }
  expect(mapAfter).toEqual(mapBefore);
  await captureDrawerExchange(page, "venue-open");
  await expect(
    venue.getByRole("button", { name: "Back to Plan an outing" }),
  ).toBeVisible();
  await expect(
    venue.getByRole("button", { name: "Close and return to the London map" }),
  ).toBeVisible();

  await venue
    .getByRole("button", { name: "Back to Plan an outing" })
    .click();
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await expect(planner.locator("#railSearchInput")).toHaveValue(
    "Soho",
  );
  await expect
    .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
      message: "Back restores planner as sole desktop drawer",
    })
    .toBe(1);
  await expect
    .poll(async () => (await renderedBox(planner, "restored planner")).x)
    .toBeCloseTo(0, 0);
  await captureDrawerExchange(page, "back-restored-planner");
});

test("1440px Plan an outing takes ownership from an open venue", async ({
  page,
}) => {
  // A cold map gives the toolbar and the pub option up to 20 s each below.
  test.setTimeout(90_000);
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?desktop-drawer-owner=planner", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  await selectToolbarPub(page, "The French House", /The French House/);
  await expect(venue).toHaveAttribute("aria-hidden", "false");

  // This branch owns only the captain's synchronous drawer decision. Selection
  // and surface history remain separate owners, and the later traversal race is
  // deliberately handed off in data/nomistakes-land-two-fixes. Capture the
  // first React commit so this regression cannot accidentally wait for, or
  // claim to reconcile, that deferred history work.
  const ownership = await firstDrawerOwnershipCommit(
    toolbar.getByRole("button", { name: "Plan an outing" }),
  );
  expect(ownership).toEqual({
    plannerHidden: "false",
    venueHidden: "true",
  });
});

test("1440px loaded route opens its first venue without a deferred planner handoff", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    // On a clean first map the First visit card owns the ask and the curated
    // story overlay stands down for it (lib/mapFirstVisitArrival.ts). This spec
    // loads a crawl from the story overlay, so the card is answered.
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await stubCityStatus(page);
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        servedAt: new Date().toISOString(),
        rows: [],
        asOf: null,
        sourceObservedAt: null,
        sourceFreshnessKind: "unknown",
      }),
    }),
  );

  const response = await page.goto("/map?desktop-loaded-route=1440", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const onboarding = page.getByRole("dialog", { name: "Start with a story" });
  await expect(onboarding).toBeVisible({ timeout: 20_000 });

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await page.evaluate(() => {
    const plannerDrawer = document.querySelector(
      ".mapDrawer.left.springDrawer",
    );
    if (!plannerDrawer) throw new Error("planner drawer missing");
    const transitions: string[] = [];
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== "attributes") continue;
        transitions.push(record.oldValue ?? "missing");
      }
    }).observe(plannerDrawer, {
      attributes: true,
      attributeFilter: ["aria-hidden"],
      attributeOldValue: true,
    });
    Object.assign(window, {
      __pubmaxPlannerAriaHiddenTransitions: transitions,
    });
  });

  await onboarding
    .getByRole("button", {
      name: "Load the Victorian Soho crawl, 5 stops",
    })
    .click();

  await expect(venue).toHaveAttribute("aria-hidden", "false");
  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1);
  const plannerTransitions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPlannerAriaHiddenTransitions?: string[];
        }
      ).__pubmaxPlannerAriaHiddenTransitions ?? [],
  );
  expect(plannerTransitions).not.toContain("true");
});

test("1440px reduced motion swaps desktop drawer ownership immediately", async ({
  page,
}) => {
  // A cold map gives the toolbar and the pub option up to 20 s each below.
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?desktop-drawer-exchange=reduced", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  await toolbar.getByRole("button", { name: "Plan an outing" }).click();

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await selectToolbarPub(page, "The French House", /The French House/);

  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(venue).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1);

  const [plannerBox, venueBox] = await Promise.all([
    renderedBox(planner, "reduced-motion planner"),
    renderedBox(venue, "reduced-motion venue"),
  ]);
  expect(plannerBox.x).toBeCloseTo(-EXPECTED_PLANNER_RAIL_WIDTHS[1440], 0);
  expect(venueBox.x).toBeCloseTo(800, 0);
});

// ONE AMBIENT SURFACE HOLDS THE MAP. UI review 17 Sep 2026, finding 5: once the
// arrival strip was dismissed, the location prompt, the closure and area-news
// rail and the concierge ask all painted at 1440. Nothing overlapped, so nothing
// was unreadable; the count was the defect. The wait rule 1b enforces against
// the strip is enforced among the banners too now, in the strip's own order
// (components/map/mapBannerStaging.css), so the location ask owns the surface
// alone and the status rail arrives the moment that ask is answered. This test
// used to measure the two-lane arrangement they needed to coexist.
for (const width of FIRST_RUN_BANNER_WIDTHS) {
  test(`${width}px first-run location prompt owns the map alone and the status rail waits`, async ({
    page,
  }) => {
    // A cold map gives the location prompt and the status rail up to 20 s each below.
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: DESKTOP.height });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "pubmaxx:analytics-consent:v1",
        "denied",
      );
      // The first-visit arrival card owns the location ask while it is up
      // and the suggest banner stands down behind it (mapBannerStaging.css);
      // this spec measures the banners' own berths, so the card is answered.
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    });
    await page.route("**/api/citymcp/status**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asOf: "2026-08-03T08:00:00.000Z",
          weather: null,
          tubeLines: [{ line: "Central", status: "Severe delays" }],
          signals: [],
        }),
      }),
    );

    const response = await page.goto(`/map?desktop-first-run-banners=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const locationPrompt = page.locator(".citySuggestBanner");
    const status = page.locator(".cityStatusStack");
    await expect(locationPrompt).toBeVisible({ timeout: 20_000 });

    // The status rail is ELIGIBLE here: the stub answers a Central line with
    // severe delays, so it mounts and the cascade is what keeps it off screen.
    // Presence with no paint is the whole assertion, because a rail that never
    // mounted would prove nothing about the order.
    await expect(status).toHaveCount(1, { timeout: 20_000 });
    await expect(status).toBeHidden();

    const locationBox = await renderedBox(
      locationPrompt,
      "first-run location prompt",
    );
    expect(
      Math.abs(locationBox.x + locationBox.width / 2 - width / 2),
      "location prompt owns map centre",
    ).toBeLessThanOrEqual(1);
    expect(
      locationBox.x,
      "location prompt stays inside the viewport",
    ).toBeGreaterThanOrEqual(EDGE_GUTTER - SUBPIXEL_TOLERANCE);
    expect(
      locationBox.x + locationBox.width,
      "location prompt stays inside the viewport",
    ).toBeLessThanOrEqual(width - EDGE_GUTTER + SUBPIXEL_TOLERANCE);

    // ONE ambient surface, counted rather than argued about.
    const painted = await paintedAmbientSurfaces(page);
    expect(painted).toEqual([".citySuggestBanner"]);
  });
}
