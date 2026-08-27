// Request-time venue matching for /api/out.
//
// The build-time refresh matches a provider row to a pub through
// scripts/whatson/resolveVenueId.mjs, and until now that was the ONLY place it
// happened: a live Ticketmaster row reached /out with no venueId, so every one
// of them was dropped from the pub list and the page printed a bare status line
// over nothing. This module runs the SAME matcher at request time, fed an
// index built from the slim venue rows the server already holds, so a live gig
// at The Lexington lands on the same pin the CLI would have put it on.
//
// The matcher is the refresh's own: normalised name PLUS an independent
// confirmation. The slim index carries no address, so the only confirmation
// available here is proximity - a name match whose coordinates sit further than
// OUT_VENUE_MATCH_PROXIMITY_METERS from the pub, or a row with no coordinates
// at all, resolves to nothing. Never invent, never guess on ambiguity.
//
// This module is PURE. The cached loader over the slim index is
// lib/out/venueMatch.server.ts.

import { normalizeVenueIdentityName } from "@/scripts/lib/venueCanonicalization.mjs";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import {
  haversineMeters,
  resolveVenueId,
  VENUE_MATCH_PROXIMITY_METERS,
  type VenueResolverCandidate,
  type VenueResolverIndex,
} from "@/scripts/whatson/resolveVenueId.mjs";
import type { VenueRef } from "@/lib/venueIndex";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * The proximity floor the refresh matcher confirms a name match with. Restated
 * here for the reader and pinned by the test; the number itself is applied by
 * resolveVenueId.
 */
export const OUT_VENUE_MATCH_PROXIMITY_METERS = VENUE_MATCH_PROXIMITY_METERS;

/**
 * Whether the request-time match RAN. A read of the slim index that could not
 * run leaves every live row unmatched, and that is not the same finding as
 * "these places are not listed" - the notice on /out words the two apart.
 */
export type OutVenueMatchStatus = "ready" | "unavailable";

export type OutVenueMatchIndex = VenueResolverIndex;

/**
 * Build the resolver index from slim venue refs.
 *
 * The exact-key lane stays empty on purpose: that key needs an address, which
 * the slim index does not carry, so every match here is the conservative
 * name-plus-proximity lane.
 */
export function buildOutVenueMatchIndex(venues: Iterable<VenueRef>): OutVenueMatchIndex {
  const byNormalizedName = new Map<string, VenueResolverCandidate[]>();
  for (const venue of venues) {
    const normName = normalizeVenueIdentityName(venue.name);
    if (!normName) continue;
    const candidate: VenueResolverCandidate = {
      venueId: venue.id,
      name: venue.name,
      address: "",
      lat: Number.isFinite(venue.lat) ? venue.lat : null,
      lng: Number.isFinite(venue.lng) ? venue.lng : null,
      postcode: null,
    };
    const held = byNormalizedName.get(normName);
    if (held) held.push(candidate);
    else byNormalizedName.set(normName, [candidate]);
  }
  return { exactByKey: new Map(), byNormalizedName };
}

/** The venue one row lands on, or null when the matcher would be guessing. */
export function matchOutRowVenue(row: WhatsOnRow, index: OutVenueMatchIndex): string | null {
  const candidates = index.byNormalizedName.get(normalizeVenueIdentityName(row.placeName));
  if (candidates?.length !== 1) return null;
  return resolveVenueId(
    {
      name: row.placeName,
      lat: typeof row.lat === "number" ? row.lat : null,
      lng: typeof row.lng === "number" ? row.lng : null,
    },
    index,
  );
}

/** Whether an existing venue id belongs to this resolver's accepted index. */
export function isOutVenueId(
  index: OutVenueMatchIndex,
  venueId: string | null | undefined,
): boolean {
  const canonicalId = canonicalOutVenueId(venueId);
  if (!canonicalId) return false;
  for (const candidateVenueId of index.exactByKey.values()) {
    if (canonicalOutVenueId(candidateVenueId) === canonicalId) return true;
  }
  for (const candidates of index.byNormalizedName.values()) {
    for (const candidate of candidates) {
      if (candidate.venueId === canonicalId) return true;
    }
  }
  return false;
}

function venueNamesAgree(listingName: string, canonicalName: string): boolean {
  const listing = normalizeVenueIdentityName(listingName);
  const canonical = normalizeVenueIdentityName(canonicalName);
  if (!listing || !canonical) return false;
  return (
    listing === canonical ||
    listing.startsWith(`${canonical} `) ||
    canonical.startsWith(`${listing} `)
  );
}

function heldVenueMatchesRow(
  row: WhatsOnRow,
  index: OutVenueMatchIndex,
  venueId: string,
): boolean {
  const canonicalId = canonicalOutVenueId(venueId);
  if (!canonicalId) return false;
  const agreeingCandidates = [...index.byNormalizedName.values()]
    .flat()
    .filter((candidate) => venueNamesAgree(row.placeName, candidate.name));
  for (const candidates of index.byNormalizedName.values()) {
    for (const candidate of candidates) {
      if (canonicalOutVenueId(candidate.venueId) !== canonicalId) continue;
      if (!venueNamesAgree(row.placeName, candidate.name)) return false;
      if (
        Number.isFinite(row.lat) &&
        Number.isFinite(row.lng) &&
        Number.isFinite(candidate.lat) &&
        Number.isFinite(candidate.lng)
      ) {
        return (
          haversineMeters(
            row.lat as number,
            row.lng as number,
            candidate.lat as number,
            candidate.lng as number,
          ) <= OUT_VENUE_MATCH_PROXIMITY_METERS
        );
      }
      return agreeingCandidates.length === 1;
    }
  }
  return false;
}

export type AttachOutVenuesResult = {
  rows: WhatsOnRow[];
  /** Rows that gained a venueId here, at request time. */
  matchedAtRequest: number;
  /** Rows that still carry no venueId after the match. */
  unmatched: number;
};

/**
 * Attach a pub venue to every row that carries none.
 *
 * A row the refresh already matched is left alone only when its id belongs to
 * the accepted pub-only index. This prevents stale or non-pub inventory from
 * bypassing the same eligibility gate used by request-time matching.
 */
export function attachOutVenues(
  rows: readonly WhatsOnRow[],
  index: OutVenueMatchIndex,
  mayMatch: (row: WhatsOnRow) => boolean = () => true,
  trustHeld: (row: WhatsOnRow, venueId: string) => boolean = () => false,
): AttachOutVenuesResult {
  let matchedAtRequest = 0;
  let unmatched = 0;
  const out = rows.map((row) => {
    const heldVenueId = canonicalOutVenueId(row.venueId);
    if (
      heldVenueId &&
      trustHeld(row, heldVenueId) &&
      isOutVenueId(index, heldVenueId)
    ) {
      return row;
    }
    if (heldVenueId && heldVenueMatchesRow(row, index, heldVenueId)) return row;

    const unresolved = heldVenueId ? { ...row, venueId: undefined } : row;
    if (!mayMatch(unresolved)) {
      unmatched += 1;
      return unresolved;
    }
    const venueId = matchOutRowVenue(unresolved, index);
    if (!venueId) {
      unmatched += 1;
      return unresolved;
    }
    matchedAtRequest += 1;
    return { ...unresolved, venueId };
  });
  return { rows: out, matchedAtRequest, unmatched };
}
