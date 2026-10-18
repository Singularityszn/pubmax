import { firstHttp } from "./httpUrl.mjs";

/** The last read of this price row, never the dataset collection stamp. */
export function legacyPintPriceObservedAt(price) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of String(price.scraped_at_values ?? "").split("|")) {
    const ms = Date.parse(value.trim());
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

/** The publisher named by the price record itself. */
export function namedLegacyPintPriceSource(price) {
  const url = firstHttp(price.pub_url);
  if (!url) return null;
  const hostname = new URL(url).hostname.toLocaleLowerCase("en-GB");
  const label = hostname === "pint-prices.com" || hostname.endsWith(".pint-prices.com")
    ? "Pint Prices"
    : hostname.replace(/^www\./, "");
  return { label, url };
}

/** Minimal evidence from the same row as the printed minimum figure. */
export function legacyCheapestPriceEvidence(prices, cheapestPrice) {
  const row = prices.find((price) => price.price_gbp === cheapestPrice);
  if (!row || !Number.isFinite(cheapestPrice)) return {};
  const source = namedLegacyPintPriceSource(row);
  const observedAt = legacyPintPriceObservedAt(row);
  return {
    ...(source ? { priceSource: source.label } : {}),
    ...(observedAt ? { priceObservedAt: observedAt } : {}),
  };
}
