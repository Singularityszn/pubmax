import "server-only";

import {
  buildDrinkBrandLanding,
  drinkBrandCandidateForVenue,
  findDrinkBrandLandingBrand,
} from "@/lib/drinkBrandLanding";
import type { NearGuinnessPrice } from "@/lib/nearMeAnswer";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import type { Venue } from "@/lib/venues";

const GUINNESS_SLUG = "guinness";

/**
 * Every listed Guinness price, one per venue, as the compact tuples the near
 * answer reads (lib/nearMeAnswer.ts#cheapestGuinnessNearby).
 *
 * Each row is chosen by the drink page's own selector, so /near and
 * /drink/guinness can never name two different prices for one pub. When the
 * drink page does not publish (under its floor), the list is empty: the line
 * links to that page, and a line pointing at a missing page is not printed.
 */
export function nearGuinnessPrices(venues: readonly Venue[]): NearGuinnessPrice[] {
  const brand = findDrinkBrandLandingBrand(GUINNESS_SLUG);
  if (!brand || !buildDrinkBrandLanding(GUINNESS_SLUG, venues)) return [];
  return venues.flatMap((venue): NearGuinnessPrice[] => {
    const candidate = drinkBrandCandidateForVenue(venue, brand);
    if (!candidate) return [];
    const observedOn = candidate.observedAt ? candidate.observedAt.slice(0, 10) : null;
    return [[candidate.venueId, candidate.priceGbp, observedOn, candidate.publisher?.label ?? null]];
  });
}

export async function loadNearGuinnessPrices(): Promise<NearGuinnessPrice[]> {
  return nearGuinnessPrices(await loadPintPriceLandingVenues());
}
