/**
 * Closure exclusions combine Google verification with sourced closure records.
 * Historical shard rows stay intact while readers exclude closed identities.
 */

import closedPubs from "@/data/places_verification/closed_pubs.json";
import confirmedClosures from "@/data/confirmed_pub_closures.json";

import { osmRefFromLayerId } from "@/lib/placesVerification";

const OSM_REF = /^[nwr]\d+$/;
const CLOSURE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function currentClosure(date: unknown): boolean {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const observed = Date.parse(`${date}T00:00:00Z`);
  const age = Date.now() - observed;
  return Number.isFinite(observed) && age >= 0 && age < CLOSURE_MAX_AGE_MS;
}

function closedRefSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const refs = (value as { osmRefs?: unknown }).osmRefs;
  if (!Array.isArray(refs)) return new Set();
  const record = value as { verifiedAt?: unknown; osmVerifiedAt?: Record<string, unknown> };
  return new Set(refs.filter((ref): ref is string => typeof ref === "string" && OSM_REF.test(ref)
    && currentClosure(record.osmVerifiedAt ? record.osmVerifiedAt[ref] : record.verifiedAt)));
}

export function confirmedPubClosure(id: string) {
  return confirmedClosures.find((closure) => closure.venueId === id && currentClosure(closure.observedAt)) ?? null;
}

function closedCuratedIdSet(value: unknown): ReadonlySet<string> {
  if (typeof value !== "object" || value === null) return new Set();
  const ids = (value as { curatedVenueIds?: unknown }).curatedVenueIds;
  if (!Array.isArray(ids)) return new Set();
  const record = value as { verifiedAt?: unknown; curatedVerifiedAt?: Record<string, unknown> };
  return new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0
    && currentClosure(record.curatedVerifiedAt ? record.curatedVerifiedAt[id] : record.verifiedAt)));
}

/** Closed curated identities come from source records, never name matching. */
let closureCache: { day: number; osm: ReadonlySet<string>; curated: ReadonlySet<string> } | null = null;

function closureSets() {
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  if (closureCache?.day === day) return closureCache;
  const current = confirmedClosures.filter((closure) => currentClosure(closure.observedAt));
  closureCache = {
    day,
    osm: new Set([...closedRefSet(closedPubs), ...current.map((closure) => closure.osmRef)]),
    curated: new Set([...closedCuratedIdSet(closedPubs), ...current.map((closure) => closure.venueId)]),
  };
  return closureCache;
}

export function verifiedClosedOsmRefs(): ReadonlySet<string> {
  return closureSets().osm;
}

function verifiedClosedCuratedIds(): ReadonlySet<string> {
  return closureSets().curated;
}

export function isVerifiedClosedCuratedVenue(
  id: string,
  closedCuratedVenueIds: ReadonlySet<string> = verifiedClosedCuratedIds(),
): boolean {
  return closedCuratedVenueIds.has(id);
}

export function omitClosedCuratedVenues<T extends { id: string }>(
  venues: readonly T[],
  closedCuratedVenueIds: ReadonlySet<string> = verifiedClosedCuratedIds(),
): T[] {
  if (closedCuratedVenueIds.size === 0) return [...venues];
  return venues.filter((venue) => !closedCuratedVenueIds.has(venue.id));
}

export function isVerifiedClosedPub(
  id: string,
  closedOsmRefs: ReadonlySet<string> = verifiedClosedOsmRefs(),
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
  closedOsmRefs: ReadonlySet<string> = verifiedClosedOsmRefs(),
): T[] {
  if (closedOsmRefs.size === 0) return [...pubs];
  return pubs.filter((pub) => !isVerifiedClosedPub(pub.id, closedOsmRefs));
}
