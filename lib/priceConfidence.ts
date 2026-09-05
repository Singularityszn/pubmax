// BROWSER-SAFE pure module: how OLD the evidence behind a displayed price is.
// No IO, no Date.now() defaults at module scope — callers pass `now` so the
// maths is testable and SSR-stable.
//
// IT USED TO BE A VOUCH READER. Battle test L03 retired the anonymous
// price-confirm lane, which was a third "Confirmed" vocabulary keyed on a
// hashed IP, and every vouch-derived word here went with it: "×3 this week",
// "vouched this week", "vouched recently". An IP is a household, a pub's own
// wifi and a mobile carrier's NAT, so that tally could never say how many
// PEOPLE stood behind a price, and printing a count as though it could is the
// defect rather than a feature of it. What a drinker's own agreement is worth
// is `lib/pintTrust.ts`'s question, answered over authority keys.
//
// What is left is honest and narrow: how long ago the price itself was
// observed, and one line inviting a fresh look once that is old.
//
// Why these thresholds (documented, not vibes):
//   • FRESH  — observed within 14 days. London pub prices move on
//     brewery/quarterly cycles, not daily, and 14d spans two pub-weeks.
//   • AGING  — 14 to 60 days. Nothing is wrong with the price; we just stop
//     implying it has recently been checked. The plaque keeps its dignity.
//   • STALE  — no signal for 60+ days (two typical price-review cycles). The
//     price still renders (an old truth beats a blank), but visibly humbler,
//     and the copy invites a fresh look instead of asserting accuracy.

import { DAY_MS } from "@/lib/dayMs";

export type PriceConfidenceState = "fresh" | "aging" | "stale";

export const FRESH_WITHIN_DAYS = 14;
export const STALE_AFTER_DAYS = 60;

export type PriceConfidenceInput = {
  /** Epoch ms the displayed price itself was observed, when known. */
  priceObservedAt?: number | null;
};

export type PriceConfidence = {
  state: PriceConfidenceState;
  /**
   * The one line this module may print, or null. It never describes activity:
   * "worth a fresh look" is a statement about AGE, which is the only thing left
   * here that anybody can check.
   */
  label: string | null;
};

export function priceConfidence(
  input: PriceConfidenceInput,
  now: number,
): PriceConfidence {
  const observedAt = input.priceObservedAt;
  const signalAt =
    typeof observedAt === "number" && Number.isFinite(observedAt) ? observedAt : null;
  const ageDays = signalAt === null ? Infinity : (now - signalAt) / DAY_MS;

  const state: PriceConfidenceState =
    ageDays <= FRESH_WITHIN_DAYS ? "fresh" : ageDays <= STALE_AFTER_DAYS ? "aging" : "stale";

  return { state, label: state === "stale" ? "worth a fresh look" : null };
}
