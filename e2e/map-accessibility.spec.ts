import { expect, test, type Locator, type Page } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };

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

async function openVenueListWithKeyboard(page: Page): Promise<Locator> {
  const toggle = page.locator(".mapVenueListToggle");
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await tabTo(page, toggle);
  await page.keyboard.press("Enter");

  const firstVenue = page.locator(".mapVenueListItem").first();
  await expect(firstVenue).toBeFocused();
  return firstVenue;
}

test.describe("map keyboard and screen-reader venue path", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissFirstRunChrome(page);
  });

  test("tabs into venue list and opens a named venue without canvas hit-testing", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const firstVenue = await openVenueListWithKeyboard(page);
    const venueName = (await firstVenue.locator(".mapVenueListItemName").innerText()).trim();
    const accessibleName = await firstVenue.getAttribute("aria-label");

    expect(venueName.length).toBeGreaterThan(0);
    expect(accessibleName).toBeNull();
    await expect(firstVenue).toContainText(/Pub|Bar|Late food|Restaurant/);
    await expect(firstVenue).toContainText(/£|Price|no price/i);

    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(venueName);
  });

  test("updates open venue list after map movement and a venue-kind filter", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await openVenueListWithKeyboard(page);

    const rows = page.locator(".mapVenueListItem");
    const beforeMove = await rows.count();
    expect(beforeMove).toBeGreaterThan(0);

    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();

    await expect
      .poll(() => rows.count(), { timeout: 20_000 })
      .toBeLessThan(beforeMove);

    const beforeFilter = await rows.count();
    const bars = page.getByRole("button", { name: "Bars", exact: true });
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => rows.count()).toBeLessThan(beforeFilter);
  });

  test("keeps desktop drawer focus inside and restores chosen venue on Escape", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const chosenVenue = await openVenueListWithKeyboard(page);
    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    const closeButton = drawer.getByRole("button", { name: /Close/ });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(closeButton).toBeFocused();

    const lastFocusable = drawer.locator(
      'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
    ).last();
    await lastFocusable.focus();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(lastFocusable).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(chosenVenue).toBeFocused();
  });
});
