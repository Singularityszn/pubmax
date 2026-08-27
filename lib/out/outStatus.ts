import type { OutResponse, OutStatus } from "@/lib/out/types";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import type { WhatsOnRow } from "@/lib/whatsOn";

export const OUT_READY_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";
export const OUT_UNSETTLED_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=0";

/**
 * How long the edge may keep this answer.
 *
 * A ready answer is a settled fact about the day and holds for its full window.
 * A degraded or not-configured answer is a fact about US at one instant - one
 * upstream blip would otherwise pin "Some listings could not be checked." on
 * the CDN for a quarter of an hour after the provider recovered - so it is held
 * briefly and re-asked.
 */
export function outCacheControl(
  status: OutStatus,
  venueMatch: OutVenueMatchStatus,
): string {
  return status === "ready" && venueMatch === "ready"
    ? OUT_READY_CACHE_CONTROL
    : OUT_UNSETTLED_CACHE_CONTROL;
}

export const OUT_READ_FAILED_LINE = "Could not check listings.";
export const OUT_DEGRADED_LINE = "Some listings could not be checked.";
export const OUT_EMPTY_LINE = "No listings for this day yet.";
export const OUT_NOT_CONFIGURED_LINE = "Listings are not switched on yet.";

/**
 * What the surface may show for the day currently on screen.
 *
 * An answer is held WITH the day it is about, and there is no answer at all
 * until the first read lands. Both cases are PENDING: the previous day's cards
 * may not render under a newly pressed chip, and a reader opening the page must
 * not meet the heading and the day chips over a blank area either.
 */
export function outAnswerView<T>(
  held: { day: string; body: T | null; failed: boolean } | null,
  day: string,
): { body: T | null; failed: boolean; pending: boolean } {
  const current = held !== null && held.day === day ? held : null;
  return {
    body: current?.body ?? null,
    failed: current?.failed ?? false,
    pending: current === null,
  };
}

export type OutListingsBody = Pick<OutResponse, "status" | "events" | "reason"> &
  Partial<Pick<OutResponse, "listingsStatus" | "listingsReason" | "venueMatch">>;

/**
 * The listings lane's own health, for every surface that shows only listings.
 *
 * `/api/out` widens the top-level status with the OPEN-PLANS read, so a plans
 * RPC that is unavailable (no Supabase, or migration 0110 not yet applied)
 * marks an answer whose event providers both read fine. The lane's own field is
 * the honest one; a body from before that field existed falls back to the
 * top-level status, which was that answer's whole truth at the time.
 */
export function outListingsHealth(body: OutListingsBody): {
  status: OutStatus;
  reason: string | undefined;
} {
  if (body.listingsStatus) {
    return { status: body.listingsStatus, reason: body.listingsReason };
  }
  return { status: body.status, reason: body.reason };
}

function matchedPubListingCount(events: readonly WhatsOnRow[]): number {
  return events.reduce(
    (count, row) => (canonicalOutVenueId(row.venueId) !== null ? count + 1 : count),
    0,
  );
}

/**
 * What /out says above the list, in order.
 *
 * The one rule: a read that did not answer is NEVER worded as an empty market.
 * A degraded answer with zero rows says only that some listings could not be
 * checked - printing "No listings for this day yet." beside it tells a reader
 * the city is quiet when what actually happened is that we could not look.
 */
export function outStatusLines(input: {
  body: OutListingsBody | null;
  failed: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.failed) lines.push(OUT_READ_FAILED_LINE);
  const body = input.body;
  if (!body) {
    // A pressed chip with no answer yet is a skeleton, not a sentence. The
    // surface must not word that wait as an empty market either.
    return lines;
  }
  const listings = outListingsHealth(body);
  if (listings.status === "degraded") {
    lines.push(listings.reason ?? OUT_DEGRADED_LINE);
    return lines;
  }
  // A lane nobody asked is not a city with nothing on. Say the listings are off
  // rather than wording an unasked question as an empty market.
  if (listings.status === "not-configured") {
    lines.push(listings.reason ?? OUT_NOT_CONFIGURED_LINE);
    return lines;
  }
  if (input.failed) return lines;
  if (body.events.length === 0) {
    lines.push(OUT_EMPTY_LINE);
    return lines;
  }
  if (body.venueMatch === "ready" && matchedPubListingCount(body.events) === 0) {
    lines.push(OUT_EMPTY_LINE);
  }
  return lines;
}
