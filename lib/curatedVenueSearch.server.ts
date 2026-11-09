import "server-only";

// Shared search over curated pub names and branch details.
//
// It was written inside `lib/wantedResolve.server.ts` and is now shared, because
// a second surface that wants "which pub did you mean" is a second matcher the
// moment it is copied: a Wanted paste and a pub shared into a message must land
// on the same pub for the same words, or the two surfaces are quietly disagreeing
// about what the index says.
// Branch terms must narrow namesakes before the result limit hides a branch.
//
// The index reads the slim pack with `fs`, so this is server-only. A browser
// gets these hits through an API response, never by importing this file.

import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";
import { getVenueIndex } from "@/lib/venueIndex";
import { loadPintPriceLandingVenuesOrThrow } from "@/lib/pintPriceLandingDataset.server";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";
import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import { isPublicRankablePub } from "@/lib/venueKindFilters";

/** The shortest query worth matching. One letter matches half of London. */
export const CURATED_VENUE_SEARCH_MIN_QUERY = 2;

export type CuratedVenueHit = {
  id: string;
  name: string;
  /** The pub's own borough. Empty when the index does not record one. */
  area: string;
};

/**
 * Three tiers, best first: an exact name, a name (or one of its words) that
 * starts with the query, then a name that merely contains it. Ties break on the
 * name so two runs of the same query cannot order two pubs differently.
 */
function matchTier(hay: string, query: string): number | null {
  if (!hay) return null;
  if (hay === query) return 0;
  if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= CURATED_VENUE_SEARCH_MIN_QUERY && hay.includes(query)) return 2;
  return null;
}

export async function searchCuratedVenues(
  rawQuery: string,
  limit: number,
  scope: "all" | "pub-comparison" = "all",
): Promise<CuratedVenueHit[]> {
  const query = normaliseUkPlaceQuery(rawQuery);
  if (query.length < CURATED_VENUE_SEARCH_MIN_QUERY || limit <= 0) return [];
  const [index, venues] = await Promise.all([getVenueIndex(), loadPintPriceLandingVenuesOrThrow()]);
  const details = new Map(venues.map((venue) => [venue.id, venue]));
  const words = query.split(" ").filter(Boolean);
  const scored: { tier: number; hit: CuratedVenueHit }[] = [];
  for (const [id, venue] of index) {
    if (scope === "pub-comparison" && (venue.retired || !isPublicRankablePub(venue)
      || cityIdFromVenueId(id) !== null || isNationalBaseVenueId(id))) continue;
    const name = typeof venue.name === "string" ? venue.name : "";
    const names = venueSearchNames({ id, name, sourceName: venue.sourceName });
    const tiers = names
      .map((label) => matchTier(normaliseUkPlaceQuery(label), query))
      .filter((tier): tier is number => tier !== null);
    const detail = details.get(id);
    const branch = normaliseUkPlaceQuery([
      ...names,
      venue.borough, detail?.locality, detail?.address,
    ].filter(Boolean).join(" "));
    if (tiers.length === 0 && !words.every((word) => branch.includes(word))) continue;
    const tier = tiers.length ? Math.min(...tiers) : 3;
    scored.push({
      tier,
      hit: { id, name, area: typeof venue.borough === "string" ? venue.borough : "" },
    });
  }
  scored.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    return left.hit.name.localeCompare(right.hit.name, "en-GB");
  });
  return scored.slice(0, limit).map((row) => row.hit);
}
