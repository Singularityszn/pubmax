// The London day a pint-price row was last read at its source, for the build.
//
// Plain ESM with a .d.mts sidecar so scripts/build_slim_index.mjs can stamp the
// map index with the SAME day the app reads off a row
// (`legacyPintPriceObservedOn` in lib/drinks.ts, which
// __tests__/priceReadDay.test.ts holds this to, row for row). The day is the
// row's own: `scraped_at_values` is every read of that row, `|`-separated, and
// the latest one is the day it was last seen at its source. A row that records
// no read has no day, and a pin built from it cannot claim to be fresh
// (`priceAgeFor`, lib/priceTier.ts).

const LONDON_ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/London",
});

/** `YYYY-MM-DD` in London of the row's latest read, or null when it records none. */
export function priceRowReadDay(row) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of String(row?.scraped_at_values ?? "").split("|")) {
    const ms = Date.parse(value.trim());
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return Number.isFinite(latest) ? LONDON_ISO_DAY.format(new Date(latest)) : null;
}

/**
 * The read day behind a pub's cheapest live price: of the rows that carry that
 * figure, the most recent read, because the figure stands as long as any row
 * stating it is fresh. Null when none of them records a read.
 */
export function cheapestPriceReadDay(rows, cheapestPrice) {
  if (typeof cheapestPrice !== "number" || !Number.isFinite(cheapestPrice)) return null;
  let best = null;
  for (const row of rows) {
    if (typeof row?.price_gbp !== "number" || Math.abs(row.price_gbp - cheapestPrice) >= 0.005) continue;
    const day = priceRowReadDay(row);
    if (day && (best === null || day > best)) best = day;
  }
  return best;
}
