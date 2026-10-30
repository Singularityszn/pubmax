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

  // Turning it off gives every pin back.
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await expect(filtersButton).not.toHaveAttribute("aria-label", /last orders/);
  expect(errors).toEqual([]);
});

test("the desktop rail offers Last orders with its caption (1280x800)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.setFixedTime(FRIDAY_2245);
  await page.goto("/map?lastOrders=1");
  const toggle = page.getByLabel("Last orders: open 30 more minutes");
  // The rail lives behind the desktop filters door; reach it whichever way the
  // chrome shows it at this width.
  if (!(await toggle.isVisible().catch(() => false))) {
    const door = page.getByRole("button", { name: /^(Filters|More filters)/ }).first();
    await expect(door).toBeVisible({ timeout: 45_000 });
    await door.click();
  }
  await expect(toggle).toBeChecked({ timeout: 45_000 });
  await expect(page.getByText("Pubs with no listed hours are hidden.").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/last-orders/map-last-orders-1280x800.png" });
});
