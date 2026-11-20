import { formatGbp } from "@/lib/formatGbp";
import { hasPintPriceCap, NO_PINT_PRICE_CAP } from "@/lib/pintPriceCapValue";

// All map price controls share this owner. A custom dial value must remain
// visible as a choice, so controls read pintPriceCapsFor rather than presets alone.

export type PintPriceCap = {
  kind?: "custom";
  /** The `Filters.maxPrice` this cap writes. `NO_PINT_PRICE_CAP` is "Any". */
  maxPrice: number;
  /** The full label, for a chip with room for it: "Any", "≤ £5.50". */
  label: string;
  /** The label for a segmented row whose legend already says "Maximum". */
  shortLabel: string;
  /** The band dot a chip wears (the price-band colours, never coral). */
  tone: "any" | "green" | "amber";
};

export function pintPriceCapFigure(maxPrice: number): string {
  // A whole-pound cap reads "£7", never "£7.00".
  return Number.isInteger(maxPrice) ? `£${maxPrice}` : formatGbp(maxPrice);
}

export function pintPriceCapLabel(maxPrice: number): string {
  return hasPintPriceCap(maxPrice) ? `≤ ${pintPriceCapFigure(maxPrice)}` : "Any";
}

function cap(maxPrice: number, tone: PintPriceCap["tone"]): PintPriceCap {
  if (!hasPintPriceCap(maxPrice)) {
    return { maxPrice: NO_PINT_PRICE_CAP, label: pintPriceCapLabel(maxPrice), shortLabel: "Any", tone: "any" };
  }
  return { maxPrice, label: pintPriceCapLabel(maxPrice), shortLabel: pintPriceCapFigure(maxPrice), tone };
}

const ANY_CAP = cap(NO_PINT_PRICE_CAP, "any");

/**
 * The five base caps, loosest first. "Any" leads because it is the one OFF value and
 * what a fresh visitor starts on (see NO_PINT_PRICE_CAP).
 */
export const PINT_PRICE_CAPS: readonly PintPriceCap[] = [
  ANY_CAP,
  cap(7, "amber"),
  cap(6, "amber"),
  cap(5.5, "green"),
  cap(5, "green"),
];

/** The caps tightest first, the order a slider runs from left to right. */
export const PINT_PRICE_CAPS_ASCENDING: readonly PintPriceCap[] = [...PINT_PRICE_CAPS].sort(
  (a, b) => a.maxPrice - b.maxPrice,
);

/** True when `maxPrice` is the cap in force. "Any" is in force only when no cap applies. */
export function pintPriceCapIsActive(currentMaxPrice: number, capMaxPrice: number): boolean {
  return !hasPintPriceCap(capMaxPrice)
    ? !hasPintPriceCap(currentMaxPrice)
    : Math.abs(currentMaxPrice - capMaxPrice) < 0.01;
}

/**
 * The index in PINT_PRICE_CAPS_ASCENDING of the cap nearest `maxPrice`. A value
 * from an old link or an earlier slider ("£6.25") lands on its nearest cap; a
 * tie goes to the looser cap, so a snap never hides a pub the reader could see.
 */
export function nearestPintPriceCapIndex(maxPrice: number): number {
  const value = hasPintPriceCap(maxPrice) ? maxPrice : NO_PINT_PRICE_CAP;
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

function exactPintPriceCap(value: number): boolean {
  return Number.isFinite(value) && value >= 3 && value <= 8 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

/**
 * Preserve £3 to £8 values in 10p steps. Snap other external values to the
 * nearest base cap. Restore paths use this result so the displayed ceiling
 * matches the applied ceiling.
 */
export function appliedPintPriceCap(maxPrice: number): number {
  return exactPintPriceCap(maxPrice) ? maxPrice : nearestPintPriceCap(maxPrice).maxPrice;
}

/** A dial value is an exact entry in the shared cap set. */
export function pintPriceCapsFor(value: number): readonly PintPriceCap[] {
  if (PINT_PRICE_CAPS.some((entry) => pintPriceCapIsActive(value, entry.maxPrice)) || !exactPintPriceCap(value)) return PINT_PRICE_CAPS;
  const custom: PintPriceCap = { ...cap(value, nearestPintPriceCap(value).tone), kind: "custom", shortLabel: formatGbp(value) };
  return [...PINT_PRICE_CAPS, custom].sort((a, b) => b.maxPrice - a.maxPrice);
}

export function pintPriceCapsAscendingFor(value: number): readonly PintPriceCap[] {
  return [...pintPriceCapsFor(value)].sort((a, b) => a.maxPrice - b.maxPrice);
}
