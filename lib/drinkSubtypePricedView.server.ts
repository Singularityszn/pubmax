import "server-only";

import {
  buildSubtypePricedVenueRows,
  countObservedSubtypePrices,
  SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
  type SubtypePricedVenueRow,
} from "@/lib/drinkSubtypeObservedPrice";
import { findSubtype } from "@/lib/drinkSubtypes";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { allDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";

export type SoftDrinksWaterViewPayload = {
  subtypeId: string;
  subtypeLabel: string;
  rows: SubtypePricedVenueRow[];
  observedCounts: Record<string, number>;
  /**
   * True when the UK price bundle could not be read. The listed prices are
   * missing, not absent, and the view must not word zero as "nobody has one".
   */
  listedPricesUnavailable: boolean;
};

export async function loadSoftDrinksWaterView(
  subtypeId: string,
): Promise<SoftDrinksWaterViewPayload | null> {
  const subtype = findSubtype(subtypeId);
  if (!subtype || subtype.category !== "soft-drink") return null;

  const [venues, drinkUpdates, bundle] = await Promise.all([
    loadPintPriceLandingVenues(),
    allDrinkPriceUpdates(),
    ukPriceBundleRowsByVenue(),
  ]);

  const bundleByVenue = bundle.byVenue;
  const observedCounts: Record<string, number> = {};
  const countIds = new Set<string>([...SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS, subtype.id]);
  for (const id of countIds) {
    observedCounts[id] = countObservedSubtypePrices(venues, id, drinkUpdates, bundleByVenue);
  }

  return {
    subtypeId: subtype.id,
    subtypeLabel: subtype.longLabel,
    rows: buildSubtypePricedVenueRows(venues, subtype.id, drinkUpdates, undefined, bundleByVenue),
    observedCounts,
    listedPricesUnavailable: bundle.status === "unavailable",
  };
}
