import { formatGbp } from "@/lib/formatGbp";
import { NO_PINT_PRICE_CAP } from "@/lib/venues";

// ONE SET OF PINT PRICE CAPS. The desktop Layers chips offered Any, ≤ £5.50 and
// ≤ £7; the phone's Map controls sheet offered Any, £7, £6 and £5.50; the
// planner rail had a free slider in 25p steps. Three surfaces, three answers to
// the same question (launch UX micro-fix 3, 30 Oct 2026). Every surface now
// reads this list, and the rail's slider snaps to it.

export type PintPriceCap = {
  /** The `Filters.maxPrice` this cap writes. `NO_PINT_PRICE_CAP` is "Any". */
  maxPrice: number;
  /** The full label, for a chip with room for it: "Any", "≤ £5.50". */
  label: string;
  /** The label for a segmented row whose legend already says "Maximum". */
  shortLabel: string;
  /** The band dot a chip wears (the price-band colours, never coral). */
  tone: "any" | "green" | "amber";
};

function capLabel(maxPrice: number): string {
  // A whole-pound cap reads "£7", never "£7.00".
  return Number.isInteger(maxPrice) ? `£${maxPrice}` : formatGbp(maxPrice);
}

function cap(maxPrice: number, tone: PintPriceCap["tone"]): PintPriceCap {
  if (maxPrice >= NO_PINT_PRICE_CAP) {
    return { maxPrice: NO_PINT_PRICE_CAP, label: "Any", shortLabel: "Any", tone: "any" };
  }
  return { maxPrice, label: `≤ ${capLabel(maxPrice)}`, shortLabel: capLabel(maxPrice), tone };
}

const ANY_CAP = cap(NO_PINT_PRICE_CAP, "any");

/**
 * The four caps, loosest first. "Any" leads because it is the one OFF value and
 * what a fresh visitor starts on (see NO_PINT_PRICE_CAP).
 */
export const PINT_PRICE_CAPS: readonly PintPriceCap[] = [
  ANY_CAP,
  cap(7, "amber"),
  cap(6, "amber"),
  cap(5.5, "green"),
];

/** The caps tightest first, the order a slider runs from left to right. */
export const PINT_PRICE_CAPS_ASCENDING: readonly PintPriceCap[] = [...PINT_PRICE_CAPS].sort(
  (a, b) => a.maxPrice - b.maxPrice,
);

/** True when `maxPrice` is the cap in force. Every value at or over the OFF value is "Any". */
export function pintPriceCapIsActive(currentMaxPrice: number, capMaxPrice: number): boolean {
  return capMaxPrice >= NO_PINT_PRICE_CAP
    ? currentMaxPrice >= NO_PINT_PRICE_CAP
    : Math.abs(currentMaxPrice - capMaxPrice) < 0.01;
}

/**
 * The index in PINT_PRICE_CAPS_ASCENDING of the cap nearest `maxPrice`. A value
 * from an old link or an earlier slider ("£6.25") lands on its nearest cap; a
 * tie goes to the looser cap, so a snap never hides a pub the reader could see.
 */
export function nearestPintPriceCapIndex(maxPrice: number): number {
  const value = Number.isFinite(maxPrice) ? Math.min(maxPrice, NO_PINT_PRICE_CAP) : NO_PINT_PRICE_CAP;
  let best = PINT_PRICE_CAPS_ASCENDING.length - 1;
  let bestGap = Number.POSITIVE_INFINITY;
  PINT_PRICE_CAPS_ASCENDING.forEach((candidate, index) => {
    const gap = Math.abs(candidate.maxPrice - value);
    if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && index > best)) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/** The cap nearest `maxPrice`. */
export function nearestPintPriceCap(maxPrice: number): PintPriceCap {
  return PINT_PRICE_CAPS_ASCENDING[nearestPintPriceCapIndex(maxPrice)] ?? ANY_CAP;
}

/**
 * The `Filters.maxPrice` a figure from outside the controls is applied as: the
 * nearest shared cap. Every owner that reads a cap from a link, a saved session
 * or a handoff runs it through here, so the cap the map applies is the cap
 * every control prints (review finding 4, PR 2402). A rail that said "≤ £6"
 * while £6.25 still filtered the map was printing one cap and applying another.
 */
export function appliedPintPriceCap(maxPrice: number): number {
  return nearestPintPriceCap(maxPrice).maxPrice;
}
