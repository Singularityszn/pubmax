// The landing card's near-you evidence reads: who listed a printed price and
// when, read off the same venue detail the sheet reads.
//
// THREE RULES (review on PR 2414, P2s).
//
// (1) A PRICE WEARS EVIDENCE FOR ITSELF. The saving line's comparator reads
//     only rows that carry its printed figure (`comparatorEvidenceFor`), so a
//     named row at another price never lends its publisher and day to it. No
//     row at that figure is `unavailable`, never a borrowed name.
// (2) EVERY READ HAS A DEADLINE. A read that has not answered by
//     LANDING_EVIDENCE_DEADLINE_MS is aborted and ends `unavailable`, so a
//     stalled request ends in an explicit state rather than "checking" for ever.
// (3) EACH READ LANDS ON ITS OWN (`settleEachRead`), under the caller's
//     ownership guard, so one stalled read cannot hold back the other, and a
//     late answer for a replaced card is dropped.

import type { LegacyPintPrice } from "@/lib/drinks";
import { answerEvidenceFor } from "@/lib/landingHero";
import { discardBody } from "@/lib/responseBody";

export type LandingEvidence = "loading" | "unavailable" | ReturnType<typeof answerEvidenceFor>;

/** How long one evidence read may take before it ends `unavailable`. */
export const LANDING_EVIDENCE_DEADLINE_MS = 8_000;

type Pick = (input: { priceGbp: number; prices: readonly LegacyPintPrice[] }) => Exclude<LandingEvidence, "loading">;

/** The comparator's evidence: only rows carrying its printed figure count. */
export function comparatorEvidenceFor(input: {
  priceGbp: number;
  prices: readonly LegacyPintPrice[];
}): Exclude<LandingEvidence, "loading"> {
  const matching = input.prices.filter(
    (row) => typeof row.price_gbp === "number" && Math.abs(row.price_gbp - input.priceGbp) < 0.005,
  );
  if (matching.length === 0) return "unavailable";
  return answerEvidenceFor({ priceGbp: input.priceGbp, prices: matching });
}

/**
 * One venue's evidence for one printed price. A read that could not be run,
 * or that missed its deadline, answers `unavailable`, never "no publisher".
 */
export async function readLandingEvidence(
  venueId: string,
  priceGbp: number,
  signal: AbortSignal,
  pick: Pick = answerEvidenceFor,
): Promise<Exclude<LandingEvidence, "loading">> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, LANDING_EVIDENCE_DEADLINE_MS);
  try {
    const response = await fetch(`/api/venue/${encodeURIComponent(venueId)}`, { signal: controller.signal });
    if (!response.ok) {
      discardBody(response);
      return "unavailable";
    }
    const payload = (await response.json()) as { venue?: { prices?: LegacyPintPrice[] } };
    const prices = Array.isArray(payload.venue?.prices) ? payload.venue.prices : null;
    if (!prices) return "unavailable";
    return pick({ priceGbp, prices });
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}

/** Apply each read as it answers, and only while the caller still owns it. */
export function settleEachRead<T>(
  owns: () => boolean,
  reads: ReadonlyArray<{ read: Promise<T>; apply: (value: T) => void }>,
): void {
  for (const { read, apply } of reads) {
    void read.then((value) => {
      if (owns()) apply(value);
    });
  }
}
