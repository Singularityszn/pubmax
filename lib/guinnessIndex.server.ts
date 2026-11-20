import "server-only";
import { comparablePint } from "@/lib/comparablePint.mjs";
import { drinkBrandCandidateForVenue, findDrinkBrandLandingBrand, selectDrinkBrandPriceForVenue } from "@/lib/drinkBrandLanding";
import { buildGuinnessIndex, type GuinnessIndexRow } from "@/lib/guinnessIndex";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

export async function loadGuinnessIndex() {
  const brand = findDrinkBrandLandingBrand("guinness");
  if (!brand) return buildGuinnessIndex([]);
  const venues = await loadPintPriceLandingVenues();
  const rows = venues.flatMap((venue): GuinnessIndexRow[] => {
    const candidate = drinkBrandCandidateForVenue(venue, brand);
    const price = selectDrinkBrandPriceForVenue(venue, brand);
    if (!candidate?.publisher || !candidate.observedAt || !price || /\b(?:0[.,]0|alcohol[ -]?free|non[ -]?alcoholic)\b/i.test(price.pint_name)) return [];
    if (comparablePint({ cheapestPrice: candidate.priceGbp, priceSource: candidate.publisher.label, priceObservedAt: candidate.observedAt, cheapestPint: price.pint_name, measure: price.measure }) === null) return [];
    return [{ ...candidate, publisher: candidate.publisher, observedAt: candidate.observedAt }];
  });
  return buildGuinnessIndex(rows);
}
