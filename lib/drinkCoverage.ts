import type { DrinkCategory } from "@/lib/drinks";
import type { CategoryPriceIndexStatus, MapLensPrice } from "@/lib/mapExperienceLens";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export type DrinkCoverageCount = { count: number; total: number; status: CategoryPriceIndexStatus };

/** The spatial loader owns the scope, so these are loaded pubs, never London totals. */
export function mapDrinkCoverage(
  venues: readonly Venue[],
  category: DrinkCategory,
  prices: ReadonlyMap<string, MapLensPrice> | null,
  status: CategoryPriceIndexStatus,
): DrinkCoverageCount {
  const pubs = new Map(venues.filter(isPubVenue).map((venue) => [venue.id, venue]));
  let count = 0;
  for (const venue of pubs.values()) {
    if (category === "beer" ? typeof venue.cheapestPrice === "number" && Number.isFinite(venue.cheapestPrice) : prices?.has(venue.id)) count += 1;
  }
  return { count, total: pubs.size, status };
}
