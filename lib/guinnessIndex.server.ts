import "server-only";
import { comparablePint } from "@/lib/comparablePint.mjs";
import { drinkBrandCandidateForVenue, findDrinkBrandLandingBrand } from "@/lib/drinkBrandLanding";
import { legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/drinks";
import { buildGuinnessIndex, type GuinnessIndexRow } from "@/lib/guinnessIndex";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

export async function loadGuinnessIndex() {
  const brand = findDrinkBrandLandingBrand("guinness");
  if (!brand) return buildGuinnessIndex([]);
  const venues = await loadPintPriceLandingVenues();
  const rows = venues.flatMap((venue): GuinnessIndexRow[] => {
    const prices = venue.prices.filter((price) =>
      !/\b(?:0[.,]0|alcohol[ -]?free|non[ -]?alcoholic)\b/i.test(price.pint_name) &&
      comparablePint({ cheapestPrice: price.price_gbp, priceSource: namedLegacyPintPriceSource(price)?.label, priceObservedAt: legacyPintPriceObservedAt(price), cheapestPint: price.pint_name, measure: price.measure }) !== null,
    );
    const candidate = drinkBrandCandidateForVenue({ ...venue, prices }, brand);
    if (!candidate?.publisher || !candidate.observedAt) return [];
    return [{ ...candidate, publisher: candidate.publisher, observedAt: candidate.observedAt }];
  });
  return buildGuinnessIndex(rows);
}
