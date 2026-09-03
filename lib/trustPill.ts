// The words and the tones a trust pill may carry. Pure: no React, no store.
//
// A trust pill sits beside a price and says how far to trust it. Captain
// decision 2026-09-03 (issue #1354): green means a drinker confirmed the price
// inside the authority window, grey means nobody has. Amber is the scraped
// lane and is HELD until London is re-collected as dated Pint Drops (#1329),
// so the tone exists here, is styled, and is passed by nothing. The fence in
// __tests__/launchPrimitives.test.tsx keeps it that way.
//
// Colour never carries the meaning on its own: every tone prints a word, and
// the confirmed tone prints the day too, so a reader who cannot see green
// still reads "Confirmed 3 Sept".

import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";

export const TRUST_PILL_TONES = ["confirmed", "none", "held"] as const;
export type TrustPillTone = (typeof TRUST_PILL_TONES)[number];

/** The tones a launch surface may pass today. `held` waits for #1329. */
export const TRUST_PILL_LIVE_TONES = ["confirmed", "none"] as const;
export type TrustPillLiveTone = (typeof TRUST_PILL_LIVE_TONES)[number];

export const TRUST_PILL_LABEL: Record<TrustPillTone, string> = {
  confirmed: "Confirmed",
  none: "No price logged",
  held: "Scraped",
};

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
 * Which live tone a price earns from its last confirmation. A confirmation
 * inside the 30 day authority window is green; anything older, or no
 * confirmation at all, is grey. A future timestamp is a data fault and reads
 * as unconfirmed rather than as fresh.
 */
export function trustToneForConfirmation(
  confirmedAtMs: number | null | undefined,
  now: number = Date.now(),
): TrustPillLiveTone {
  if (typeof confirmedAtMs !== "number" || !Number.isFinite(confirmedAtMs)) return "none";
  const age = now - confirmedAtMs;
  if (age < 0) return "none";
  return age <= PRICE_AUTHORITY_MAX_AGE_MS ? "confirmed" : "none";
}

/** The whole label for a tone: the word, plus the day when there is one. */
export function trustPillLabel(tone: TrustPillTone, confirmedAtMs?: number | null): string {
  const word = TRUST_PILL_LABEL[tone];
  if (tone === "confirmed" && typeof confirmedAtMs === "number" && Number.isFinite(confirmedAtMs)) {
    return `${word} ${formatTrustDay(confirmedAtMs)}`;
  }
  return word;
}
