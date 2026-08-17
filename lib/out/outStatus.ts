import type { OutResponse, OutStatus } from "@/lib/out/types";

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
export function outCacheControl(status: OutStatus): string {
  return status === "ready" ? OUT_READY_CACHE_CONTROL : OUT_UNSETTLED_CACHE_CONTROL;
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

/**
 * What /out says above the list, in order.
 *
 * The one rule: a read that did not answer is NEVER worded as an empty market.
 * A degraded answer with zero rows says only that some listings could not be
 * checked - printing "No listings for this day yet." beside it tells a reader
 * the city is quiet when what actually happened is that we could not look.
 */
export function outStatusLines(input: {
  body: Pick<OutResponse, "status" | "events" | "reason"> | null;
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
  if (body.status === "degraded") {
    lines.push(body.reason ?? OUT_DEGRADED_LINE);
    return lines;
  }
  // A lane nobody asked is not a city with nothing on. Say the listings are off
  // rather than wording an unasked question as an empty market.
  if (body.status === "not-configured") {
    lines.push(body.reason ?? OUT_NOT_CONFIGURED_LINE);
    return lines;
  }
  if (!input.failed && body.events.length === 0) lines.push(OUT_EMPTY_LINE);
  return lines;
}
