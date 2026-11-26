import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { legacyCheapestPriceRow, legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import type { Venue } from "@/lib/venues";

/** Canonical pint evidence shared by the generator and the slim data build. */
export function canonicalPintPriceInput(venue: Venue, now: number) {
  const cheapest = legacyCheapestPriceRow(venue.prices, venue.cheapestPrice);
  const publisher = cheapest && cheapest.source_datasets.trim() ? namedLegacyPintPriceSource(cheapest) : null;
  const pounds = comparableVenuePint(venue, null, false, now);
  const match = pounds === null ? null : /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(pounds));
  const pence = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
  return {
    pence: pence !== null && Number.isSafeInteger(pence) && pence > 0 ? pence : null,
    label: publisher?.label ?? null,
    url: publisher?.url ?? null,
    observedAt: cheapest ? legacyPintPriceObservedAt(cheapest, now) : null,
    datasets: publisher && cheapest ? cheapest.source_datasets : null,
  };
}
