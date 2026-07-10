// Shared venue-detail warm cache (IDEAS A1 polish).
//
// Prefetch-on-intent and the sheet's select-time fetch both hit `/api/venue/[id]`.
// Without a shared in-memory cache, a successful prefetch only warms the HTTP
// cache — PubMap still fires a second fetch and waits for JSON parse before
// painting the sheet. This module keeps one in-flight Promise + resolved Venue
// per id for the session so the sheet can open from memory when warm.

import type { Venue } from "@/lib/venues";
import { venueDetailUrl } from "@/lib/prefetchVenue";

type VenueDetailResponse = { venue?: Venue | null };

const resolved = new Map<string, Venue>();
const inflight = new Map<string, Promise<Venue | null>>();

/** Return a previously warmed venue, or null when not yet resolved. */
export function getWarmedVenue(venueId: string): Venue | null {
  return resolved.get(venueId) ?? null;
}

/**
 * Fetch (or join an in-flight fetch for) venue detail. Successful results are
 * cached for the session. Failures are not cached so a later select can retry.
 */
export function warmVenueDetail(venueId: string): Promise<Venue | null> {
  if (!venueId) return Promise.resolve(null);
  const hit = resolved.get(venueId);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(venueId);
  if (pending) return pending;

  const request = fetch(venueDetailUrl(venueId))
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as VenueDetailResponse;
      const venue = data.venue;
      if (!venue || venue.id !== venueId) return null;
      resolved.set(venueId, venue);
      return venue;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(venueId);
    });

  inflight.set(venueId, request);
  return request;
}

/** Test-only: clear the session caches between cases. */
export function __resetWarmVenueDetail(): void {
  resolved.clear();
  inflight.clear();
}
