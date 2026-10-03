/**
 * OSM refs Google verified as permanently closed. The shard files stay
 * intact; the map loader drops these refs when it builds the drawable set.
 */

import closedPubs from "@/data/places_verification/closed_pubs.json";

import { osmRefFromLayerId } from "@/lib/placesVerification";

const OSM_REF = /^[nwr]\d+$/;

function closedRefSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const refs = (value as { osmRefs?: unknown }).osmRefs;
  if (!Array.isArray(refs)) return new Set();
  return new Set(refs.filter((ref): ref is string => typeof ref === "string" && OSM_REF.test(ref)));
}

export const VERIFIED_CLOSED_OSM_REFS: ReadonlySet<string> = closedRefSet(closedPubs);

export function isVerifiedClosedPub(
  id: string,
  closedOsmRefs: ReadonlySet<string> = VERIFIED_CLOSED_OSM_REFS,
): boolean {
  const ref = osmRefFromLayerId(id);
  return ref !== null && closedOsmRefs.has(ref);
}

/**
 * Drop pubs Google has verified as permanently closed. The OSM row stays in
 * the shard; this only decides what the existing map loader may draw.
 */
export function omitVerifiedClosedPubs<T extends { id: string }>(
  pubs: readonly T[],
  closedOsmRefs: ReadonlySet<string> = VERIFIED_CLOSED_OSM_REFS,
): T[] {
  if (closedOsmRefs.size === 0) return [...pubs];
  return pubs.filter((pub) => !isVerifiedClosedPub(pub.id, closedOsmRefs));
}
