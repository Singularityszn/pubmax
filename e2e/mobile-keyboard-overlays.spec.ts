import { expect, test, type Page } from "@playwright/test";

import { COMMUNITY_SHEET_FIXTURE_MAP_PATH } from "./helpers/communitySheetFixture";

test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  serviceWorkers: "block",
});
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
});

async function expectDockOwnsBottom(page: Page) {
  await expect(page.locator(".mobileTabBar")).toHaveCSS("opacity", "1");
  const report = await page.evaluate(() => {
    const sheet = document.querySelector(".mobileSharedSheet")!.getBoundingClientRect();
    const nav = document.querySelector(".mobileTabBar")!;
    const band = getComputedStyle(nav, "::before");
    const tab = nav.querySelector("a")!;
    const t = tab.getBoundingClientRect();
    const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    const bandTop = nav.getBoundingClientRect().bottom - Number.parseFloat(band.height);
    return {
      sheetTop: sheet.top,
      sheetBottom: sheet.bottom,
      bandTop,
      bandPaint: band.backgroundColor,
      gapOwner: Boolean(document.elementFromPoint(5, sheet.bottom + 2)?.closest(".mobileTabBar")),
      tabOwnsTap: hit?.closest("a") === tab,
      inert: Boolean(tab.closest("[inert]")),
    };
  });
  expect(report.sheetTop).toBeGreaterThanOrEqual(0);
  expect(Math.abs(report.sheetBottom - report.bandTop)).toBeLessThan(2);
  expect(report.bandPaint).not.toBe("rgba(0, 0, 0, 0)");
  expect(report.gapOwner).toBe(true);
  expect(report.tabOwnsTap).toBe(true);
  expect(report.inert).toBe(false);
}

for (const width of [320, 412, 430]) {
  test(`${width}px filters fit and leave an opaque, usable dock`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.goto("/map");
    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(async () => {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await expect(portal).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expectDockOwnsBottom(page);
    await expect(portal.locator(".mapExperienceLensHead small")).toBeInViewport({ ratio: 1 });
    const overflow = await portal.locator(".mobileMapFilters").evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(portal.locator('.mobileMapSavedOnly input')).toHaveCSS("width", "24px");
    await portal.locator(".mobileSharedSheetDetent").click();
    const lastDrink = portal.getByRole("button", { name: "Soft drinks", exact: true });
    await lastDrink.scrollIntoViewIfNeeded();
    await expect(lastDrink).toBeInViewport();
    const fits = await lastDrink.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const body = element.closest(".mobileSharedSheetBody")!.getBoundingClientRect();
      return box.top >= body.top && box.bottom <= body.bottom + 1;
    });
    expect(fits).toBe(true);
    await expectDockOwnsBottom(page);
    await page.locator('.mobileTabBar a[aria-label="Tonight"]').click();
    await expect(page).toHaveURL(/\/tonight$/);
  });
}

test("venue and planner sheets preserve primary navigation and Enter submits", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  await page.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="venue"]')).toBeVisible();
  await expectDockOwnsBottom(page);
  await page.locator(".mobileSheetPortal .surfaceNavHome").click();
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(async () => {
    await page.getByRole("button", { name: "Describe the outing" }).click();
    await expect(planner).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expectDockOwnsBottom(page);
  const query = page.locator("#mobile-plan-query");
  await expect(query).toHaveAttribute("enterkeyhint", "go");
  await query.fill("Quiet in Soho");
  await planner.getByPlaceholder("£").fill("22.50");
  const request = page.waitForRequest((req) => req.url().includes("/api/plans/generate") && req.method() === "POST");
  await query.press("Enter");
  const body = (await request).postDataJSON();
  expect(body.query).toBe("Quiet in Soho");
  expect(body.context.budgetLimitPence).toBe(2250);
});

test("create menu owns outside taps and leaves compose routes clear", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  await page.goto("/tonight");
  const trigger = page.getByTestId("create-fab");
  await expect(async () => {
    await trigger.click();
    await expect(page.locator(".createFabMenu")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(trigger).toHaveAttribute("aria-label", "Close create menu");
  const scrimOwnsTap = await page.evaluate(() => document.elementFromPoint(10, 200)?.classList.contains("createFabScrim"));
  expect(scrimOwnsTap).toBe(true);
  await page.mouse.click(10, 200);
  await expect(page.locator(".createFabMenu")).toHaveCount(0);
  for (const path of ["/moment", "/plan"]) {
    await page.goto(path);
    await expect(page.locator(".createFabRoot")).toHaveCount(0);
  }
});
