import { expect, test, type TestInfo } from "@playwright/test";

import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";

const VIEW_PATH = "/soft-drinks-and-water";
const COLLECTED_DAY = formatObservedDate(PINT_DATASET_OBSERVED_AT);

test.describe("Soft drinks and water view", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "{}",
      }),
    );
    await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
    await page.addInitScript(() => {
      if (!localStorage.getItem("pubmax-theme")) localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    });
  });

  test("shows chips, a priced row with date when data exists, and the no-price door", async ({
    page,
  }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(VIEW_PATH);

    await expect(page.getByRole("heading", { name: "Soft drinks and water" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Zero-sugar cola", selected: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Still water" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Coke Zero" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Diet Coke" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Pepsi Max" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Diet Pepsi" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Still water" }).click();
    await page.getByRole("tab", { name: "Zero-sugar cola" }).click();

    const pricedMeta = page.locator(".softDrinksWater__meta", {
      hasText: `Collected ${COLLECTED_DAY}`,
    });
    const pricedCount = await pricedMeta.count();
    if (pricedCount > 0) {
      await expect(pricedMeta.first()).toBeVisible();
      await expect(page.locator(".softDrinksWater__price").first()).toBeVisible();
      await expect(page.getByText("No price yet", { exact: false }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "add one" }).first()).toBeVisible();
    } else {
      await expect(page.getByText("Nobody has logged one here yet.")).toBeVisible();
    }

    if (process.env.PW_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath("soft-drinks-water-390.png"),
        fullPage: true,
      });
    }
  });


  test("zero observed count shows one empty state instead of no-price rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${VIEW_PATH}?sub=soft-drink-coke-zero`);
    await expect(page).toHaveURL(/sub=soft-drink-zero-sugar-cola/);
    await expect(page.getByRole("heading", { name: "Soft drinks and water" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Zero-sugar cola", selected: true })).toBeVisible();
    const ledeText = (await page.locator(".screenLede").textContent()) ?? "";
    if (/No listed .* prices in London yet/.test(ledeText)) {
      await expect(page.getByText("Nobody has logged one here yet.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Add a price" })).toBeVisible();
      await expect(page.locator(".softDrinksWater__door")).toHaveCount(0);
    }
  });

  test("content inset matches Screen gutter at 390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(VIEW_PATH);
    const inset = await page.evaluate(() => {
      const screen = document.querySelector(".softDrinksWater__screen.screen");
      const title = document.querySelector("#soft-drinks-water-heading");
      if (!screen || !title) return null;
      const screenBox = screen.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      return Math.round(titleBox.left - screenBox.left);
    });
    expect(inset).not.toBeNull();
    expect(inset!).toBeLessThanOrEqual(24);
    expect(inset!).toBeGreaterThanOrEqual(18);
  });

  test("desktop width keeps chips and list readable", async ({ page }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${VIEW_PATH}?sub=soft-drink-diet-coke`);
    await expect(page).toHaveURL(/sub=soft-drink-zero-sugar-cola/);
    await expect(page.getByRole("tab", { name: "Zero-sugar cola", selected: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the map" }).first()).toBeVisible();

    if (process.env.PW_SCREENSHOTS === "1") {
      await page.screenshot({
        path: testInfo.outputPath("soft-drinks-water-1440.png"),
        fullPage: true,
      });
    }
  });
});
