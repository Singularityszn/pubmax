// What a quiet night offers instead of a mood chip: real pubs with a listed
// price.
//
// A night nothing is listed on used to hand the reader nine vibe chips and a
// link to the map. Chips are an ask, not an answer, so the quiet page now
// carries pubs: the cheapest listed pints we hold, each with its own borough,
// its own figure and its own way onto the map.
//
// WHY THIS IS NOT A "QUIETER PUBS" LIST. The captain's F02 ruling (recorded in
// lib/AGENTS.md) settles it: the only quiet reading this product has is
// `estimateBusyness`, whose typical-pattern half is a function of the hour and
// identical for every pub in London, and an unreported pub's crowd state is
// unknown rather than quiet. So no row here claims a pub is quiet. The rows
// claim what they can prove: a price somebody listed, on a day the dataset
// names.

export type TonightCheapPint = {
  venueId: string;
  name: string;
  borough: string;
  /** Cheapest listed pint in pounds. Always a real figure, never a guess. */
  priceGbp: number;
};

export type TonightCheapPintCandidate = {
  id: string;
  name: string;
  primaryBorough: string;
  cheapestPrice: number | null;
};

/** How many rows the quiet page carries. Enough to choose from, short enough to read. */
export const TONIGHT_CHEAP_PINTS_LIMIT = 4;

export const TONIGHT_CHEAP_PINTS_TITLE = "Cheapest listed pints";

/**
 * Cheapest first, then by name so two pubs at one price keep one order on every
 * machine. A pub with no listed figure is not a row: "no price logged here yet"
 * is the honest line elsewhere, and this list is only about the ones we hold.
 */
export function tonightCheapPints(
  venues: readonly TonightCheapPintCandidate[],
  limit: number = TONIGHT_CHEAP_PINTS_LIMIT,
): TonightCheapPint[] {
  const rows: TonightCheapPint[] = [];
  for (const venue of venues) {
    if (typeof venue.cheapestPrice !== "number" || !Number.isFinite(venue.cheapestPrice)) {
      continue;
    }
    if (venue.cheapestPrice <= 0) continue;
    if (!venue.id || !venue.name) continue;
    rows.push({
      venueId: venue.id,
      name: venue.name,
      borough: venue.primaryBorough,
      priceGbp: venue.cheapestPrice,
    });
  }
  rows.sort((left, right) => {
    if (left.priceGbp !== right.priceGbp) return left.priceGbp - right.priceGbp;
    return left.name.localeCompare(right.name, "en-GB");
  });
  return rows.slice(0, Math.max(0, Math.floor(limit)));
}
