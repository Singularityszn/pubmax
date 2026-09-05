import type { PriceBandThresholds } from "../lib/priceBand";

export const PRICE_BANDS_PATH: string;

export type PriceBandTable = {
  rule: string;
  minSample: number;
  all: PriceBandThresholds;
  cities: Record<string, PriceBandThresholds>;
  sampleSizes: Record<string, number>;
};

/** Pint prices per enabled city, read from the packs on disk. */
export function readCityPintPrices(root?: string): Promise<Map<string, number[]>>;

/** The table lib/priceBand.ts reads. Pure over the per-city price lists. */
export function buildPriceBandTable(
  byCity: Map<string, number[]>,
  minSample?: number,
): PriceBandTable;
