// The words a trust pill prints. Pure: no React, no store.
//
// ONE DECIDER, AND IT IS NOT THIS FILE. What a price is worth is
// `lib/priceTier.ts`: the four standings, the ages, the labels and the figure
// formatter all live there, and this module only turns a decided standing into
// the text a pill shows. Captain decision 2026-09-03: this file used to carry a
// second tone vocabulary (`confirmed | none | held`, amber held back until
// London was re-collected) and the two drifted apart within a day of each other
// shipping. The hold is over and the vocabulary is one.
//
// Colour never carries the meaning on its own: every standing prints a word,
// the confirmed standing prints the day too, so a reader who cannot see green
// still reads "Confirmed 3 Sept".

import {
  priceStandingLabel,
  type PriceStanding,
  type PriceStandingDecision,
} from "@/lib/priceTier";

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

/** "3 Sept" in London time. Exported so a caller prints the same day the pill does. */
export function formatTrustDay(atMs: number): string {
  return LONDON_DAY.format(new Date(atMs)).replace(/\bSep\b/, "Sept");
}

/**
 * The CSS tone a standing wears. Read from `PRICE_STANDING_TONE` rather than
 * restated, so the pill and every other surface colour a standing the same way.
 * `modelled` is its own tone on purpose: an estimate that looked as confident
 * as a published price is the one failure this component exists to prevent.
 */
export { PRICE_STANDING_TONE as TRUST_PILL_TONE } from "@/lib/priceTier";

/**
 * The whole label for a standing: the word, plus the day on a confirmed price.
 *
 * The word comes from `priceStandingLabel`, so a standing renamed there is
 * renamed here, and a fifth standing added there cannot silently print nothing.
 * The day is only ever printed on `confirmed`, because a listed price shows its
 * source date beside it and a modelled figure has no observation to date.
 */
export function trustPillLabel(standing: PriceStanding, confirmedAtMs?: number | null): string {
  const word = priceStandingLabel(standing);
  if (standing === "confirmed" && typeof confirmedAtMs === "number" && Number.isFinite(confirmedAtMs)) {
    return `${word} ${formatTrustDay(confirmedAtMs)}`;
  }
  return word;
}

/**
 * The day a decision was confirmed, in epoch ms, or null. A decision that is
 * not `confirmed` has no confirmation day, so it answers null rather than
 * dating itself off whatever `asOf` happens to carry.
 */
export function confirmedAtMsOf(decision: PriceStandingDecision): number | null {
  if (decision.standing !== "confirmed" || !decision.asOf) return null;
  const ms = Date.parse(decision.asOf);
  return Number.isFinite(ms) ? ms : null;
}
