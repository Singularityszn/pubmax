import { firstHttp } from "./httpUrl.mjs";
import { priceRowReadDay } from "./priceReadDay.mjs";
import { isComparablePintServing, pintObservationTime } from "./comparablePint.mjs";

/** The last read of this price row, never the dataset collection stamp. */
export function legacyPintPriceObservedAt(price, now) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of String(price.scraped_at_values ?? "").split("|")) {
    const ms = pintObservationTime(value.trim(), now);
    if (ms !== null && ms > latest) latest = ms;
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

/** The row that carries the printed minimum figure. A pint wins a tie with a bottle or a half. */
export function legacyCheapestPriceRow(prices, cheapestPrice) {
  const rows = prices.filter((price) => price.price_gbp === cheapestPrice);
  return rows.find((price) => isComparablePintServing({ measure: price.measure ?? undefined, cheapestPint: price.pint_name }))
    ?? rows[0];
}

/** Minimal evidence from the same row as the printed minimum figure. */
export function legacyCheapestPriceEvidence(prices, cheapestPrice, now) {
  const row = legacyCheapestPriceRow(prices, cheapestPrice);
  if (!row || !Number.isFinite(cheapestPrice)) return {};
  const source = namedLegacyPintPriceSource(row);
  const observedAt = legacyPintPriceObservedAt(row, now);
  return {
    ...(row.pint_name ? { cheapestPint: row.pint_name } : {}),
    ...(row.measure != null ? { measure: row.measure } : {}),
    ...(source ? { priceSource: source.label } : {}),
    ...(observedAt ? { priceObservedAt: observedAt } : {}),
  };
}

/** London read day of the same first minimum row that names the publisher. */
export function legacyCheapestPriceReadDay(prices, cheapestPrice) {
  if (typeof cheapestPrice !== "number" || !Number.isFinite(cheapestPrice)) return null;
  const row = legacyCheapestPriceRow(prices, cheapestPrice);
  const observedAt = row ? legacyPintPriceObservedAt(row) : null;
  return observedAt ? priceRowReadDay({ scraped_at_values: observedAt }) : null;
}
