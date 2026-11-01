import { expect, test, type Locator, type Page } from "@playwright/test";

import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "@/e2e/helpers/communitySheetFixture";

const DESKTOP = { width: 1440, height: 900 };
// The widest screen the floating List view still opens on. From 1024px the
// venue list is the column beside the map (components/map/MapSplitList.tsx),
// which re-reads the view once the camera settles; the floating list follows
// the camera frame by frame, and these width-specific cases pin that.
const NARROW_DESKTOP = { width: 1000, height: 900 };
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
function cssColourChannels(cssColour: string): { rgb: [number, number, number]; alpha: number } {
  const raw = cssColour.trim();
  if (raw === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  // A colour caught mid-transition serialises in its interpolation space, such
  // as `oklab(0.96 0.016 0.009)`. Read as sRGB, that near-white is black.
  if (!/^(rgba?\(|color\(srgb )/.test(raw)) {
    throw new Error(`Not an sRGB computed colour: ${cssColour}`);
  }
  const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  let [red, green, blue] = nums;
  let alpha = 1;
  if (raw.includes("/")) {
    const after = raw.split("/").pop() ?? "";
    const parsed = after.match(/-?\d+(?:\.\d+)?/);
    if (parsed) alpha = Number(parsed[0]);
  } else if ((raw.startsWith("rgba") || raw.startsWith("hsla")) && nums.length >= 4) {
    alpha = nums[3];
  }
  if (raw.startsWith("color(")) {
    red *= 255;
    green *= 255;
    blue *= 255;
  }
  return { rgb: [red, green, blue], alpha };
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
    // A clear fill is `transparent`, `rgba(0, 0, 0, 0)`, or the modern
    // `color(srgb 0 0 0 / 0)`. The last of those used to be read as black,
    // which put dark ink on "black" at about 1.2:1 and failed the floor.
    const clear = (value: string) => {
      const raw = value.trim();
      if (raw === "transparent") return true;
      if (!raw.includes("/") && !raw.startsWith("rgba") && !raw.startsWith("hsla")) return false;
      if (raw.includes("/")) {
        const after = raw.split("/").pop() ?? "";
        const parsed = after.match(/-?\d+(?:\.\d+)?/);
        return parsed ? Number(parsed[0]) === 0 : false;
      }
      const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      return nums.length >= 4 && nums[3] === 0;
    };
    let cursor: HTMLElement | null = node;
    let background = getComputedStyle(node).backgroundColor;
    while (cursor && clear(background)) {
      cursor = cursor.parentElement;
      if (!cursor) break;
      background = getComputedStyle(cursor).backgroundColor;
    }
    return { colour: getComputedStyle(node).color, background };
  });
  const foreground = cssColourChannels(computed.colour);
  const background = cssColourChannels(computed.background);
  expect(background.alpha).toBeGreaterThan(0);
  expect(contrastRatio(foreground.rgb, background.rgb)).toBeGreaterThanOrEqual(4.5);
}

/**
 * Switch the theme and wait until each control has finished changing colour.
 *
 * A theme switch starts a colour transition on every themed control, and under
 * reduced motion that transition still lasts until the next frame. A read in
 * the same frame gets the OLD theme's colours, with the background serialised
 * in the transition's oklab space. The settled frame is the one a reader sees.
 */
async function applyTheme(
  page: Page,
  theme: "light" | "dark",
  controls: readonly Locator[],
): Promise<void> {
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem("pubmax-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  for (const control of controls) {
    await expect
      .poll(() =>
        control.evaluate((node) => {
          for (let cursor: Element | null = node; cursor; cursor = cursor.parentElement) {
            if (cursor.getAnimations().some((animation) => animation instanceof CSSTransition)) {
              return false;
            }
          }
          return true;
        }),
      )
      .toBe(true);
  }
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

/**
 * From 1024px the list beside the map is the venue list, and Layers' List view
 * hands keyboard focus to its current row.
 */
async function focusSplitListWithKeyboard(page: Page): Promise<Locator> {
  const layers = page.getByRole("button", { name: /Map layers:/ });
  await expect(layers).toBeVisible({ timeout: 30_000 });
  // The rows land once the map has projected its first view.
  await expect
    .poll(() => page.locator(".mapSplitListRow").count(), { timeout: 90_000 })
    .toBeGreaterThan(0);
  await tabTo(page, layers);
  await page.keyboard.press("Enter");
  const list = page.getByRole("button", { name: "List view" });
  await expect(list).toBeVisible();
  await tabTo(page, list);
  await page.keyboard.press("Enter");

  const focusedVenue = page.locator(".mapSplitList .mapSplitListRow:focus");
  await expect(focusedVenue).toHaveCount(1);
  const venueId = await focusedVenue.getAttribute("data-venue-id");
  expect(venueId).toBeTruthy();
  const venue = page.locator(`.mapSplitListRow[data-venue-id=${JSON.stringify(venueId)}]`);
  await expect(venue).toBeFocused();
  return venue;
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

  // The pub stream can reorder the first row while focus correctly stays on
  // the venue the keyboard reader reached. Follow that venue, not its index.
  const focusedVenue = page.locator(".mapVenueListItem:focus");
  await expect(focusedVenue).toHaveCount(1);
  const venueId = await focusedVenue.getAttribute("data-venue-id");
  expect(venueId).toBeTruthy();
  const venue = page.locator(`.mapVenueListItem[data-venue-id=${JSON.stringify(venueId)}]`);
  await expect(venue).toBeFocused();
  return venue;
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
      const control = page.getByRole("button", { name, exact: true });
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

    const firstVenue = await focusSplitListWithKeyboard(page);
    const venueName = (await firstVenue.locator(".mapSplitListRowName").innerText()).trim();
    const venueId = await firstVenue.getAttribute("data-venue-id");
    const accessibleName = await firstVenue.getAttribute("aria-label");

    expect(venueName.length).toBeGreaterThan(0);
    expect(venueId).toBeTruthy();
    expect(accessibleName).toBeNull();
    // The row's own words carry the price, its standing or its absence.
    await expect(firstVenue.locator(".mapSplitListRowTrust")).not.toHaveText("");
    await expect(firstVenue).toContainText(/£|price/i);

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
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto("/map");
    await openVenueListWithKeyboard(page);

    const wrap = page.locator(".mapCanvasWrap");
    // The first focused row precedes completion of the viewport's pub stream.
    await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", {
      timeout: 20_000,
    });
    const beforeBaseCount = Number(await wrap.getAttribute("data-uk-base-count"));
    expect(beforeBaseCount).toBeGreaterThan(0);
    const rows = page.locator(".mapVenueListItem");
    const beforeMoveIds = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-venue-id")),
    );
    const beforeMove = beforeMoveIds.length;
    expect(beforeMove).toBeGreaterThan(0);
    expect(beforeMoveIds.every(Boolean)).toBe(true);

    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();

    await expect
      .poll(
        () => wrap.evaluate((node, initialCount) => ({
          ready: node.getAttribute("data-uk-base-status") === "ready",
          narrowed: Number(node.getAttribute("data-uk-base-count")) < initialCount,
        }), beforeBaseCount),
        { timeout: 20_000 },
      )
      .toEqual({ ready: true, narrowed: true });
    await expect
      .poll(() => rows.count(), { timeout: 20_000 })
      .toBeLessThan(beforeMove);
    await expect
      .poll(
        () =>
          rows.evaluateAll((items) =>
            items.map((item) => item.getAttribute("data-venue-id")),
          ),
        { timeout: 20_000 },
      )
      .not.toEqual(beforeMoveIds);

    const barRows = rows.filter({
      has: page.locator(".mapVenueListItemMeta > span", { hasText: /^Bar$/ }),
    });
    await expect.poll(() => barRows.count()).toBeGreaterThan(0);
    const beforeFilter = await rows.count();
    // The venue-type chips live in the toolbar's Filters panel (#1631).
    await page.getByRole("button", { name: /^Filters:/ }).click();
    const bars = page
      .getByRole("dialog", { name: "Filters" })
      .getByRole("button", { name: "Bars", exact: true });
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => rows.count()).toBeLessThan(beforeFilter);
    await expect(barRows).toHaveCount(0);
  });

  test("drops old base-pub rows during a disjoint pan before the next shard fetch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(NARROW_DESKTOP);
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
    // Right of the open list's panel, which reaches about 352px in.
    for (let drag = 0; drag < 3; drag += 1) {
      await page.mouse.move(980, 500);
      await page.mouse.down();
      await page.mouse.move(370, 500);
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

  test("keeps the desktop toolbar reachable and restores chosen venue on Escape", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/map");
    const canvas = page.locator(".maplibregl-canvas").first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    // From 1024px the venue list is the column beside the map; keyboard Tab
    // into it is covered by the sibling spec. This case pins Escape on the
    // venue drawer with the list still beside it. The non-modal drawer also
    // keeps the toolbar live.
    await expect
      .poll(() => page.locator(".mapSplitListRow").count(), { timeout: 90_000 })
      .toBeGreaterThan(0);
    const chosenVenueId = await page.locator(".mapSplitListRow").first().getAttribute("data-venue-id");
    expect(chosenVenueId).toBeTruthy();
    const chosenVenue = page.locator(
      `.mapSplitListRow[data-venue-id="${chosenVenueId}"]`,
    );
    await chosenVenue.focus();
    await expect(chosenVenue).toBeFocused();
    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    const closeButton = drawer.getByRole("button", { name: /Close/ });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAccessibleName("Pub detail");
    await expect(drawer).not.toHaveAttribute("aria-modal");
    await expect
      .poll(
        async () => closeButton.evaluate((node) => node === document.activeElement),
        { timeout: 30_000 },
      )
      .toBe(true);

    const focusableSelector =
      'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible';
    const focusables = drawer.locator(focusableSelector);
    const firstFocusable = focusables.first();
    const lastFocusable = focusables.last();
    const toolbar = page.locator(".mapToolbar");
    const toolbarFocusables = toolbar.locator(focusableSelector);
    const firstExemptFocusable = page.getByRole("link", { name: "Open PUBMAXX landing page", exact: true });
    const lastToolbarFocusable = toolbarFocusables.last();
    await expect(toolbar).toBeVisible();

    await lastFocusable.focus();
    await page.keyboard.press("Tab");
    await expect(firstExemptFocusable).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(lastFocusable).toBeFocused();

    await firstFocusable.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(lastToolbarFocusable).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(firstFocusable).toBeFocused();

    // Traverse the exempt header and toolbar, then use Filters with keys.
    await lastFocusable.focus();
    await page.keyboard.press("Tab");
    await expect(firstExemptFocusable).toBeFocused();
    const filters = toolbar.locator(".mapVenueKindFilterBtn");
    await tabTo(page, filters);
    await page.keyboard.press("Enter");
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(filters).toHaveAttribute("aria-expanded", "false");

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
    // Wait for the cross-city result. A positional pick can select a London
    // pub before the national index loads and miss the full-navigation path.
    const highlightedVenue = listbox.locator(
      '[role="option"][data-venue-id="venue-glw-q7pz7s"]',
    );
    await expect(highlightedVenue).toBeVisible({ timeout: 30_000 });
    await expect(search).toHaveAttribute("aria-busy", "false");
    await expect(listbox.getByRole("group", { name: "Venues", exact: true })
      .getByRole("option")).toHaveCount(3);
    const highlightedVenueId = await highlightedVenue.getAttribute("data-venue-id");
    expect(highlightedVenueId).toBeTruthy();
    await search.focus();
    for (let index = 0; index < 80; index += 1) {
      if (await highlightedVenue.getAttribute("aria-selected") === "true") break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(highlightedVenue).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(highlightedVenueId);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/map/glasgow");

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
    await expect(search).toBeVisible();
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
    // The floating List view's own row ids are what focus returns to, and it
    // opens below 1024px only.
    await page.setViewportSize(NARROW_DESKTOP);
    await page.goto("/map");
    await page.evaluate(() => {
      const back = window.history.back.bind(window.history);
      window.history.back = () => {
        window.setTimeout(back, 250);
      };
    });

    const firstVenue = await openVenueListWithKeyboard(page);
    const firstVenueId = await firstVenue.getAttribute("data-venue-id");
    expect(firstVenueId).toBeTruthy();
    const secondVenueCandidate = page.locator(
      `.mapVenueListItem:not([data-venue-id=${JSON.stringify(firstVenueId)}])`,
    ).first();
    const secondVenueId = await secondVenueCandidate.getAttribute("data-venue-id");
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
      await applyTheme(page, theme, [planButton]);
      await expectLockedCoralContrast(planButton);
    }

    await page.setViewportSize(MOBILE);
    for (const crawlInProgress of [false, true]) {
      const crawlQuery = crawlInProgress ? `&pubs=${COMMUNITY_SHEET_FIXTURE_VENUE_ID}` : "";
      await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build${crawlQuery}`);
      const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
      const planDoor = portal.getByRole("button", {
        name: crawlInProgress ? "Plan stop" : "Make Arnos Arms Stop 1",
        exact: true,
      });
      const priceDoor = portal.locator("[data-price-door]");
      const actions = portal.getByRole("toolbar", { name: "Venue actions" });
      const share = actions.getByRole("button", { name: "Share Arnos Arms", exact: true });
      await expect(planDoor).toBeVisible();
      await expect(priceDoor).toHaveCount(1);
      await expect(actions.getByRole("button")).toHaveText(["Ask for a table", "Share"]);
      // ONE coral on the sheet: the action card's plan door. The price door is
      // drawn in ink beside it since the card (lib/venueActionCard.ts).
      for (const theme of ["light", "dark"] as const) {
        await applyTheme(page, theme, [planDoor, priceDoor, share]);
        await expectLockedCoralContrast(planDoor);
        await expectReadableGhostContrast(priceDoor);
        await expectReadableGhostContrast(share);
      }
    }
  });
});
