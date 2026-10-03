/**
 * OSM refs Google verified as permanently closed. The shard files stay
 * intact; the map loader drops these refs when it builds the drawable set.
 */

import closedPubs from "@/data/places_verification/closed_pubs.json";

import { omitVerifiedClosedPubs } from "@/lib/placesVerification";

const OSM_REF = /^[nwr]\d+$/;

function closedRefSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const refs = (value as { osmRefs?: unknown }).osmRefs;
  if (!Array.isArray(refs)) return new Set();
  return new Set(refs.filter((ref): ref is string => typeof ref === "string" && OSM_REF.test(ref)));
}

export const VERIFIED_CLOSED_OSM_REFS: ReadonlySet<string> = closedRefSet(closedPubs);

export function hideVerifiedClosedPubs<T extends { id: string }>(
  pubs: readonly T[],
  closedOsmRefs: ReadonlySet<string> = VERIFIED_CLOSED_OSM_REFS,
): T[] {
  return omitVerifiedClosedPubs(pubs, closedOsmRefs);
}
