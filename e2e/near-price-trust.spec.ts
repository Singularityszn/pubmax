import { expect, test, type Page } from "@playwright/test";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("Near shows bounded price provenance without delaying the answer", async ({ page }) => {
  const errors = watchErrors(page);
  const trustRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/near-price-trust")) {
      trustRequests.push(request.url());
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax:analytics-consent:v1", "denied");
  });

  const response = await page.goto("/near?patch=soho");
  expect(response?.status()).toBe(200);
  const cards = page.locator(".nmnCard");
  await expect(cards).toHaveCount(5);

  // Prices are useful before the separate trust request settles.
  await expect(cards.first().locator(".nmnCardPriceValue")).toBeVisible();
  await expect(page.locator(".nmnCardTrust")).toHaveCount(5);
  await expect(page.locator(".nmnPriceCollected")).toHaveText(
    "Prices last collected 3 July 2026.",
  );

  expect(trustRequests).toHaveLength(1);
  const trustUrl = new URL(trustRequests[0]);
  expect(trustUrl.searchParams.getAll("venueId")).toHaveLength(5);
  expect(trustUrl.search).not.toMatch(/lat|lng|price|borough/i);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const firstRow = await cards.first().boundingBox();
  const tabBar = await page.locator(".mobileTabBar").boundingBox();
  expect(firstRow).not.toBeNull();
  expect(tabBar).not.toBeNull();
  const visibleHeight = Math.min(firstRow!.y + firstRow!.height, tabBar!.y) - firstRow!.y;
  expect(visibleHeight).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});
