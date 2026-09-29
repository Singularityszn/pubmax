import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function returningVisitor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const width of [390, 768, 1440]) {
  test(`Manchester map fills ${width}x900 without a blank document tail`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await returningVisitor(page);
    await page.goto("/map/manchester");
    await expect(page.locator(".mapStage")).toBeVisible();
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerHeight,
      document: document.documentElement.scrollHeight,
      bodyPadding: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
      stageBottom: document.querySelector(".mapStage")?.getBoundingClientRect().bottom,
    }));
    await page.screenshot({ path: testInfo.outputPath(`manchester-map-${width}.png`) });

    expect(dimensions.stageBottom).toBeCloseTo(dimensions.viewport, 0);
    expect(dimensions.bodyPadding).toBe(0);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

test("Places final city remains scrollable above mobile create control", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await returningVisitor(page);
  await page.goto("/places");
  const lastCity = page.locator(".placesCityLink").last();
  await expect(lastCity).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const geometry = await page.evaluate(() => {
    const last = document.querySelectorAll(".placesCityLink").item(
      document.querySelectorAll(".placesCityLink").length - 1,
    )?.getBoundingClientRect();
    const fab = document.querySelector(".createFabRoot")?.getBoundingClientRect();
    return {
      lastBottom: last?.bottom ?? Infinity,
      fabTop: fab?.top ?? -Infinity,
      padding: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    };
  });
  await page.screenshot({ path: testInfo.outputPath("places-bottom-clearance.png") });
  expect(geometry.padding).toBeGreaterThan(64);
  expect(geometry.lastBottom).toBeLessThan(geometry.fabTop);
});
