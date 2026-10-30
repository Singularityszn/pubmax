import "server-only";

// The loader behind `pricedPubCount` (lib/pricedPubCount.ts). /about and
// /pint-index both call THIS, so the two pages print one number from one read
// of the pub list, the drink-price updates and the published-menu bundle.

import { listedDrinkCoverage, type ListedDrinkCoverage } from "@/lib/listedDrinkCoverage";
import { pricedPubCountFromCoverage, type PricedPubCount } from "@/lib/pricedPubCount";
import { readAllDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { loadGroupedVenues } from "@/lib/venueDataset";
import type { Venue } from "@/lib/venues";

export type PricedPubCountRead = {
  count: PricedPubCount;
  /** The per-drink coverage the count is read from (/pint-index prints it). */
  coverage: ListedDrinkCoverage;
  /** "partial" when the updates or the menu bundle could not be read. */
  status: "ready" | "partial" | "degraded";
};

export async function loadPricedPubCount(
  venuesIn?: readonly Venue[],
): Promise<PricedPubCountRead> {
  const [venues, updates, bundle] = await Promise.all([
    venuesIn ? Promise.resolve(venuesIn) : loadGroupedVenues(),
    readAllDrinkPriceUpdates(),
    ukPriceBundleRowsByVenue(),
  ]);
  const coverage = listedDrinkCoverage(venues, updates ?? [], bundle.byVenue);
  const count = pricedPubCountFromCoverage(coverage);
  const status =
    venues.length === 0
      ? "degraded"
      : updates === null || bundle.status === "unavailable"
        ? "partial"
        : "ready";
  return { count, coverage, status };
}
