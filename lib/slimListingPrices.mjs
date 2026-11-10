import { comparablePint } from "./comparablePint.mjs";
import { isHttpUrl } from "./httpUrl.mjs";
import { priceRowReadDay } from "./priceReadDay.mjs";

export function applySlimListingPrices(slim, bundleRows, now = Date.now()) {
  const unpriced = new Map(slim.filter((row) => row.cheapestPrice === null).map((row) => [row.id, row]));
  for (const row of bundleRows) {
    const venue = unpriced.get(row?.venueId);
    if (!venue || row.lane !== "listing-site" || row.standing !== "listed" || row.category !== "beer") continue;
    if (typeof row.servingSize !== "string" || row.servingSize.toLowerCase() !== "pint") continue;
    if (typeof row.drinkLabel !== "string" || !row.drinkLabel.trim() || !isHttpUrl(row.sourceUrl)) continue;
    const price = {
      cheapestPrice: row.priceGbp,
      cheapestPint: row.drinkLabel,
      measure: "pint",
      priceSource: row.publisher,
      priceObservedAt: row.observedAt,
    };
    if (comparablePint(price, now) === null) continue;
    price.priceObservedAt = priceRowReadDay({ scraped_at_values: row.observedAt });
    if (venue.cheapestPrice === null || price.cheapestPrice < venue.cheapestPrice) Object.assign(venue, price);
  }
}
