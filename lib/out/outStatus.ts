import type { OutResponse } from "@/lib/out/types";

export const OUT_READ_FAILED_LINE = "Could not check listings.";
export const OUT_DEGRADED_LINE = "Some listings could not be checked.";
export const OUT_EMPTY_LINE = "No listings for this day yet.";
export const OUT_PENDING_LINE = "Checking listings...";

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
  /** No answer for the day on screen yet. */
  pending?: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.failed) lines.push(OUT_READ_FAILED_LINE);
  const body = input.body;
  if (!body) {
    // A pressed chip with no answer yet is day chips over a blank area, which
    // reads as a broken surface. It is not an empty market and must never be
    // worded as one.
    if (!input.failed && input.pending) lines.push(OUT_PENDING_LINE);
    return lines;
  }
  if (body.status === "degraded") {
    lines.push(body.reason ?? OUT_DEGRADED_LINE);
    return lines;
  }
  if (!input.failed && body.events.length === 0) lines.push(OUT_EMPTY_LINE);
  return lines;
}
