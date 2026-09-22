import "server-only";

import {
  buildSubtypePricedVenueRows,
  countObservedSubtypePrices,
  isZeroSugarColaFamilySubtypeId,
  SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS,
  ZERO_SUGAR_COLA_FAMILY,
  type SubtypePricedVenueRow,
} from "@/lib/drinkSubtypeObservedPrice";
import { findSubtype } from "@/lib/drinkSubtypes";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import {
  countBundleVenuesForSubtype,
  countBundleVenuesForZeroSugarColaFamily,
} from "@/lib/priceRowsBySubtype";
import { allDrinkPriceUpdates } from "@/lib/priceUpdates.server";
import { allUkPriceBundleRows } from "@/lib/ukPriceBundle.server";

export type SoftDrinksWaterViewPayload = {
  subtypeId: string;
  subtypeLabel: string;
  rows: SubtypePricedVenueRow[];
  observedCounts: Record<string, number>;
};

export async function loadSoftDrinksWaterView(
  subtypeId: string,
): Promise<SoftDrinksWaterViewPayload | null> {
  const subtype = findSubtype(subtypeId);
  if (!subtype || subtype.category !== "soft-drink") return null;

  const [venues, drinkUpdates, bundleRead] = await Promise.all([
    loadPintPriceLandingVenues(),
    allDrinkPriceUpdates(),
    allUkPriceBundleRows(),
  ]);

  const observedCounts: Record<string, number> = {};
  for (const id of SOFT_DRINKS_WATER_LAUNCH_SUBTYPE_IDS) {
    if (isZeroSugarColaFamilySubtypeId(id)) {
      const fromVenues = countObservedSubtypePrices(venues, id, drinkUpdates);
      const fromBundle =
        bundleRead.status === "ready"
          ? countBundleVenuesForZeroSugarColaFamily(bundleRead.rows, ZERO_SUGAR_COLA_FAMILY)
          : 0;
      observedCounts[id] = fromVenues + fromBundle;
      continue;
    }
    const fromVenues = countObservedSubtypePrices(venues, id, drinkUpdates);
    const fromBundle =
      bundleRead.status === "ready"
        ? countBundleVenuesForSubtype(bundleRead.rows, id)
        : 0;
    observedCounts[id] = fromVenues + fromBundle;
  }

  return {
    subtypeId: subtype.id,
    subtypeLabel: subtype.longLabel,
    rows: buildSubtypePricedVenueRows(venues, subtype.id, drinkUpdates),
    observedCounts,
  };
}
