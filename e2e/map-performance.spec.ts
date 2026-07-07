import { test, expect, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";

function watchRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });
  return requests;
}

function requested(requests: string[], fragment: string): boolean {
  return requests.some((url) => url.includes(fragment));
}

test("/map initial load uses slim pins without full or detail datasets", async ({ page }) => {
  const requests = watchRequests(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () =>
      page.evaluate(() => performance.getEntriesByName("pubmax:first-pins").length),
    )
    .toBeGreaterThan(0);

  expect(requested(requests, "/data/venues_slim.json")).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  expect(requested(requests, "/api/venue/")).toBe(false);
});

test("/map lazy-loads selected venue detail through the API", async ({ page }) => {
  const requests = watchRequests(page);

  const detailResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/venue/${SEED_VENUE_ID}`) && response.status() === 200,
  );
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await detailResponse;
  await expect(page.locator(".venueInspector")).toBeVisible({ timeout: 20_000 });

  expect(requested(requests, "/data/venues_slim.json")).toBe(true);
  expect(requested(requests, `/api/venue/${SEED_VENUE_ID}`)).toBe(true);
  expect(requested(requests, "/data/pint_prices_app_dataset.json")).toBe(false);
  expect(requested(requests, "/data/venue_detail_index.json")).toBe(false);
  expect(requested(requests, "/data/venue_details.jsonl")).toBe(false);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
});
