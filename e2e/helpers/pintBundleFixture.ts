import type { Page } from "@playwright/test";

type BundlePricesFixture = {
  listed?: {
    priceGbp: number;
    sourceUrl: string;
    observedAt: string;
  } | null;
  estimate?: {
    priceGbp: number;
    basis: string;
    sampleSize: number;
    computedAt: string;
  } | null;
};

/** A bundle-price scenario independent of the live harvest's contents. */
async function servePintBundleFixture(
  page: Page,
  venueId: string,
  bundlePrices: BundlePricesFixture,
): Promise<void> {
  await page.route(`**/api/venue/${venueId}*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (!response.ok() || !body.venue) {
      throw new Error("The venue fixture must retain a real venue response.");
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        venue: {
          ...body.venue,
          bundlePrices,
        },
      },
    });
  });
}

/** A published-price scenario independent of the live harvest's contents. */
export function serveListedPintFixture(page: Page, venueId: string): Promise<void> {
  return servePintBundleFixture(page, venueId, {
    listed: {
      priceGbp: 6.3,
      sourceUrl: "https://pub.example/menu",
      observedAt: new Date().toISOString().slice(0, 10),
    },
    estimate: null,
  });
}

/** An estimated-price scenario independent of the live harvest's contents. */
export function serveEstimatedPintFixture(page: Page, venueId: string): Promise<void> {
  return servePintBundleFixture(page, venueId, {
    listed: null,
    estimate: {
      priceGbp: 6.5,
      basis: "regional_baseline:camden",
      sampleSize: 1,
      computedAt: new Date().toISOString(),
    },
  });
}

/** A community-price scenario with no publisher or estimated price. */
export function serveNoPintBundleFixture(page: Page, venueId: string): Promise<void> {
  return servePintBundleFixture(page, venueId, {
    listed: null,
    estimate: null,
  });
}
