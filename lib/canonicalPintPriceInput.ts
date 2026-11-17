import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { legacyPintPriceObservedAt } from "@/lib/legacyPriceEvidence.mjs";
import type { Venue } from "@/lib/venues";

/** Canonical pint evidence shared by the generator and the slim data build. */
export function canonicalPintPriceInput(venue: Venue, now: number) {
  const cheapest = venue.prices.find((row) => row.price_gbp === venue.cheapestPrice);
  const attributed = cheapest && cheapest.source_datasets.trim()
    && (cheapest.pub_url.trim() || cheapest.constructed_pub_url.trim());
  const pounds = comparableVenuePint(venue, null, false, now);
  const match = pounds === null ? null : /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(pounds));
  const pence = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
  return {
    pence: pence !== null && Number.isSafeInteger(pence) && pence > 0 ? pence : null,
    label: attributed ? "Pint Prices" : null,
    url: attributed ? cheapest.pub_url.trim() || cheapest.constructed_pub_url.trim() : null,
    observedAt: cheapest ? legacyPintPriceObservedAt(cheapest, now) : null,
    datasets: attributed ? cheapest.source_datasets : null,
  };
}
