import "server-only";

import { buildOutVenueMatchIndex, type OutVenueMatchIndex } from "@/lib/out/venueMatch";
import { getVenueIndex } from "@/lib/venueIndex";

// The slim index is read once per process by lib/venueIndex.ts and memoised;
// the resolver index is built once over THAT map and held beside it. So the
// per-request cost of matching is one map lookup per row, and no request ever
// re-parses a pack or re-walks the city.
const built = new WeakMap<Map<string, unknown>, OutVenueMatchIndex>();

/**
 * The request-time match index, or null when the slim index could not be read.
 *
 * lib/venueIndex.ts never throws: a pack that would not read yields an EMPTY
 * map. An empty London is not an answer, so that reads as null here and the
 * caller reports the match as unavailable rather than telling a reader that
 * every place on the page is unlisted.
 */
export async function loadOutVenueMatchIndex(): Promise<OutVenueMatchIndex | null> {
  const venues = await getVenueIndex();
  if (venues.size === 0) return null;
  const held = built.get(venues);
  if (held) return held;
  const index = buildOutVenueMatchIndex(venues.values());
  built.set(venues, index);
  return index;
}
