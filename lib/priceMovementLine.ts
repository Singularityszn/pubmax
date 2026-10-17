import { formatPrice } from "@/lib/venues";

// One sentence for a permitted movement between dated prices.
//
// The venue sheet's price history and the Pint Index's national yardstick both
// use this line after their own comparison policies permit it. These price
// lanes stay separate, but a reader meets both, so the sentence itself is
// shared rather than copied: a copy drifts, and two wordings for one idea read
// as two different claims.
//
// A flat price gets its own sentence rather than a "+£0.00", and a gap under a
// year says "since then" instead of claiming "0 years".

/** "Up £2.90 in 12 years." */
export function priceMovementLine(deltaGbp: number, years: number): string {
  const span = years >= 1 ? `in ${years} ${years === 1 ? "year" : "years"}` : "since then";
  const pennies = Math.round(deltaGbp * 100);
  if (pennies === 0) return `Same price ${span}.`;
  const direction = pennies > 0 ? "Up" : "Down";
  return `${direction} ${formatPrice(Math.abs(deltaGbp))} ${span}.`;
}

/**
 * Said in place of a movement when two dated figures cannot be shown to be the
 * same pint at an ordinary price (lib/priceHistory.ts, `sameComparisonItem`).
 * Both figures still print; only the claim that one thing went up or down is
 * withheld.
 */
export const PRICE_NOT_COMPARED_LINE = "We can't tell it was the same pint, so we don't call it a change.";
