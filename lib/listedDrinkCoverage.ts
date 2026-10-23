import { DRINK_CATEGORIES, isDemoDrinkProvenance, type DrinkCategory } from "@/lib/drinks";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { venueMenuForInspector, venueMenuLookupKeys } from "@/lib/venueMenu";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

export type ListedDrinkCoverage = {
  total: number;
  pricedPubs: number;
  counts: Record<DrinkCategory, number>;
};

/** Count pub identities, never menu rows or a separate venue inventory. */
export function listedDrinkCoverage(
  venues: readonly Venue[],
  updates: readonly DrinkPriceUpdate[],
): ListedDrinkCoverage {
  const pubs = new Map(venues.filter(isPubVenue).map((venue) => [venue.id, venue]));
  const counts = Object.fromEntries(DRINK_CATEGORIES.map((category) => [category, 0])) as Record<DrinkCategory, number>;
  const byKey = new Map<string, DrinkPriceUpdate[]>();
  for (const row of updates) {
    const list = byKey.get(row.venueKey) ?? [];
    list.push(row);
    byKey.set(row.venueKey, list);
  }
  let pricedPubs = 0;
  for (const venue of pubs.values()) {
    if (typeof venue.cheapestPrice === "number" && Number.isFinite(venue.cheapestPrice)) pricedPubs += 1;
    const scoped = venueMenuLookupKeys(venue).flatMap((key) => byKey.get(key) ?? []);
    const menu = venueMenuForInspector({ ...venue, prices: venue.prices.filter(isLivePriceRow) }, scoped);
    const categories = new Set<DrinkCategory>();
    for (const drink of menu) {
      if (!Number.isFinite(drink.priceGbp) || drink.priceGbp < 0 || isDemoDrinkProvenance(drink.provenance)) continue;
      categories.add(drink.category);
      if (drink.alcoholType === "low-no") categories.add("alcohol-free");
    }
    for (const category of categories) counts[category] += 1;
  }
  // A menu beer can be a bottle or a half. The pint lane owns the pint count.
  counts.beer = pricedPubs;
  return { total: pubs.size, pricedPubs, counts };
}

