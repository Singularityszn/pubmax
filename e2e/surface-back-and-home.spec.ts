import { expect, test, type Page } from "@playwright/test";

/**
 * No surface in this product is a dead end.
 *
 * Every panel a reader opens has to answer two questions: how do I step back to
 * what opened this, and how do I get out entirely. Before the surface trail
 * (lib/surfaceStack.ts) each panel carried its own close and nothing else, so a
 * reader three deep could shut the top one and land on a map they never chose.
 *
 * These are the rules, not the wiring:
 *   - The FIRST surface over the map has Home and no Back, because there the
 *     two are the same journey and a second control would be noise.
 *   - Every deeper surface has both, in the same two places.
 *   - Back names where it goes, and restores what the reader had.
 *   - The browser's Back does the same thing as the Back arrow.
 */

test.setTimeout(90_000);

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** A returning reader with the first-run tour behind them. */
async function settleFirstRun(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function openMap(page: Page): Promise<void> {
  await settleFirstRun(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/map");
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function openPhoneMap(page: Page): Promise<void> {
  await openMap(page);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 30_000 });
}

/** The one Back control, wherever the surface lives. */
function back(page: Page) {
  return page.locator(".surfaceNavBack");
}

/** The one Home control. */
function home(page: Page) {
  return page.locator(".surfaceNavHome");
}

function sheet(page: Page) {
  return page.locator(".mobileSheetPortal");
}

async function openSheetFromTopBar(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: false }).first().click();
  await expect(sheet(page)).toBeVisible();
}

/**
 * Open the planner from the Layers section with ONE tap, then wait for the
 * planner's body. The phone sheet is sized to its content and anchored to the
 * bottom, and RoutePanel is a lazy chunk that mounts after the sheet opens. Until
 * it lands the sheet is short, so its arrival moves the header, Back and Home
 * included, and a tap begun before it ends on a different element and fires no
 * click. Retrying the tap instead was not safe: when the first tap landed late,
 * the retry opened a second planner on the trail, and Back then stepped from one
 * planner to the other instead of to the sheet that opened it.
 */
async function openPlannerFromSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Plan an outing" }).first().click();
  await expect(sheet(page)).toHaveAttribute("data-sheet-kind", "planner", {
    timeout: 30_000,
  });
  await expect(sheet(page).locator(".routePanel")).toBeVisible();
}

/**
 * Select the Layers section inside the map-controls sheet (hydration-safe tap),
 * then wait for its lazy MapLayersControl. That chunk mounts after the section
 * and grows the content-sized sheet upwards by several rows, so a "Plan an
 * outing" tap begun before it pressed the button and released on the Rail chip.
 */
async function selectLayersTab(page: Page): Promise<void> {
  const layersTab = page.getByRole("tab", { name: "Layers" });
  await expect(async () => {
    await layersTab.click();
    await expect(layersTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(sheet(page).locator(".mapLayersControl")).toBeVisible();
}

test.describe("every surface offers a way back and a way home", () => {
  test.use({ viewport: PHONE });

  test("the first sheet over the map has Home and no Back", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");

    await expect(home(page)).toHaveCount(1);
    await expect(back(page)).toHaveCount(0);
    // Home is the only control, so it names this sheet rather than a journey.
    await expect(home(page)).toHaveAccessibleName(/Close Map controls/i);
  });

  test("a second sheet gains a Back that names where it goes", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");
    await selectLayersTab(page);
    await openPlannerFromSheet(page);

    await expect(back(page)).toHaveCount(1);
    await expect(back(page)).toHaveAccessibleName("Back to Map controls");
    // Home stops claiming to close THIS sheet, because it closes them all.
    await expect(home(page)).toHaveAccessibleName(/Close and return to/i);
  });

  test("Back steps to the parent, Home leaves from any depth", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");
    await selectLayersTab(page);
    await openPlannerFromSheet(page);

    await back(page).click();
    // Back lands on the sheet that opened the planner, not on the map.
    await expect(sheet(page)).toHaveAttribute("data-sheet-kind", "layers");
    await expect(back(page)).toHaveCount(0);

    await home(page).click();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("Back restores the section the reader left, not a default", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");
    // Leave the sheet on a section that is NOT the one it opens on.
    await selectLayersTab(page);

    await openPlannerFromSheet(page);

    await back(page).click();
    await expect(sheet(page)).toHaveAttribute("data-sheet-kind", "layers");
    // The reader gets back what they had. Reopening on "Key" would be a
    // different sheet wearing the same name.
    await expect(page.getByRole("tab", { name: "Layers" })).toHaveAttribute("aria-selected", "true");
  });

  test("the browser's Back agrees with the Back arrow", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");
    await selectLayersTab(page);
    await openPlannerFromSheet(page);

    await page.goBack();
    await expect(sheet(page)).toHaveAttribute("data-sheet-kind", "layers");

    await page.goBack();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("Escape is the keyboard's Back, one level at a time", async ({ page }) => {
    await openPhoneMap(page);
    await openSheetFromTopBar(page, "More map controls");
    await selectLayersTab(page);
    await openPlannerFromSheet(page);

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveAttribute("data-sheet-kind", "layers");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
  });
});

test.describe("the desktop panels take the same pair", () => {
  test.use({ viewport: DESKTOP });

  test("the venue drawer's way out is quiet, and the planner has one at all", async ({ page }) => {
    await openMap(page);
    const planner = page.locator(".mapDrawer.left");
    // The same dropped-tap window as the phone helper above, on the desktop
    // drawer this time.
    await expect(async () => {
      await page.getByRole("button", { name: "Plan an outing" }).first().click();
      await expect(planner).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    // The planner head used to hold a grab handle and nothing else.
    await expect(planner.locator(".surfaceNavHome")).toHaveCount(1);

    // Finding 2.16: the way out may not shout louder than the pub's name, so
    // it carries no border and no fill at rest.
    const resting = await planner.locator(".surfaceNavHome").evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { border: style.borderTopWidth, background: style.backgroundColor };
    });
    expect(resting.border).toBe("0px");
    expect(resting.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });
});
