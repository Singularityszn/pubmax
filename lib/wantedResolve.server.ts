// Server-side Wanted paste resolve: curated venue index + national UK base
// search. Never fetches Instagram/TikTok. Ambiguous matches stay as candidates
// for the drinker to confirm — never auto-confirm a priced pin.

import { searchUkNationalPubs } from "@/lib/ukNationalPubSearch.server";
import { normaliseUkPlaceQuery } from "@/lib/ukPlaceSearch";
import { getVenueIndex } from "@/lib/venueIndex";
import {
  splitWantedPaste,
  type WantedResolveCandidate,
  type WantedResolveResult,
} from "@/lib/wanted";

export type { WantedResolveCandidate, WantedResolveResult };

function matchTier(hay: string, query: string): number | null {
  if (!hay) return null;
  if (hay === query) return 0;
  if (hay.startsWith(query) || hay.split(" ").some((word) => word.startsWith(query))) {
    return 1;
  }
  if (query.length >= 2 && hay.includes(query)) return 2;
  return null;
}

async function searchCuratedPubs(
  rawQuery: string,
  limit: number,
): Promise<WantedResolveCandidate[]> {
  const query = normaliseUkPlaceQuery(rawQuery);
  if (query.length < 2 || limit <= 0) return [];
  const index = await getVenueIndex();
  const scored: { tier: number; id: string; name: string; borough: string }[] = [];
  for (const [id, venue] of index) {
    const name = typeof venue.name === "string" ? venue.name : "";
    const hay = normaliseUkPlaceQuery(name);
    const tier = matchTier(hay, query);
    if (tier === null) continue;
    scored.push({
      tier,
      id,
      name,
      borough: typeof venue.borough === "string" ? venue.borough : "",
    });
  }
  scored.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    return left.name.localeCompare(right.name, "en-GB");
  });
  return scored.slice(0, limit).map((row) => ({
    venueId: row.id,
    venueName: row.name,
    venueKind: "curated" as const,
    address: "",
    contextLabel: row.borough,
  }));
}

/**
 * Resolve a Wanted paste into confirmable candidates.
 * Curated hits lead; national UK-base hits follow, deduped by id.
 */
export async function resolveWantedPaste(
  raw: string,
  limit = 8,
): Promise<WantedResolveResult> {
  const split = splitWantedPaste(raw);
  if (!split.query && !split.sourceUrl) {
    return {
      query: "",
      sourceUrl: "",
      sourcePlatform: "none",
      rawPaste: "",
      status: "empty_query",
      candidates: [],
    };
  }
  if (!split.query) {
    // Bare URL: honest pending path — no server-side scrape for a name.
    return {
      query: "",
      sourceUrl: split.sourceUrl,
      sourcePlatform: split.sourcePlatform,
      rawPaste: split.rawPaste,
      status: "ready",
      candidates: [],
    };
  }

  const curatedLimit = Math.max(1, Math.ceil(limit / 2));
  const nationalLimit = Math.max(1, limit);
  const [curated, national] = await Promise.all([
    searchCuratedPubs(split.query, curatedLimit),
    Promise.resolve(searchUkNationalPubs(split.query, nationalLimit)),
  ]);

  const seen = new Set(curated.map((c) => c.venueId));
  const baseHits: WantedResolveCandidate[] = [];
  for (const hit of national.hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    baseHits.push({
      venueId: hit.id,
      venueName: hit.name,
      venueKind: "uk_base",
      address: hit.address,
      contextLabel: hit.address,
    });
  }

  const candidates = [...curated, ...baseHits].slice(0, limit);
  const status =
    national.status === "degraded" && curated.length === 0 ? "degraded" : "ready";

  return {
    query: split.query,
    sourceUrl: split.sourceUrl,
    sourcePlatform: split.sourcePlatform,
    rawPaste: split.rawPaste,
    status,
    candidates,
  };
}
