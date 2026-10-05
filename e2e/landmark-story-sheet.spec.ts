import { expect, test, type Locator, type Page } from "@playwright/test";

// The landmark story, in the frame each width already owns.
//
// Captain's 390 shot, 2026-09-05: the story was a card the canvas pinned over
// the map. Its title sat under the chip row, pins and prices showed through
// its edges, its last "Story pubs nearby" rows disappeared under the planning
// pill and the dock, the hero was a broken-image glyph with the credit bar
// still under it, and every row repeated "straight-line". The story is now the
// phone's shared bottom sheet (the landmark's name in the chrome, the body
// scrolling above the tab bar) and the desktop's left drawer (the planner's
// frame, whose lane the toolbar already leaves).
//
// Everything here is DOM: the sheet, its header, its rows. The story is opened
// by ?landmark=, the shareable URL PubMap seeds from, so no canvas pin is ever
// tapped. Every Wikimedia host is aborted, so the hero is exercised in its
// failed state on purpose: the fallback paints and the credit is gone.
//
// House style: web-first assertions, no waitForTimeout, geometry read with
// getBoundingClientRect and elementFromPoint rather than inferred from CSS.

const PHONE_WIDTHS = [320, 360, 390, 430] as const;
const LANDMARK_URL = "/map?landmark=covent-garden";
const LANDMARK_NAME = "Covent Garden";

async function preparePage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    }),
  );
  await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
  // A hero that cannot load. Every host the Special:FilePath chain can land on.
  for (const host of ["commons", "upload", "thumb"]) {
    await page.route(`https://${host}.wikimedia.org/**`, (route) => route.abort());
  }
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

type Box = { top: number; bottom: number; left: number; right: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  });
}

/**
 * True when the element at the box's centre is the element itself, inside it,
 * or inside `within` when given: the sheet's own chrome (its grab handle sits
 * over the title on purpose) may own the point, nothing outside the frame may.
 */
async function ownsItsCentre(page: Page, selector: string, within?: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el, scope) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit === null) return false;
    if (hit === el || el.contains(hit)) return true;
    const frame = scope ? el.closest(scope) : null;
    return frame !== null && frame.contains(hit);
  }, within ?? null);
}

async function expectStoryBodyHonest(page: Page, scope: string): Promise<void> {
  // The failed hero paints the brand treatment and the credit leaves with it.
  // The image is lazy, so its refused request (and the error it raises) only
  // arrives once the browser has laid the sheet out, which a loaded box does
  // in its own time.
  await expect(page.locator(`${scope} .landmarkStoryHero.landmarkHeroFallback`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(`${scope} .landmarkStory img`)).toHaveCount(0);
  await expect(page.locator(`${scope} .landmarkStory figcaption`)).toHaveCount(0);

  // Distances read like a person, and the caveat is said once in the head.
  const rows = page.locator(`${scope} .landmarkStoryPubs button`);
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  const distances = await rows.locator(".landmarkStoryPubDistance").allInnerTexts();
  expect(distances.length).toBeGreaterThan(0);
  for (const text of distances) {
    expect(text.trim()).toMatch(/^(\d+ m|\d+\.\d km)$/);
  }
  await expect(page.locator(`${scope} .landmarkStoryCaveat`)).toHaveCount(1);
  await expect(page.locator(`${scope} .landmarkStory`)).not.toContainText(/straight-line/i);

  // The two actions are the button system's primary and secondary: one
  // height, one radius, labels centred.
  const primary = page.locator(`${scope} .landmarkStoryActions [data-primary-action]`);
  const secondary = page.locator(`${scope} .landmarkStoryActions button`).nth(1);
  await expect(primary).toHaveText("Start a crawl here");
  await expect(secondary).toHaveText("Ask the PUBMAXXER");
  const [p, s] = await Promise.all([
    primary.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      return { h: r.height, w: r.width, radius: c.borderRadius, justify: c.justifyContent };
    }),
    secondary.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      return { h: r.height, w: r.width, radius: c.borderRadius, justify: c.justifyContent };
    }),
  ]);
  expect(Math.abs(p.h - s.h)).toBeLessThanOrEqual(1);
  expect(Math.abs(p.w - s.w)).toBeLessThanOrEqual(1);
  expect(p.radius).toBe(s.radius);
  expect(p.justify).toBe("center");
  expect(s.justify).toBe("center");

  // ONE ROW OF TOKENS. The two actions wear the --control-* type the venue
  // sheet's text buttons wear, read off the same root, rather than the 16px
  // weight 400 the unlayered `button { font: inherit }` reset left them at
  // (verify-preview-4, section 6).
  const controlType = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.style.fontSize = root.getPropertyValue("--control-font-size");
    document.body.append(probe);
    const fontSize = getComputedStyle(probe).fontSize;
    probe.remove();
    return { fontSize, fontWeight: root.getPropertyValue("--control-font-weight").trim() };
  });
  for (const control of [primary, secondary]) {
    await expect(control).toHaveCSS("font-size", controlType.fontSize);
    await expect(control).toHaveCSS("font-weight", controlType.fontWeight);
  }

  // Name and distance share one baseline, the distance right-aligned.
  const rowGeometry = await rows.first().evaluate((el) => {
    const name = el.querySelector(".landmarkStoryPubName") as HTMLElement;
    const dist = el.querySelector(".landmarkStoryPubDistance") as HTMLElement;
    const row = el.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    const d = dist.getBoundingClientRect();
    return { rowRight: row.right, distRight: d.right, nameBottom: n.bottom, distBottom: d.bottom };
  });
  expect(Math.abs(rowGeometry.rowRight - rowGeometry.distRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(rowGeometry.nameBottom - rowGeometry.distBottom)).toBeLessThanOrEqual(3);

  // One left gutter: the head, the caveat and every row start on the same x.
  const lefts = await page.locator(`${scope} .landmarkStoryNearby h3, ${scope} .landmarkStoryCaveat, ${scope} .landmarkStoryPubs button, ${scope} .landmarkStoryHistory`).evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().left)),
  );
  expect(new Set(lefts).size).toBe(1);
}

for (const width of PHONE_WIDTHS) {
  test(`phone ${width}: the story is the shared sheet, titled, honest and reachable`, async ({ page }) => {
    // The nearby rows need the venue index, which arrives behind the canvas
    // under SwiftShader; the case is slow by nature rather than by defect.
    test.slow();
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await preparePage(page);

    const response = await page.goto(LANDMARK_URL);
    expect(response?.status()).toBe(200);

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="landmark"]');
    await expect(portal).toBeVisible({ timeout: 30_000 });
    // No card of the old kind is pinned over the map any more.
    await expect(page.locator(".landmarkCard")).toHaveCount(0);

    // The title is the sheet chrome's, fully inside the viewport and not under
    // the chip row or anything else: the element at its centre is the title.
    const title = portal.locator(".mobileSharedSheetHeader h2");
    await expect(title).toHaveText(LANDMARK_NAME);
    const titleSelector = '.mobileSheetPortal[data-sheet-kind="landmark"] .mobileSharedSheetHeader h2';
    // The sheet springs in, so the geometry is polled until it rests. The
    // budget is generous because the canvas paints under SwiftShader in this
    // suite and the spring only advances when the main thread is free.
    await expect
      .poll(async () => (await boxOf(page, titleSelector)).bottom, { timeout: 20_000 })
      .toBeLessThanOrEqual(844);
    const titleBox = await boxOf(page, titleSelector);
    expect(titleBox.top).toBeGreaterThanOrEqual(0);
    expect(titleBox.left).toBeGreaterThanOrEqual(0);
    expect(titleBox.right).toBeLessThanOrEqual(width);
    // Nothing outside the sheet (the chip row, a pin) sits over the title.
    expect(await ownsItsCentre(page, titleSelector, ".mobileSharedSheetHeader")).toBe(true);

    // The sheet is full width, so no pin can show through its edges.
    const sheetBox = await boxOf(page, '.mobileSheetPortal[data-sheet-kind="landmark"] .mobileSharedSheet');
    expect(sheetBox.left).toBeLessThanOrEqual(0.5);
    expect(sheetBox.right).toBeGreaterThanOrEqual(width - 0.5);

    // The body says where the landmark is and carries the chapter link.
    await expect(portal.locator(".landmarkStoryWhere .kicker")).toHaveText(/^In /);
    await expect(portal.getByRole("link", { name: "Open chapter" })).toBeVisible();

    await expectStoryBodyHonest(page, '.mobileSheetPortal[data-sheet-kind="landmark"]');

    // The last nearby row is reachable by scrolling the sheet body alone, and
    // nothing (planning pill, create action, tab bar) covers it.
    // Distances arrive after the first paint and the list replaces its
    // buttons, so a scroll grabbed in that gap hits a detached node.
    const lastRow = portal.locator(".landmarkStoryPubs button").last();
    await expect(async () => {
      await lastRow.scrollIntoViewIfNeeded({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(lastRow).toBeVisible();
    const portalBox = await boxOf(page, '.mobileSheetPortal[data-sheet-kind="landmark"]');
    const lastBox = await boxOf(page, '.mobileSheetPortal[data-sheet-kind="landmark"] .landmarkStoryPubs li:last-child button');
    expect(lastBox.bottom).toBeLessThanOrEqual(portalBox.bottom + 0.5);
    expect(await ownsItsCentre(page, '.mobileSheetPortal[data-sheet-kind="landmark"] .landmarkStoryPubs li:last-child button')).toBe(true);
    // The tab bar keeps its own lane under the sheet.
    const tabBar = await boxOf(page, ".mobileTabBar");
    expect(lastBox.bottom).toBeLessThanOrEqual(tabBar.top + 0.5);

    // The story is a surface the reader is ON, so the planning pill is not
    // painted under it (verify-preview-4, section 6: the pill's box lay inside
    // the sheet's band, beneath the opaque sheet).
    await expect(page.locator(".mobilePlanActivation")).toHaveCount(0);

    // Home leaves the story for the map, and the URL drops the landmark.
    await page.getByRole("button", { name: "Close the story" }).click();
    await expect(portal).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("landmark")).toBeNull();

    expect(errors).toEqual([]);
  });
}

/**
 * The names on the story's nearby list, once the list has stopped moving.
 *
 * The rows re-rank as venue shards land, and a re-rank REPLACES the buttons,
 * so a click that starts a frame before one lands on a detached element and
 * the pub never opens. Two consecutive identical reads is the settle.
 */
async function settledStoryPubNames(storyPortal: Locator): Promise<string[]> {
  let previous = "";
  let settled = "";
  await expect
    .poll(
      async () => {
        const names = (await storyPortal.locator(".landmarkStoryPubName").allInnerTexts())
          .map((name) => name.trim())
          .filter(Boolean)
          .join("|");
        const stable = names.length > 0 && names === previous;
        previous = names;
        if (stable) settled = names;
        return stable;
      },
      { timeout: 45_000, intervals: [400] },
    )
    .toBe(true);
  return settled.split("|");
}

/**
 * Open the story's nearest pub and return the name that was tapped.
 *
 * A settled list can still re-rank: the opening shards can hold the list still
 * for a second before the nearer pubs land, so a name read before the tap can
 * name a row that is gone. Each attempt reads the first row's name afresh and
 * taps that name with a short budget, so a gone row fails the attempt fast and
 * the next attempt reads the list again.
 */
async function openStoryPub(storyPortal: Locator, venuePortal: Locator): Promise<string> {
  let pubName = "";
  await expect(async () => {
    if ((await venuePortal.count()) === 0) {
      pubName = (await storyPortal.locator(".landmarkStoryPubName").first().innerText({ timeout: 4_000 })).trim();
      const row = storyPortal.locator(".landmarkStoryPubs button").filter({ hasText: pubName }).first();
      await row.click({ timeout: 4_000 });
    }
    await expect(venuePortal).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  return pubName;
}

test("phone 390: a pub opened from the story has the story as its Back", async ({ page }) => {
  // verify-preview-4, J02: The White Lion, opened from the Covent Garden
  // story, landed on /map?sel=… and browser Back then landed on a bare /map
  // with nothing open. The story is a trail surface now
  // (components/map/pubmap/useMapSurfaceNavigation.ts), so the venue sheet
  // offers "Back to Covent Garden" and the browser's Back is the same journey.
  test.slow();
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await preparePage(page);
  await page.goto(LANDMARK_URL);

  const storyPortal = page.locator('.mobileSheetPortal[data-sheet-kind="landmark"]');
  await expect(storyPortal).toBeVisible({ timeout: 30_000 });
  const rows = storyPortal.locator(".landmarkStoryPubs button");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  // The nearby rows re-rank as venue shards land, so the pub is addressed by
  // the NAME read off the list at the tap rather than by "first", or the row
  // that was tapped and the row that was read can be two different pubs - and a
  // tap mid-re-rank lands on a button that is no longer in the document.
  await settledStoryPubNames(storyPortal);
  const venuePortal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  const pubName = await openStoryPub(storyPortal, venuePortal);
  await expect(venuePortal.locator(".mobileSharedSheetHeader h2")).toHaveText(pubName);
  await expect(venuePortal).toHaveAttribute("data-surface-back", `Back to ${LANDMARK_NAME}`);
  await expect.poll(() => new URL(page.url()).searchParams.get("sel")).not.toBeNull();
  // The venue pick retires the story on screen; one sheet at a time.
  await expect(storyPortal).toHaveCount(0);

  // The sheet's own Back is the story, with its name in the chrome.
  await page.getByRole("button", { name: `Back to ${LANDMARK_NAME}` }).click();
  await expect(storyPortal).toBeVisible({ timeout: 30_000 });
  await expect(storyPortal.locator(".mobileSharedSheetHeader h2")).toHaveText(LANDMARK_NAME);
  await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get("landmark")).toBe("covent-garden");

  // And so is the browser's Back, from the pub opened a second time.
  await settledStoryPubNames(storyPortal);
  const reopenedName = await openStoryPub(storyPortal, venuePortal);
  await expect(venuePortal.locator(".mobileSharedSheetHeader h2")).toHaveText(reopenedName);
  await page.goBack();
  await expect(storyPortal).toBeVisible({ timeout: 30_000 });
  await expect(storyPortal.locator(".mobileSharedSheetHeader h2")).toHaveText(LANDMARK_NAME);

  expect(errors).toEqual([]);
});

test("desktop 1440: the story takes the left drawer and the chrome leaves its lane", async ({ page }) => {
  // A 1440 map under SwiftShader owns the main thread for whole seconds at a
  // time, and every geometry read here waits its turn behind it.
  test.slow();
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await preparePage(page);

  const response = await page.goto(LANDMARK_URL);
  expect(response?.status()).toBe(200);

  const drawer = page.locator(".storyDrawer.open");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main.appShell")).toHaveClass(/story-open/);
  await expect(page.locator(".landmarkCard")).toHaveCount(0);

  // Head: glyph, name, chapter link and the way out on one row, the glyph
  // centred in its circle, everything vertically centred on one axis.
  const head = drawer.locator(".storyDrawerHead");
  await expect(head.locator("h2")).toHaveText(LANDMARK_NAME);
  const centres = await head.locator(".landmarkStoryGlyph, .landmarkStoryTitle, .landmarkStoryChapter, .surfaceNavHome").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    }),
  );
  expect(centres).toHaveLength(4);
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(2);
  const glyph = await head.locator(".landmarkStoryGlyph").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const svg = el.querySelector("svg")!.getBoundingClientRect();
    return {
      dx: Math.abs(r.left + r.width / 2 - (svg.left + svg.width / 2)),
      dy: Math.abs(r.top + r.height / 2 - (svg.top + svg.height / 2)),
    };
  });
  expect(glyph.dx).toBeLessThanOrEqual(1);
  expect(glyph.dy).toBeLessThanOrEqual(1);

  // The drawer is inside the stage and the toolbar sits entirely to its right,
  // so neither clips the other.
  const drawerBox = await boxOf(page, ".storyDrawer.open");
  const toolbar = await boxOf(page, ".mapToolbar");
  expect(toolbar.left).toBeGreaterThanOrEqual(drawerBox.right - 0.5);
  expect(drawerBox.bottom).toBeLessThanOrEqual(900.5);
  // Since #1631 the camera actions (Show all and the compass) live in the
  // Layers popover, and the map edge keeps only a route's Recenter. So the
  // Layers entry and the open popover's camera actions clear the drawer.
  const layersFab = page.locator(".mapLayersControl > .mapLayersFab");
  await expect(layersFab).toBeVisible();
  const layersBox = await boxOf(page, ".mapLayersControl > .mapLayersFab");
  expect(layersBox.left).toBeGreaterThanOrEqual(drawerBox.right - 0.5);
  expect(await ownsItsCentre(page, ".mapLayersControl > .mapLayersFab")).toBe(true);
  const layers = page.getByRole("dialog", { name: "Map layers", exact: true });
  await expect(async () => {
    if (!(await layers.isVisible())) await layersFab.click();
    await expect(layers).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  for (const camera of [".mapLayersPanel .mapFitLondonBtn", ".mapLayersPanel .mapCompassBtn"]) {
    await expect(page.locator(camera)).toBeVisible();
    expect((await boxOf(page, camera)).left).toBeGreaterThanOrEqual(drawerBox.right - 0.5);
    expect(await ownsItsCentre(page, camera)).toBe(true);
  }
  await layers.getByRole("button", { name: "Close layers", exact: true }).click();
  await expect(layers).toBeHidden();

  await expectStoryBodyHonest(page, ".storyDrawer.open");

  // The last row scrolls into view inside the drawer and owns its centre.
  const lastRow = drawer.locator(".landmarkStoryPubs button").last();
  // Shard arrivals can replace pub rows while a scroll waits for stability.
  // Scroll the persistent drawer, then check the current last row.
  await drawer.evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight;
  });
  await expect(lastRow).toBeVisible();
  expect(await ownsItsCentre(page, ".storyDrawer.open .landmarkStoryPubs li:last-child button")).toBe(true);

  await page.getByRole("button", { name: "Close the story" }).click();
  await expect(page.locator(".storyDrawer.open")).toHaveCount(0);

  expect(errors).toEqual([]);
});
