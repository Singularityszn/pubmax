export type PricedRow = {
  pub_name?: string;
  address?: string;
  [key: string]: unknown;
};

export type PricedIndexExclusion = {
  name: string;
  address: string;
  reason: string;
};

export const PRICED_INDEX_EXCLUSIONS_FILE: string;

export function excludedPricedVenueKey(entry: {
  name?: string;
  address?: string;
}): string;

export function pricedRowExclusionMatch(
  row: PricedRow,
  exclusions: PricedIndexExclusion[],
): PricedIndexExclusion | null;

export function findExcludedPricedRows(
  rows: PricedRow[],
  exclusions: PricedIndexExclusion[],
): Array<{ index: number; row: PricedRow; exclusion: PricedIndexExclusion }>;

export function isValidExclusionEntry(entry: unknown): entry is PricedIndexExclusion;
