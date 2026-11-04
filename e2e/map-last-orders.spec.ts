import { expect, test } from "@playwright/test";

// The map's Last orders filter at a frozen 22:45 on a Friday in London. The
// door off Tonight is `/map?lastOrders=1`; it arrives with the filter on, the
// Filters chip names it, and the pins narrow to pubs whose OpenStreetMap hours
// run 30 more minutes. Only curated pins can pass (the unpriced base layer is
// hidden), and the hours pack links 245 of them, so the count is bounded.

const FRIDAY_2245 = new Date("2026-10-30T22:45:00Z");
const CURATED_PINS_WITH_HOURS = 245;

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("the map arrives with Last orders on and narrows to pubs still open (390x844)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(FRIDAY_2245);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/map?lastOrders=1");
  expect(response?.status()).toBe(200);

  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await expect(filtersButton).toHaveAttribute("aria-label", /last orders/);
  // Dark at night by default for a reader who never chose a theme.
  await expect(page.locator("html")).toHaveAttribute("data-night-theme", "1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/last-orders/map-last-orders-390x844.png" });

  await filtersButton.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  const choice = sheet.getByRole("button", { name: "Last orders", exact: true });
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(sheet).toContainText("Pubs with no listed hours are hidden.");

  const status = sheet.getByRole("status").filter({ hasText: /matching/ });
  await expect(status).toContainText(/\d+ matching (place|places) loaded on the map/, { timeout: 30_000 });
  const count = Number(/([\d,]+) matching/.exec((await status.innerText()) ?? "")?.[1]?.replace(/,/g, ""));
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(CURATED_PINS_WITH_HOURS);
  await page.screenshot({ path: "artifacts/last-orders/map-last-orders-filters-390x844.png" });

  // Turning it off gives every pin back. The night theme is the whole
  // page's, not the filter's, so the map stays dark.
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await expect(filtersButton).not.toHaveAttribute("aria-label", /last orders/);
  await expect(page.locator("html")).toHaveAttribute("data-night-theme", "1");
  expect(errors).toEqual([]);
});

test("the desktop filters offer Last orders with its caption (1280x800)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.setFixedTime(FRIDAY_2245);
  await page.goto("/map?lastOrders=1");
  const door = page.getByRole("button", { name: /^Filters/ }).first();
  await expect(door).toBeVisible({ timeout: 45_000 });
  await expect(door).toHaveAttribute("aria-label", /1 filter on, pub features/);
  if ((await door.getAttribute("aria-expanded")) !== "true") await door.click();
  const features = page.getByRole("region", { name: "Pub features" });
  await expect(features.getByRole("button", { name: "Last orders", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(features).toContainText("Pubs with no listed hours are hidden.");
  await page.screenshot({ path: "artifacts/last-orders/map-last-orders-1280x800.png" });
});

// While the hours are on their way the filter hides every pin it cannot vouch
// for and says it is loading; it never shows the unfiltered map under the
// "open 30 more minutes" caption. Covered for both doors: the address, and the
// chip on a map that was already open.
//
// The service worker is blocked for these two: page.route cannot see a request
// a service worker makes, and by the time the chip is tapped the worker has
// taken the page, so the hold would silently not hold.
test.describe("with the hours held back", () => {
  test.use({ serviceWorkers: "block" });

  async function holdHours(page: import("@playwright/test").Page): Promise<() => void> {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/data/last_orders/london_hours.json", async (route) => {
      await gate;
      await route.continue();
    });
    return release;
  }

  async function openFilters(page: import("@playwright/test").Page) {
    const filtersButton = page.getByRole("button", { name: /^Filters/ });
    await expect(filtersButton).toBeVisible({ timeout: 45_000 });
    await filtersButton.click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet).toBeVisible();
    return sheet;
  }

  test("arriving by address with the hours delayed shows loading, never the unfiltered map", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(FRIDAY_2245);
    const release = await holdHours(page);
    await page.goto("/map?lastOrders=1");
    const sheet = await openFilters(page);
    await expect(sheet.getByRole("button", { name: "Last orders", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.getByRole("status").filter({ hasText: /matching|Loading/ })).toHaveText("Loading matching places…");
    // Held for a while: still loading, still no count.
    await page.waitForTimeout(3_000);
    await expect(sheet.getByRole("status").filter({ hasText: /matching|Loading/ })).toHaveText("Loading matching places…");
    release();
    const status = sheet.getByRole("status").filter({ hasText: /matching places? loaded/ });
    await expect(status).toBeVisible({ timeout: 30_000 });
    const count = Number(/([\d,]+) matching/.exec(await status.innerText())?.[1]?.replace(/,/g, ""));
    expect(count).toBeLessThanOrEqual(CURATED_PINS_WITH_HOURS);
  });

  test("turning the chip on with the hours delayed shows loading, never the unfiltered map", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(FRIDAY_2245);
    const release = await holdHours(page);
    await page.goto("/map");
    const sheet = await openFilters(page);
    await sheet.getByRole("button", { name: "Last orders", exact: true }).click();
    await expect(sheet.getByRole("status").filter({ hasText: /matching|Loading/ })).toHaveText("Loading matching places…");
    await page.waitForTimeout(3_000);
    await expect(sheet.getByRole("status").filter({ hasText: /matching|Loading/ })).toHaveText("Loading matching places…");
    release();
    await expect(sheet.getByRole("status").filter({ hasText: /matching places? loaded/ })).toBeVisible({ timeout: 30_000 });
  });
});
