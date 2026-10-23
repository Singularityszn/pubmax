import { expect, test, type Locator, type Page } from "@playwright/test";

import { COMMUNITY_SHEET_FIXTURE_VENUE_ID } from "./helpers/communitySheetFixture";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// The mapped-route chip belongs to the map, not to the venue drawer. While the
// desktop drawer is open its focus trap used to make the whole map stage
// inert, so "Check last train at final stop" took no click and no Enter, and
// the chip sat 24px under the drawer's left edge at 1440. The chip is an
// exempt surface of that trap now: a pointer and a keyboard both reach it, and
// it sits in the map lane the drawer leaves.

const FIRST_STOP = "venue-yl1a48";
const FINAL_STOP = COMMUNITY_SHEET_FIXTURE_VENUE_ID;

const FOCUSABLE =
  'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible';

// The venue detail keeps adding controls after the drawer opens, so a
// `.last()` read taken once can name a control that is no longer the trap's
// edge by keydown. Focus the edge the trap itself computes, visible
// focusables by `offsetParent`, and retry the Tab until it reaches the chip.
async function tabFromDrawerEdgeToChip(page: Page, drawer: Locator, chip: Locator) {
  const chipFirst = chip.locator(FOCUSABLE).first();
  await expect(async () => {
    await drawer.evaluate((node, selector) => {
      const controls = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (control) => control.offsetParent !== null,
      );
      controls[controls.length - 1]?.focus();
    }, 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    // The desktop toolbar is an exempt surface too (QA journeys F04) and comes
    // before the chip in the document, so Tab crosses its controls on the way.
    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press("Tab");
      if (await chipFirst.evaluate((node) => node === document.activeElement)) return;
    }
    await expect(chipFirst).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

async function openFirstStopDrawer(page: Page, width: number) {
  const { drawer, chip: mounted } = await openFirstStopDrawerWithChipMounted(page, width);
  await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(FIRST_STOP);

  const chip = mounted.filter({ visible: true });
  await expect(chip).toBeVisible({ timeout: 60_000 });
  return { drawer, chip };
}

async function openFirstStopDrawerWithChipMounted(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  // A headless browser reads every painted WebGL frame back on its main
  // thread, and a stream of live tiles held it for seconds at a time: the tap,
  // the Tab and the focus reads below were refused for want of a thread, not
  // for want of a reachable chip. The chip does not depend on the basemap.
  await installDeterministicMapBasemap(page);

  const response = await page.goto(
    `/map?mode=build&pubs=${FIRST_STOP}%2C${FINAL_STOP}&sel=${FIRST_STOP}`,
  );
  expect(response?.status()).toBe(200);

  const drawer = page.locator(".mapDrawer.right.open");
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  const chip = page.locator(".mappedRouteChip");
  await expect(chip.first()).toBeAttached({ timeout: 60_000 });
  return { drawer, chip };
}

async function expectFinalStopLastTrain(page: Page, drawer: Locator) {
  await expect.poll(() => new URL(page.url()).searchParams.get("sel"), {
    timeout: 30_000,
  }).toBe(FINAL_STOP);
  await expect(drawer).toBeVisible();
  const fold = drawer.locator("#venueSection-getting-home");
  await expect(fold).toHaveAttribute("open", "", { timeout: 30_000 });
  await expect(fold.getByLabel("Last Pint")).toBeVisible();
}

test.describe("desktop drawer leaves the route chip reachable", () => {
  test("a click on Check last train opens the final stop's last-train card", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { drawer, chip } = await openFirstStopDrawer(page, 1440);

    const door = chip.getByRole("button", { name: "Check last train at final stop" });
    // The click is the inert check: an inert button takes no hit, so the click
    // retries until the trap exempts the chip. A separate read of `[inert]` had
    // only expect.poll's 10s, and one read could wait longer than that for a
    // main thread busy drawing the map.
    await door.click({ timeout: 30_000 });

    await expectFinalStopLastTrain(page, drawer);
  });

  test("Tab leaves the drawer for the chip, and Enter opens the last-train card", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { drawer, chip } = await openFirstStopDrawer(page, 1440);

    const closeButton = drawer.getByRole("button", { name: /Close/ });
    await expect(closeButton).toBeFocused();

    // Forward from the drawer's last control the trap hands focus to the
    // chip's first control, then back into the drawer after its last one.
    const chipControls = chip.locator(FOCUSABLE);
    await tabFromDrawerEdgeToChip(page, drawer, chip);

    const door = chip.getByRole("button", { name: "Check last train at final stop" });
    await page.keyboard.press("Tab");
    await expect(door).toBeFocused();

    await chipControls.last().focus();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(chipControls.last()).toBeFocused();

    await door.focus();
    await page.keyboard.press("Enter");
    await expectFinalStopLastTrain(page, drawer);
  });

  test("Enter on the chip's Hide returns focus to the drawer", async ({ page }) => {
    test.setTimeout(180_000);
    const { drawer, chip } = await openFirstStopDrawer(page, 1440);

    await tabFromDrawerEdgeToChip(page, drawer, chip);
    const hide = chip.getByRole("button", { name: "Hide mapped crawl" });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(hide).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator(".mappedRouteChip")).toHaveCount(0);
    await expect
      .poll(() => drawer.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
  });

  test("at 768 the drawer is a full-width sheet, so the chip leaves the layout", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { drawer, chip } = await openFirstStopDrawerWithChipMounted(page, 768);

    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.x).toBe(0);
    expect(drawerBox!.width).toBe(768);
    await expect(chip.filter({ visible: true })).toHaveCount(0);
    await expect(drawer).toHaveAttribute("aria-modal", "true");
  });

  for (const width of [1440, 1280, 900]) {
    test(`at ${width} the chip sits clear of the open drawer`, async ({ page }) => {
      test.setTimeout(180_000);
      const { drawer, chip } = await openFirstStopDrawer(page, width);

      const drawerBox = await drawer.boundingBox();
      const chipBox = await chip.boundingBox();
      expect(drawerBox).not.toBeNull();
      expect(chipBox).not.toBeNull();
      expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(drawerBox!.x);
      expect(chipBox!.x).toBeGreaterThanOrEqual(0);
      await expect.poll(() => drawer.getAttribute("aria-modal")).toBeNull();

      const heights = await chip
        .locator("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
      expect(heights.length).toBe(3);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    });
  }
});
