import "server-only";

import {
  buildSubtypePricedVenueRows,
  countObservedSubtypePrices,
  SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
  type SubtypePricedVenueRow,
} from "@/lib/drinkSubtypeObservedPrice";
import { readCommunityPriceCategoryIndex } from "@/lib/communityPriceStore";
import type { CommunityPrice } from "@/lib/communityPrice";
import { findSubtype } from "@/lib/drinkSubtypes";
import { getLondonFoodIndex } from "@/lib/londonFoodIndex.server";
import {
  FOOD_PLACE_PRICE_CATEGORY,
  FOOD_PLACE_PRICE_SUBTYPE_ID,
  luciaMcDonaldsRows,
  type LuciaMcDonaldsSection,
} from "@/lib/londonFoodPlaces";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { allDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";

export type SoftDrinksWaterViewPayload = {
  subtypeId: string;
  subtypeLabel: string;
  rows: SubtypePricedVenueRow[];
  observedCounts: Record<string, number>;
  /** London McDonald's and their community price, on the Lucia 🐐 lens only. */
  mcdonalds: LuciaMcDonaldsSection | null;
};

/**
 * The McDonald's under the Lucia 🐐 lens. The counters come from the London
 * food pack; their figures from the soft-drink category index, which at a
 * counter only ever holds a Coke Zero or Diet Coke price because that is all
 * its write door admits (lib/londonFoodPlaces.ts). Fail soft, and say which
 * way it failed: a failed read is never "nobody has logged one".
 */
async function loadLuciaMcDonalds(): Promise<LuciaMcDonaldsSection> {
  const index = await getLondonFoodIndex();
  if (index.status === "unavailable") return { status: "unavailable", rows: [] };
  const places = [...index.byId.values()];
  const now = Date.now();
  try {
    const prices = await readCommunityPriceCategoryIndex([FOOD_PLACE_PRICE_CATEGORY], now);
    const byVenue = new Map<string, CommunityPrice[]>();
    for (const row of prices.prices) {
      if (!index.byId.has(row.venueId)) continue;
      byVenue.set(row.venueId, [...(byVenue.get(row.venueId) ?? []), row]);
    }
    return {
      status: prices.degraded ? "degraded" : prices.truncated ? "partial" : "ready",
      rows: luciaMcDonaldsRows(places, byVenue, now),
    };
  } catch {
    return { status: "degraded", rows: luciaMcDonaldsRows(places, new Map(), now) };
  }
}

export async function loadSoftDrinksWaterView(
  subtypeId: string,
): Promise<SoftDrinksWaterViewPayload | null> {
  const subtype = findSubtype(subtypeId);
  if (!subtype || subtype.category !== "soft-drink") return null;

  const [venues, drinkUpdates, { byVenue: bundleByVenue }, mcdonalds] = await Promise.all([
    loadPintPriceLandingVenues(),
    allDrinkPriceUpdates(),
    ukPriceBundleRowsByVenue(),
    subtype.id === FOOD_PLACE_PRICE_SUBTYPE_ID ? loadLuciaMcDonalds() : Promise.resolve(null),
  ]);

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
    mcdonalds,
  };
}
