import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const digest = "abcdefghijklmnopqrstuv";
const shardPath = "/data/venues_slim.cell.51.500_-0.150.json";
const venueId = "venue-return-fixture";
const sourceUrl = "https://pint-prices.com/pub/return-fixture";

async function expectSelectedEvidence(page: Page) {
  const card = page.getByTestId("tonight-answer-cheapest");
  await expect(card).toHaveAttribute("data-basis", "area");
  await expect(card).toContainText("The Return Arms");
  await expect(card).toContainText("£3.25");
  await expect(card).toContainText("Fixture Ale · pint");
  await expect(card.getByRole("link", { name: "Pint Prices" })).toHaveAttribute("href", sourceUrl);
  await expect(card.locator("time")).toHaveText("15 Jan 2025");
  await expect(card).not.toContainText("Other Ale");
}

test("Tonight retains the nearby winner and its evidence after an in-app return", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax:nightPatch:v1", JSON.stringify({ kind: "patch", id: "soho" }));
    localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  let shardReads = 0;
  await page.route("**/data/venues_slim.manifest.json*", async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    await route.fulfill({ json: {
      ...manifest,
      priceDatasetDigest: digest,
      shards: [{ id: "return-fixture", core: false, partition: "grid", url: shardPath,
        count: 1, bbox: [-0.15, 51.5, -0.125, 51.525] }],
    } });
  });
  await page.route(`**${shardPath}*`, async (route) => {
    shardReads += 1;
    const revision = new URL(route.request().url()).searchParams.get("v") ?? "local";
    await route.fulfill({ json: { revision, d: digest, rows: [{
      id: venueId, name: "The Return Arms", lat: 51.5136, lng: -0.1365,
      borough: "Westminster", cheapestPrice: 3.25, priceSource: "Pint Prices",
      priceObservedAt: "2025-01-15", measure: "pint",
    }] } });
  });
  await page.route(`**/api/venue/${venueId}`, (route) => route.fulfill({ json: {
    priceDatasetDigest: digest,
    venue: { id: venueId, prices: [
      { price_gbp: 3.25, pint_name: "Fixture Ale", measure: "pint", pub_url: sourceUrl, scraped_at_values: "2025-01-15" },
      { price_gbp: 3.25, pint_name: "Other Ale", measure: "pint", pub_url: "https://example.com/other", scraped_at_values: "2024-01-02" },
    ] },
  } }));

  await page.goto("/tonight");
  await expectSelectedEvidence(page);
  expect(shardReads).toBe(1);
  await page.evaluate(() => { (window as Window & { returnMarker?: string }).returnMarker = "same-document"; });

  await page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Tonight", exact: true }).click();
  await expect(page).toHaveURL(/\/tonight$/);
  expect(await page.evaluate(() => (window as Window & { returnMarker?: string }).returnMarker)).toBe("same-document");
  await expectSelectedEvidence(page);
  expect(shardReads).toBe(1);
});
