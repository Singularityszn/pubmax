export const PRICE_SUPERSEDED_REASONS: readonly ["operator_change"];

export type PriceSupersededReason = (typeof PRICE_SUPERSEDED_REASONS)[number];

export type PriceSuperseded = {
  reason: PriceSupersededReason;
  /** The operator that published the price and has since left. */
  operator: string;
  /** The YYYY-MM-DD day a source states the operator left. */
  left_on: string;
  /** What the sources state, in one or two sentences. */
  evidence: string;
  evidence_urls: string[];
  /** The day the marker was written. */
  recorded_on: string;
};

export const PINT_PRICE_BAND_GBP: Readonly<{ minGbp: 2; maxGbp: 12 }>;

type EligibilityRow = { price_superseded?: unknown; price_gbp?: unknown } | null | undefined;

export function isSupersededPriceRow(row: { price_superseded?: unknown } | null | undefined): boolean;
export function isOutOfBandPriceRow(row: EligibilityRow): boolean;
export function isCurrentVenueRow(row: { price_superseded?: unknown } | null | undefined): boolean;
export function isLivePriceRow(row: EligibilityRow): boolean;
export function priceSupersededErrors(row: { price_superseded?: unknown } | null | undefined): string[];
