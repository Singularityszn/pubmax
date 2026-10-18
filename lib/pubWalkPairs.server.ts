import "server-only";

// Street walks between curated pubs, for the plan optimiser's crawl legs.
//
// lib/planRouteOptimizer refuses a leg over 1.6 km and a route over 3 km, and
// times each visit from the walk between stops. It measured all three along
// the straight line. Across Zone 1, a quarter of the pub pairs it accepted as
// under 1.6 km are over 1.6 km on foot, so it built crawls that only fit on
// paper. OpenRouteService refines the chosen legs afterwards, but it cannot
// score every candidate pair the search tries.
//
// `data/pub_walk_pairs.json` is built offline by
// `scripts/build_station_walk_access.py` from the same street graph as the
// station table: every pair of curated pubs inside the street-walk area within
// 1.6 km of each other in a straight line, with its street metres, never below
// the straight line. A pair it does not hold answers null, and the optimiser
// keeps the straight line for that leg.

import pairsJson from "@/data/pub_walk_pairs.json";

type PubWalkPairs = Map<string, number>;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Parse the committed table into a pair map, dropping anything malformed. */
export function parsePubWalkPairs(raw: unknown): PubWalkPairs {
  const pairs: PubWalkPairs = new Map();
  if (!raw || typeof raw !== "object") return pairs;
  const record = raw as Record<string, unknown>;
  const ids = record.venueIds;
  const rows = record.pairs;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return pairs;
  if (!rows || typeof rows !== "object") return pairs;
  for (const [fromIndex, row] of Object.entries(rows as Record<string, unknown>)) {
    const from = ids[Number(fromIndex)];
    if (typeof from !== "string" || !Array.isArray(row)) continue;
    for (const entry of row) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [toIndex, metres] = entry as [unknown, unknown];
      const to = typeof toIndex === "number" ? ids[toIndex] : undefined;
      if (typeof to !== "string" || typeof metres !== "number" || !Number.isFinite(metres) || metres < 0) continue;
      pairs.set(pairKey(from, to), metres);
    }
  }
  return pairs;
}

let bundled: PubWalkPairs | null = null;

/** Street kilometres between two curated pubs, or null when the table does not hold the pair. */
export function pubStreetWalkKm(
  fromVenueId: string,
  toVenueId: string,
  pairs: PubWalkPairs = (bundled ??= parsePubWalkPairs(pairsJson)),
): number | null {
  if (fromVenueId === toVenueId) return null;
  const metres = pairs.get(pairKey(fromVenueId, toVenueId));
  return metres === undefined ? null : metres / 1_000;
}
