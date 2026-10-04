import { expect, test } from "@playwright/test";
import { desktopPlannerDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

for (const drink of ["beer", "wine", "gin"] as const) {
  test(`${drink} plan preserves its drink when shared and reopened`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
    const stops = "venue-149rmv7,venue-1vle947";
    const response = await page.goto(`/map?drink=${drink}&mode=build&pubs=${stops}`);
    expect(response?.status()).toBe(200);
    const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    const route = desktopPlannerDrawer(page).locator(".routePanel");
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    if (drink === "beer") {
      await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(route.locator(".routeList")).toContainText("AMSTEL");
      await expect(route.locator(".routeMetrics")).toContainText("£6.15");
      await expect(route.locator(".routeMetrics")).toContainText("known subtotal · 1 of 2 stops priced");
      await expect(route.locator(".routeMetrics")).not.toContainText("estimated round");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
    } else {
      await expect(route.getByRole("heading", { name: `${drink === "wine" ? "Wine" : "Gin"} plan`, exact: true })).toBeVisible();
      await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
      await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
    }
    await testInfo.attach("selected-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
    await route.getByRole("button", { name: "Start this crawl", exact: true }).click();
    const crawlProgress = route.getByTestId("crawl-progress");
    await crawlProgress.getByRole("button", { name: "Mark complete", exact: true }).click();
    await expect(
      crawlProgress.getByRole("status").filter({ hasText: /^Crawl complete: 2\/2 stops$/ }),
    ).toHaveText("Crawl complete: 2/2 stops");
    const shared = route.getByTestId("crawl-share-open");
    await expect(shared).toBeVisible();
    const href = await shared.getAttribute("href");
    const params = new URL(href!, "http://localhost").searchParams;
    expect(params.get("pubs")).toBe(stops);
    expect(params.get("drink")).toBe(drink === "beer" ? null : drink);
    await shared.click();
    await page.reload();
    expect(new URL(page.url()).searchParams.get("drink")).toBe(drink === "beer" ? null : drink);
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    await expect(route.locator(".routeList > li")).toHaveCount(2);
    await expect(route.locator(".routeList > li").nth(0)).toContainText("Duke of York");
    await expect(route.locator(".routeList > li").nth(1)).toContainText("The Sir Christopher Hatton");
    if (drink === "beer") {
      await expect(route.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
      await expect(route.locator(".routeList")).toContainText("AMSTEL");
      await expect(route.locator(".routeMetrics")).toContainText("£6.15");
      await expect(route.locator(".routeMetrics")).toContainText("known subtotal · 1 of 2 stops priced");
      await expect(route.locator(".routeMetrics")).not.toContainText("estimated round");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(1);
    } else {
      await expect(route.getByRole("heading", { name: `${drink === "wine" ? "Wine" : "Gin"} plan`, exact: true })).toBeVisible();
      await expect(route.locator(".routeMetrics")).toContainText("Not recorded");
      await expect(route.locator(".routeList")).not.toContainText("AMSTEL");
      await expect(route.getByRole("button", { name: "Save as story", exact: true })).toHaveCount(0);
    }
    await testInfo.attach("reopened-drink-plan", { body: await page.screenshot(), contentType: "image/png" });
  });
}
