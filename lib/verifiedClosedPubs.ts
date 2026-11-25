/**
 * Closure exclusions combine Google verification with sourced closure records.
 * Historical shard rows stay intact while readers exclude closed identities.
 */

import closedPubs from "@/data/places_verification/closed_pubs.json";
import confirmedClosures from "@/data/confirmed_pub_closures.json";

import { osmRefFromLayerId } from "@/lib/placesVerification";

const OSM_REF = /^[nwr]\d+$/;

function closedRefSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const refs = (value as { osmRefs?: unknown }).osmRefs;
  if (!Array.isArray(refs)) return new Set();
  return new Set(refs.filter((ref): ref is string => typeof ref === "string" && OSM_REF.test(ref)));
}

export const VERIFIED_CLOSED_OSM_REFS: ReadonlySet<string> = new Set([...closedRefSet(closedPubs), ...confirmedClosures.map((closure) => closure.osmRef)]);

export function confirmedPubClosure(id: string) {
  return confirmedClosures.find((closure) => closure.venueId === id) ?? null;
}

function closedCuratedIdSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const ids = (value as { curatedVenueIds?: unknown }).curatedVenueIds;
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0));
}

/** Closed curated identities come from source records, never name matching. */
const VERIFIED_CLOSED_CURATED_VENUE_IDS: ReadonlySet<string> = new Set([...closedCuratedIdSet(closedPubs), ...confirmedClosures.map((closure) => closure.venueId)]);

export function isVerifiedClosedCuratedVenue(
  id: string,
  closedCuratedVenueIds: ReadonlySet<string> = VERIFIED_CLOSED_CURATED_VENUE_IDS,
): boolean {
  return closedCuratedVenueIds.has(id);
}

export function omitClosedCuratedVenues<T extends { id: string }>(
  venues: readonly T[],
  closedCuratedVenueIds: ReadonlySet<string> = VERIFIED_CLOSED_CURATED_VENUE_IDS,
): T[] {
  if (closedCuratedVenueIds.size === 0) return [...venues];
  return venues.filter((venue) => !closedCuratedVenueIds.has(venue.id));
}

export function isVerifiedClosedPub(
  id: string,
  closedOsmRefs: ReadonlySet<string> = VERIFIED_CLOSED_OSM_REFS,
): boolean {
  const ref = osmRefFromLayerId(id);
  return ref !== null && closedOsmRefs.has(ref);
}

/**
 * Drop pubs with a verified or sourced closure. The OSM row stays in
 * the shard; this only decides what the existing map loader may draw.
 */
export function omitVerifiedClosedPubs<T extends { id: string }>(
  pubs: readonly T[],
  closedOsmRefs: ReadonlySet<string> = VERIFIED_CLOSED_OSM_REFS,
): T[] {
  if (closedOsmRefs.size === 0) return [...pubs];
  return pubs.filter((pub) => !isVerifiedClosedPub(pub.id, closedOsmRefs));
}
