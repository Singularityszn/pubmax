import { readFileSync } from "node:fs";
import { rowsFromSlimPayload } from "../lib/slimPayload";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const ARNOS_ARMS_ID = "venue-xjf3n0";
const LOCKED_DARK_INK = [22, 18, 42] as const;
const LOCKED_CORAL = [255, 90, 95] as const;
const LOCKED_CORAL_BRIGHT = [255, 122, 85] as const;

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbChannels(cssColour: string): [number, number, number] {
  const channels = cssColour.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  return [channels[0], channels[1], channels[2]];
}

async function expectLockedCoralContrast(control: Locator): Promise<void> {
  const computed = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      colour: style.color,
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
    };
  });
  const foreground = rgbChannels(computed.colour);
  expect(foreground).toEqual(LOCKED_DARK_INK);
  expect(
    `${computed.backgroundColour} ${computed.backgroundImage}`,
  ).toContain("255, 90, 95");
  expect(
    Math.min(
      contrastRatio(foreground, LOCKED_CORAL),
      contrastRatio(foreground, LOCKED_CORAL_BRIGHT),
    ),
  ).toBeGreaterThanOrEqual(5.96);
}

/**
 * A theme-mixed surface computes as `color(srgb r g b)` with 0..1 channels,
 * never `rgb()`, so a bare digit scrape reads 0.99 as a channel of 1 and calls
 * a near-white panel black. The sticky bar's secondary sits on such a mix.
 */
function cssColourChannels(cssColour: string): [number, number, number] {
  const channels = cssColour.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  const [red, green, blue] = channels;
  return cssColour.startsWith("color(")
    ? [red * 255, green * 255, blue * 255]
    : [red, green, blue];
}

/**
 * The sticky bar carries NO primary: the phone peek's "Plan stop" is the one
 * painted plan action and the Overview's price door the one painted price
 * action (lib/pintTrust.ts, `overviewPriceDoor`), so "Make it Stop 1" reads as
 * a ghost over the sheet's own panel. What it still owes is ordinary readable
 * contrast against the surface it actually renders on.
 */
async function expectReadableGhostContrast(control: Locator): Promise<void> {
  const computed = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    let background = style.backgroundColor;
    let cursor: HTMLElement | null = node.parentElement;
    while (cursor && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(background)) {
      background = getComputedStyle(cursor).backgroundColor;
      cursor = cursor.parentElement;
    }
    return { colour: style.color, background };
  });
  expect(
    contrastRatio(
      cssColourChannels(computed.colour),
      cssColourChannels(computed.background),
    ),
  ).toBeGreaterThanOrEqual(4.5);
}

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function tabTo(page: Page, target: Locator, maxTabs = 80): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function openVenueListFromLayers(page: Page): Promise<void> {
  const layers = page.getByRole("button", { name: /Map layers:/ });
  await expect(layers).toBeVisible({ timeout: 30_000 });
  const list = page.getByRole("button", { name: "List view" });
  const firstVenue = page.locator(".mapVenueListItem").first();
  // Layers opens from the toolbar; pointer taps can race hydration (e2e/AGENTS.md).
  await expect(async () => {
    await layers.focus();
    await page.keyboard.press("Enter");
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  // List view lives in that popover; same hydration idiom as the control above.
  await list.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".mapVenueList--open")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => firstVenue.count(), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect(firstVenue).toBeVisible();
}

async function openVenueListWithKeyboard(page: Page): Promise<Locator> {
  const layers = page.getByRole("button", { name: /Map layers:/ });
  await expect(layers).toBeVisible({ timeout: 30_000 });
  await tabTo(page, layers);
  await page.keyboard.press("Enter");
  const list = page.getByRole("button", { name: "List view" });
  await expect(list).toBeVisible();
  await tabTo(page, list);
  await page.keyboard.press("Enter");

  // Streamed rows can reorder while Chromium keeps focus on the same venue.
  const focusedVenue = page.locator(".mapVenueListItem:focus");
  await expect(focusedVenue).toBeVisible();
  const focusedVenueId = await focusedVenue.getAttribute("data-venue-id");
  expect(focusedVenueId).toBeTruthy();
  const venueById = page.locator(
    `.mapVenueListItem[data-venue-id="${focusedVenueId}"]`,
  );
  await expect(venueById).toBeFocused();
  return venueById;
}

test.describe("map keyboard and screen-reader venue path", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissFirstRunChrome(page);
  });

  test("keeps desktop MapLibre zoom controls at the 44px target floor", async ({
    page,
  }) => {
    await page.goto("/map");

    for (const name of ["Zoom in", "Zoom out"] as const) {
      const control = page.getByRole("button", { name });
      await expect(control).toBeVisible({ timeout: 30_000 });
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("tabs into venue list and opens a named venue without canvas hit-testing", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const firstVenue = await openVenueListWithKeyboard(page);
    const venueName = (await firstVenue.locator(".mapVenueListItemName").innerText()).trim();
    const venueId = await firstVenue.getAttribute("data-venue-id");
    const accessibleName = await firstVenue.getAttribute("aria-label");

    expect(venueName.length).toBeGreaterThan(0);
    expect(venueId).toBeTruthy();
    expect(accessibleName).toBeNull();
    await expect(firstVenue).toContainText(/Pub|Bar|Late food|Restaurant/);
    await expect(firstVenue).toContainText(/£|Price|no price/i);

    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(venueId);
  });

  test("updates open venue list after map movement and a venue-kind filter", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ukBaseRequests: string[] = [];
    const pendingUkBaseRequests = new Set<Request>();
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/data/uk_base/")) return;
      ukBaseRequests.push(path);
      pendingUkBaseRequests.add(request);
    });
    page.on("requestfinished", (request) => pendingUkBaseRequests.delete(request));
    page.on("requestfailed", (request) => pendingUkBaseRequests.delete(request));
    await page.goto("/map");
    await openVenueListWithKeyboard(page);

    const rows = page.locator(".mapVenueListItem");
    const beforeMove = await rows.count();
    const beforeMoveIds = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-venue-id")),
    );
    expect(beforeMove).toBeGreaterThan(0);
    expect(beforeMoveIds.every(Boolean)).toBe(true);

    const venueRows = rowsFromSlimPayload(JSON.parse(readFileSync("public/data/venues_slim.json", "utf8"))) as Array<{ id: string; lng: number; lat: number }> | null;
    expect(venueRows).not.toBeNull();
    const venuesById = new Map(venueRows!.map((venue) => [venue.id, venue]));
    const initialCoordinates = beforeMoveIds
      .filter((id): id is string => Boolean(id && !id.startsWith("venue-uk-")))
      .map((id) => {
        const venue = venuesById.get(id);
        expect(venue, `Coordinates for initially visible ${id}`).toBeDefined();
        return { id, lng: venue!.lng, lat: venue!.lat };
      });
    expect(initialCoordinates.length).toBeGreaterThan(0);
    const beforeZoom = await page.evaluate(() => (
      window as Window & { __pubmaxMapCamera: { read: () => { zoom: number } } }
    ).__pubmaxMapCamera.read().zoom);
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    await expect.poll(() => page.evaluate((zoom) => {
      const camera = (window as Window & {
        __pubmaxMapCamera: { read: () => { zoom: number; moving: boolean } };
      }).__pubmaxMapCamera.read();
      return !camera.moving && camera.zoom >= zoom + 2.5;
    }, beforeZoom), { timeout: 20_000 }).toBe(true);

    // Streams can add rows during zoom. Check the original points that actually
    // left the viewport rather than expecting the combined inventory to shrink.
    const outsideIds = await page.evaluate((coordinates) => {
      const probe = (window as Window & {
        __pubmaxMapCamera: { project: (point: [number, number]) => { x: number; y: number } };
      }).__pubmaxMapCamera;
      const rect = document.querySelector(".maplibreMap")!.getBoundingClientRect();
      return coordinates.filter(({ lng, lat }) => {
        const point = probe.project([lng, lat]);
        return point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom;
      }).map(({ id }) => id);
    }, initialCoordinates);
    expect(outsideIds.length).toBeGreaterThan(0);
    await expect.poll(() => rows.evaluateAll((items, outside) => items
      .map((item) => item.getAttribute("data-venue-id"))
      .filter((id) => id !== null && outside.includes(id)), outsideIds), { timeout: 20_000 }).toEqual([]);
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          rows.evaluateAll((items) =>
            items.map((item) => item.getAttribute("data-venue-id")),
          ),
        { timeout: 20_000 },
      )
      .not.toEqual(beforeMoveIds);

    // The viewport stream starts after a 180 ms settle debounce. Finish that
    // read before counting requests, so a late zoom shard is not blamed on a
    // subsequent kind toggle.
    await page.waitForTimeout(250);
    await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-uk-base-status", "ready");
    await expect.poll(() => pendingUkBaseRequests.size).toBe(0);
    const curatedRows = page.locator('.mapVenueListItem:not([data-venue-id^="venue-uk-"])');
    const curatedBars = curatedRows.filter({ has: page.locator(".mapVenueListItemMeta > span:first-child", { hasText: /^Bar$/ }) });
    const curatedPubs = curatedRows.filter({ has: page.locator(".mapVenueListItemMeta > span:first-child", { hasText: /^Pub$/ }) });
    const baseRows = page.locator('.mapVenueListItem[data-venue-id^="venue-uk-"]');
    const baseBars = baseRows.filter({ hasText: "Other bar · no listed price" });
    const basePubs = baseRows.filter({ hasText: "Other pub · no listed price" });
    const ids = (locator: Locator) => locator.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-venue-id")!).filter(Boolean),
    );
    const curatedBarIds = await ids(curatedBars);
    const curatedPubIds = await ids(curatedPubs);
    await expect.poll(() => baseBars.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    const baseBarIds = await ids(baseBars);
    const basePubIds = await ids(basePubs);
    expect(curatedBarIds.length).toBeGreaterThan(0);
    expect(curatedPubIds.length).toBeGreaterThan(0);
    expect(baseBarIds.length).toBeGreaterThan(0);
    expect(basePubIds.length).toBeGreaterThan(0);
    expect(ukBaseRequests.length).toBeGreaterThan(0);
    const requestsBeforeToggle = ukBaseRequests.length;
    const filters = page.getByRole("button", { name: /^Filters:/ });
    await filters.click();
    const panel = page.getByRole("dialog", { name: "Filters" });
    const bars = panel.getByRole("button", { name: "Bars", exact: true });
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    await filters.click();
    await expect(curatedBars).toHaveCount(0);
    await expect(baseBars).toHaveCount(0);
    await expect.poll(() => ids(rows).then((present) =>
      present.filter((id) => [...curatedBarIds, ...baseBarIds].includes(id))),
    ).toEqual([]);
    await expect(page.locator(`.mapVenueListItem[data-venue-id="${basePubIds[0]}"]`)).toBeVisible();
    expect(ukBaseRequests).toHaveLength(requestsBeforeToggle);

    await filters.click();
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await filters.click();
    await expect.poll(async () => (await ids(baseBars)).sort(), { timeout: 20_000 })
      .toEqual([...baseBarIds].sort());
    expect(ukBaseRequests).toHaveLength(requestsBeforeToggle);

    await filters.click();
    const pints = panel.getByRole("button", { name: "Pints", exact: true });
    await pints.click();
    await expect(pints).toHaveAttribute("aria-pressed", "false");
    await filters.click();
    await expect(curatedPubs).toHaveCount(0);
    await expect(basePubs).toHaveCount(0);
    await expect.poll(() => ids(rows).then((present) =>
      present.filter((id) => [...curatedPubIds, ...basePubIds].includes(id))),
    ).toEqual([]);
    await expect(baseBars.first()).toBeVisible();
    expect(ukBaseRequests).toHaveLength(requestsBeforeToggle);

    // A bar selected from the surviving base rows still has a shareable cold
    // restore, independent of the viewport's filter or streaming callback.
    const selectedBarId = await baseBars.first().getAttribute("data-venue-id");
    expect(selectedBarId).toBeTruthy();
    const selectedBar = page.locator(`.mapVenueListItem[data-venue-id="${selectedBarId}"]`);
    const baseBarName = await selectedBar.locator(".mapVenueListItemName").innerText();
    await selectedBar.click();
    const unverified = page.locator(".unverifiedPub");
    await expect(unverified).toBeVisible();
    await expect(unverified.locator(".unverifiedPubName")).toHaveText(baseBarName.trim());
    const barUrl = page.url();
    expect(new URL(barUrl).searchParams.get("sel")).toBe(selectedBarId);
    expect(new URL(barUrl).searchParams.has("at")).toBe(true);
    await page.goto(barUrl);
    await expect(unverified).toBeVisible({ timeout: 45_000 });
    await expect(unverified.locator(".unverifiedPubName")).toHaveText(baseBarName.trim());
  });

  test("drops old base-pub rows during a disjoint pan before the next shard fetch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/map");

    const canvas = page.locator(".maplibregl-canvas").first();
    const wrap = page.locator(".mapCanvasWrap");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.focus();
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press("Equal");
      await page.waitForTimeout(1_400);
    }
    await expect
      .poll(
        async () => Number(await wrap.getAttribute("data-uk-base-count")),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await openVenueListFromLayers(page);
    const baseRows = page.locator(
      '.mapVenueListItem[data-venue-id^="venue-uk-"]',
    );
    await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const oldIds = new Set(
      await baseRows.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-venue-id") ?? ""),
      ),
    );

    // One quick multi-screen drag leaves the next 180 ms shard request
    // pending. DOM membership must still follow camera projection immediately.
    for (let drag = 0; drag < 3; drag += 1) {
      await page.mouse.move(1_300, 500);
      await page.mouse.down();
      await page.mouse.move(400, 500);
      await page.mouse.up();
    }
    await page.waitForTimeout(50);

    const overlappingOldIds = await baseRows.evaluateAll(
      (items, ids) =>
        items
          .map((item) => item.getAttribute("data-venue-id") ?? "")
          .filter((id) => ids.includes(id)),
      [...oldIds],
    );
    expect(overlappingOldIds).toEqual([]);

    await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await canvas.focus();
    // London opens already past UK_BASE_MIN_ZOOM (12). Three Minus presses
    // from a zoomed-in view often land back on that street-level camera, which
    // is still above the gate, so keep zooming until the wrap reports the
    // floor rather than assuming a fixed key count crossed it.
    await expect
      .poll(
        async () => {
          await page.keyboard.press("Minus");
          return wrap.getAttribute("data-uk-base-status");
        },
        { timeout: 20_000 },
      )
      .toBe("zoom_required");
    // MapLibre has settled below the layer floor, but the base stream's 180 ms
    // clear may still be pending on a loaded runner. Poll rather than a tight
    // fixed-timeout assertion so runner variance can't race the clear.
    await expect.poll(() => baseRows.count(), { timeout: 5_000 }).toBe(0);
  });

  test("keeps desktop drawer focus inside and restores chosen venue on Escape", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/map");
    const canvas = page.locator(".maplibregl-canvas").first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    // List view opens from Layers; keyboard Tab into the list is covered by the
    // sibling spec. This case pins Escape on the venue drawer with the list
    // still open underneath — the regression path from List view.
    await openVenueListFromLayers(page);
    const chosenVenueCandidate = page.locator(".mapVenueListItem").first();
    const chosenVenueId = await chosenVenueCandidate.getAttribute("data-venue-id");
    expect(chosenVenueId).toBeTruthy();
    const chosenVenue = page.locator(
      `.mapVenueListItem[data-venue-id="${chosenVenueId}"]`,
    );
    await chosenVenue.focus();
    await expect(chosenVenue).toBeFocused();
    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    const closeButton = drawer.getByRole("button", { name: /Close/ });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect
      .poll(
        async () => closeButton.evaluate((node) => node === document.activeElement),
        { timeout: 30_000 },
      )
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(chosenVenue).toBeFocused({ timeout: 15_000 });
  });

  test("returns Escape focus to a keyboard-selected search result", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const search = page.locator("#mapSearchInput");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill("Dolphin");
    const listbox = page.getByRole("listbox", { name: "Search suggestions" });
    // Search suggestions can include area/place entries. Select a concrete
    // venue option so the contract never depends on a mixed-result index.
    const highlightedVenue = listbox
      .locator('[role="option"][data-venue-id]')
      .nth(2);
    await expect(highlightedVenue).toBeVisible();
    const highlightedVenueId = await highlightedVenue.getAttribute("data-venue-id");
    expect(highlightedVenueId).toBeTruthy();
    const optionIndex = await listbox.getByRole("option").evaluateAll(
      (options, venueId) =>
        options.findIndex((option) => option.getAttribute("data-venue-id") === venueId),
      highlightedVenueId,
    );
    expect(optionIndex).toBeGreaterThanOrEqual(0);

    await search.focus();
    for (let index = 0; index <= optionIndex; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(highlightedVenueId);

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /Close/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBeNull();
    await expect(search).toBeFocused();
  });

  test("keyboard search selects a pub before a matching area", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const search = page.locator("#mapSearchInput");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill("Blackfriar");

    const listbox = page.getByRole("listbox", { name: "Search suggestions" });
    const venue = listbox
      .getByRole("group", { name: "Venues", exact: true })
      .getByRole("option", { name: /The Blackfriar/i });
    const area = listbox
      .getByRole("group", { name: "Areas", exact: true })
      .getByRole("option", { name: /Blackfriars/i });
    await expect(venue).toBeVisible();
    await expect(area).toBeVisible();
    const venueId = await venue.getAttribute("data-venue-id");
    expect(venueId).toBeTruthy();
    const venueOptionIndex = await listbox
      .getByRole("option")
      .evaluateAll(
        (options, id) =>
          options.findIndex(
            (option) => option.getAttribute("data-venue-id") === id,
          ),
        venueId,
      );
    const areaOptionIndex = await listbox
      .getByRole("option")
      .evaluateAll((options) =>
        options.findIndex(
          (option) =>
            option.textContent?.includes("Blackfriars") &&
            !option.hasAttribute("data-venue-id"),
        ),
      );
    expect(venueOptionIndex).toBeGreaterThanOrEqual(0);
    expect(areaOptionIndex).toBeGreaterThan(venueOptionIndex);

    await search.focus();
    for (let index = 0; index <= venueOptionIndex; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(search).toHaveAttribute(
      "aria-activedescendant",
      await venue.getAttribute("id"),
    );
    await page.keyboard.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(venueId);
  });

  test("keeps a rapid reselection open after close history settles", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await page.evaluate(() => {
      const back = window.history.back.bind(window.history);
      window.history.back = () => {
        window.setTimeout(back, 250);
      };
    });

    const firstVenue = await openVenueListWithKeyboard(page);
    const firstVenueId = await firstVenue.getAttribute("data-venue-id");
    const secondVenueCandidate = page.locator(".mapVenueListItem").nth(1);
    const secondVenueId = await secondVenueCandidate.getAttribute("data-venue-id");
    expect(firstVenueId).toBeTruthy();
    expect(secondVenueId).toBeTruthy();
    expect(secondVenueId).not.toBe(firstVenueId);
    const secondVenue = page.locator(
      `.mapVenueListItem[data-venue-id="${secondVenueId}"]`,
    );

    await page.keyboard.press("Enter");
    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(firstVenue).toBeFocused();
    await secondVenue.focus();
    await page.keyboard.press("Enter");

    await expect(drawer).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(secondVenueId);
    await page.waitForTimeout(350);
    await expect(drawer).toBeVisible();
    expect(new URL(page.url()).searchParams.get("sel")).toBe(secondVenueId);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
      .toBe(`map-venue-list-item-${secondVenueId}`);
  });

  test("keeps locked coral Plan CTA above 5.96:1 contrast", async ({
    page,
  }) => {
    await page.goto("/map");
    const planButton = page.getByRole("button", { name: "Plan an outing" }).first();
    await expect(planButton).toBeVisible({ timeout: 30_000 });

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        window.localStorage.setItem("pubmax-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectLockedCoralContrast(planButton);
    }

    await page.setViewportSize(MOBILE);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    const planStop = page.getByRole("button", { name: "Plan stop" });
    // One painted primary per screen: the peek's "Plan stop" keeps the locked
    // coral, and the sticky bar's "Make it Stop 1" is its ghost neighbour. The
    // sheet's one painted PRICE action is the Overview's price door, and it
    // wears the same locked pair. The guarantee follows the primary; it never
    // followed the button's name.
    const acceptStop1 = page.getByRole("button", {
      name: "Make Arnos Arms Stop 1",
    });
    const priceDoor = page.locator("[data-price-door]");
    await expect(planStop).toBeVisible();
    await expect(acceptStop1).toBeVisible();
    await expect(priceDoor).toHaveCount(1);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        window.localStorage.setItem("pubmax-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expectLockedCoralContrast(planStop);
      await expectLockedCoralContrast(priceDoor);
      await expectReadableGhostContrast(acceptStop1);
    }
  });
});
