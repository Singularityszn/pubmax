import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

async function preparePhone(page: Page, reducedMotion = false): Promise<void> {
  await page.setViewportSize(MOBILE);
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test("route-ready area has one Plan action at phone width", async ({ page }) => {
  await preparePhone(page);
  const response = await page.goto("/area/clapham", { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
  const surface = page.locator("main[data-area-state]");
  await expect(surface).toHaveAttribute("data-area-state", "ready");
  await expect(surface.getByRole("heading", { name: "Plan a night in Clapham" })).toBeVisible();

  const primary = surface.locator("[data-primary-action='true']");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("href", "/plan?query=Plan+a+crawl+in+Clapham");
  await primary.focus();
  await expect(primary).toBeFocused();

  const box = await primary.boundingBox();
  expect(box?.height ?? 0, "primary action should be thumb-safe").toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("unready area stays browse-only", async ({ page }) => {
  await preparePhone(page);
  await page.goto("/area/barnes", { waitUntil: "domcontentloaded" });

  const surface = page.locator("main[data-area-state]");
  await expect(surface).toHaveAttribute("data-area-state", "browse");
  await expect(surface).toHaveAttribute("data-area-reason", "not-ready");
  await expect(surface.getByRole("heading", { name: "Browse Barnes" })).toBeVisible();
  await expect(surface.locator("[data-primary-action='true']")).toHaveAttribute("href", "/map?q=Barnes");
  await expect(surface.locator("[data-primary-action='true']")).not.toHaveAttribute("href", /\/plan/);
});

test("unknown area stays an honest Map browse", async ({ page }) => {
  await preparePhone(page);
  await page.goto("/area/new-town", { waitUntil: "domcontentloaded" });

  const surface = page.locator("main[data-area-state]");
  await expect(surface).toHaveAttribute("data-area-reason", "unknown");
  await expect(surface.getByRole("heading", { name: "Browse the map" })).toBeVisible();
  await expect(surface.locator("[data-primary-action='true']")).toHaveAttribute("href", "/map?q=New+town");
  await expect(surface).toContainText("We do not have a route page for this name yet.");
});

test("cross-city area data fails closed to that city's map", async ({ page }) => {
  await preparePhone(page);
  await page.goto("/area/clapham?city=manchester", { waitUntil: "domcontentloaded" });

  const surface = page.locator("main[data-area-state]");
  await expect(surface).toHaveAttribute("data-area-reason", "city-mismatch");
  await expect(surface.getByRole("heading", { name: "Open the Manchester map" })).toBeVisible();
  await expect(surface.locator("[data-primary-action='true']")).toHaveAttribute("href", "/map/manchester");
  await expect(surface.locator("[data-primary-action='true']")).not.toHaveAttribute("href", /\/plan/);
  await expect(surface.locator(".nightAreaActivationPage__evidence")).toHaveCount(0);
});

test("reduced motion keeps the browse action usable", async ({ page }) => {
  await preparePhone(page, true);
  await page.goto("/area/barnes", { waitUntil: "domcontentloaded" });

  const primary = page.locator("main[data-area-state] [data-primary-action='true']");
  await primary.focus();
  await expect(primary).toBeFocused();
  await expect.poll(() => primary.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
});

test("browser Back returns to the prior Night Area page", async ({ page }) => {
  await preparePhone(page);
  await page.goto("/area/barnes", { waitUntil: "domcontentloaded" });
  await page.goto("/area/clapham", { waitUntil: "domcontentloaded" });
  await page.goBack({ waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/area\/barnes$/);
  await expect(page.locator("main[data-area-reason='not-ready']")).toBeVisible();
});
