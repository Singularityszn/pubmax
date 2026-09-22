import type { Page } from "@playwright/test";

/** A published-price scenario independent of the live harvest's contents. */
export async function serveListedPintFixture(page: Page, venueId: string): Promise<void> {
  await page.route(`**/api/venue/${venueId}*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (!response.ok() || !body.venue) throw new Error("The venue fixture must retain a real venue response.");
    await route.fulfill({
      response,
      json: {
        ...body,
        venue: {
          ...body.venue,
          bundlePrices: {
            ...body.venue.bundlePrices,
            listed: {
              priceGbp: 6.3,
              sourceUrl: "https://pub.example/menu",
              observedAt: new Date().toISOString().slice(0, 10),
            },
          },
        },
      },
    });
  });
}
