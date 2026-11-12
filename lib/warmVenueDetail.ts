// Shared venue-detail warm cache (IDEAS A1 polish).
//
// Prefetch-on-intent and the sheet's select-time fetch both hit `/api/venue/[id]`.
// Without a shared in-memory cache, a successful prefetch only warms the HTTP
// cache — PubMap still fires a second fetch and waits for JSON parse before
// painting the sheet. This module keeps one in-flight Promise + resolved Venue
// per id for the session so the sheet can open from memory when warm.
//
// A rejected request or body read can use the device copy from
// lib/savedVenueDetails.ts. Its `savedAt` distinguishes it from a live read,
// and it never becomes a session cache hit.

import { readSavedVenueDetail, saveVenueDetail } from "@/lib/savedVenueDetails";
import { venueFromDetailPayload, type Venue } from "@/lib/venues";
import { venueDetailUrl } from "@/lib/prefetchVenue";

/**
 * The wire carries `amenityStatus` and no amenity booleans, so the payload is
 * read through the one seam that rebuilds this tree's own record from it.
 */
type VenueDetailPayload = Parameters<typeof venueFromDetailPayload>[0];
type VenueDetailResponse = { venue?: VenueDetailPayload | null };

export type VenueDetailLookupResult =
  | { status: "found"; venue: Venue; savedAt?: string }
  | { status: "missing" }
  | { status: "failed" };

const resolved = new Map<string, Venue>();
const payloads = new Map<string, VenueDetailPayload>();
const inflight = new Map<string, Promise<VenueDetailLookupResult>>();
let savedCopies = new WeakMap<Venue, string>();

/** Return a previously warmed venue, or null when not yet resolved. */
export function getWarmedVenue(venueId: string): Venue | null {
  return resolved.get(venueId) ?? null;
}

export function savedVenueCopyAt(venue: Venue): string | null {
  return savedCopies.get(venue) ?? null;
}

/** Keep the live detail of a pub the reader opened, so it reads offline later. */
export function rememberOpenedVenue(venueId: string): void {
  const payload = payloads.get(venueId);
  if (payload?.id) saveVenueDetail(venueId, payload);
}

function savedCopyResult(venueId: string): VenueDetailLookupResult {
  const saved = readSavedVenueDetail(venueId);
  if (!saved) return { status: "failed" };
  const payload = saved.venue as VenueDetailPayload;
  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    !Array.isArray(payload.prices)
  ) {
    return { status: "failed" };
  }
  const venue = venueFromDetailPayload(payload);
  savedCopies.set(venue, saved.savedAt);
  return { status: "found", venue, savedAt: saved.savedAt };
}

/**
 * Fetch (or join an in-flight fetch for) venue detail. Successful results are
 * cached for the session. Failures and device copies are not cached, so a
 * later select can retry.
 */
export function warmVenueDetail(venueId: string): Promise<VenueDetailLookupResult> {
  if (!venueId) return Promise.resolve({ status: "missing" });
  const hit = resolved.get(venueId);
  if (hit) return Promise.resolve({ status: "found", venue: hit });

  const pending = inflight.get(venueId);
  if (pending) return pending;

  const lookup = () => fetch(venueDetailUrl(venueId))
    .then(
      async (response): Promise<VenueDetailLookupResult> => {
        if (response.status === 404) return { status: "missing" };
        if (!response.ok) return { status: "failed" };
        let data: VenueDetailResponse;
        try {
          data = (await response.json()) as VenueDetailResponse;
        } catch {
          return savedCopyResult(venueId);
        }
        const payload = data.venue;
        if (!payload?.id) return { status: "failed" };
        const venue = venueFromDetailPayload(payload);
        resolved.set(venueId, venue);
        resolved.set(venue.id, venue);
        payloads.set(venueId, payload);
        payloads.set(venue.id, payload);
        return { status: "found", venue };
      },
      // No answer at all, which is what a lost signal looks like.
      () => savedCopyResult(venueId),
    )
    .catch((): VenueDetailLookupResult => ({ status: "failed" }));

  const request = lookup()
    .then(async (result) => {
      if (result.status === "found" && result.savedAt && typeof navigator !== "undefined" && navigator.onLine) {
        const live = await lookup();
        // A retry that confirms removal overrides the copy. Other failures
        // retain its savedAt so the sheet still identifies the saved copy.
        if (live.status === "missing" || (live.status === "found" && !live.savedAt)) return live;
      }
      return result;
    })
    .finally(() => {
      inflight.delete(venueId);
    });

  inflight.set(venueId, request);
  return request;
}

/** Test-only: clear the session caches between cases. */
export function __resetWarmVenueDetail(): void {
  resolved.clear();
  payloads.clear();
  inflight.clear();
  savedCopies = new WeakMap();
}
