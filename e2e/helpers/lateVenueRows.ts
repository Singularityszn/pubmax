import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

/**
 * Real answers for the two late Overview rows a pin's own pub does not have.
 *
 * The Spoons value row and the "What it used to cost" row render only for a
 * Wetherspoons in the Spoons ranking and for a pub with a dated price in the
 * history file. A layout pin that needs every late row on screen opens one pub,
 * so it borrows both answers for it: the route's own answer for the first
 * ranked Wetherspoons in the committed pack, and the first committed history
 * observation, each relabelled to `venueId`. Nothing here is typed by hand, so
 * a change to either shape reaches the pin as a missing row rather than a
 * fixture that has drifted from the product.
 */
export async function routeLateVenueRows(page: Page, venueId: string, venueName: string): Promise<void> {
  const pack = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "spoonme", "rows.json"), "utf8"),
  ) as { rows: Array<{ venueId?: string }> };
  const donor = pack.rows.find((row) => row.venueId?.startsWith("venue-"))?.venueId;
  if (!donor) throw new Error("The Spoons value pack names no curated venue to borrow a row from.");

  await page.route(`**/api/spoons-value?venueId=${venueId}`, async (route) => {
    const donorUrl = new URL(route.request().url());
    donorUrl.searchParams.set("venueId", donor);
    await route.fulfill({ response: await route.fetch({ url: donorUrl.toString() }) });
  });

  // The context, not the page: the service worker answers `/data/` files (it
  // passes only `/api/` through), and page.route never sees a request the
  // worker makes. A context route does, in Chromium.
  await page.context().route("**/data/price_history/london.json", async (route) => {
    const response = await route.fetch();
    const file = (await response.json()) as { observations: Array<Record<string, unknown>> };
    const [first] = file.observations;
    if (!first) throw new Error("The price history file holds no observation to borrow.");
    file.observations = [...file.observations, { ...first, venueId, venueName }];
    await route.fulfill({ response, json: file });
  });
}
