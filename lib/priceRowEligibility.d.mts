export const PRICE_SUPERSEDED_REASONS: readonly ["operator_change", "chain_withdrew"];

export type PriceSupersededReason = (typeof PRICE_SUPERSEDED_REASONS)[number];

export type PriceSuperseded = {
  reason: PriceSupersededReason;
  /** The operator that published the price and has since left. */
  operator: string;
  /** The day a source states the operator left, or null where no source states one. */
  left_on: string | null;
  /** What the sources state, in one or two sentences. */
  evidence: string;
  evidence_urls: string[];
  /** The day the marker was written. */
  recorded_on: string;
};

export function isSupersededPriceRow(row: { price_superseded?: unknown } | null | undefined): boolean;
export function isLivePriceRow(row: { price_superseded?: unknown } | null | undefined): boolean;
export function priceSupersededErrors(row: { price_superseded?: unknown } | null | undefined): string[];
