import { DRINK_CATEGORIES, isDemoDrinkProvenance, type DrinkCategory } from "@/lib/drinks";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { venueMenuForInspector, venueMenuLookupKeys } from "@/lib/venueMenu";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { isPubVenue } from "@/lib/venueKindFilters";
import { authoritativeBundleRows, strongestBundleRow, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { selectedVenuePintEvidence } from "@/lib/comparableVenuePint";
import { measureFromServingSize } from "@/lib/drinkMeasure";
import type { Venue } from "@/lib/venues";

export type ListedDrinkCoverage = {
  total: number;
  pricedPubs: number;
  counts: Record<DrinkCategory, number>;
};

function pintServing(name: string | undefined, serving: string | undefined): boolean {
  return isComparablePintServing({ cheapestPint: name }) &&
    (serving === undefined || measureFromServingSize(serving) === "pint" || /^568 ?ml$/i.test(serving.trim()));
}

/** Count pub identities, never menu rows or a separate venue inventory. */
export function listedDrinkCoverage(
  venues: readonly Venue[],
  updates: readonly DrinkPriceUpdate[],
  bundleByVenue: ReadonlyMap<string, readonly UkPriceBundleRow[]> = new Map(),
  now: number = Date.now(),
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
    const scoped = venueMenuLookupKeys(venue).flatMap((key) => byKey.get(key) ?? []);
    const menu = venueMenuForInspector({ ...venue, prices: venue.prices.filter(isLivePriceRow) }, scoped);
    const categories = new Set<DrinkCategory>();
    for (const drink of menu) {
      if (!Number.isFinite(drink.priceGbp) || drink.priceGbp < 0 || isDemoDrinkProvenance(drink.provenance)) continue;
      if (drink.category !== "beer" || (
        drink.provenance.lane !== "dataset" && drink.priceGbp > 0 && pintServing(drink.name, drink.servingSize)
      )) categories.add(drink.category);
      if (drink.alcoholType === "low-no") categories.add("alcohol-free");
    }
    // The bundle reader owns source quarantine, measure rules and price age.
    const bundleRows = authoritativeBundleRows(bundleByVenue.get(venue.id) ?? []);
    for (const category of DRINK_CATEGORIES) {
      const decision = strongestBundleRow(bundleRows.filter((row) =>
        row.category === category && (category !== "beer" || pintServing(row.drinkLabel, row.servingSize))
      ), now);
      if (decision.standing === "listed") categories.add(category);
    }
    if (venue.prices.some((row) => isLivePriceRow(row) &&
      typeof row.price_gbp === "number" && Number.isFinite(row.price_gbp) && row.price_gbp > 0 &&
      isComparablePintServing({ measure: row.measure, cheapestPint: row.pint_name }))) categories.add("beer");
    const price = venue.cheapestPrice;
    if (typeof price === "number" && Number.isFinite(price) && price > 0 && isComparablePintServing(selectedVenuePintEvidence(venue))) categories.add("beer");
    if (categories.has("beer")) pricedPubs += 1;
    for (const category of categories) counts[category] += 1;
  }
  return { total: pubs.size, pricedPubs, counts };
}
