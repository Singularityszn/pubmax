import type { BuiltEstimate } from "./ukEstimateModel.mjs";

type EstimateRow = {
  venueId: string;
  standing: string;
  category: string;
  priceGbp: number;
  sampleSize: number | null;
  observedAt: string;
  basis: string | null;
};

type ProjectedEstimate = Omit<BuiltEstimate, "basis"> & {
  basis: BuiltEstimate["basis"] | "regional_baseline" | "chain_menu";
  computedAt: string;
};

export function indexUkBeerEstimates(rows: readonly EstimateRow[]): Map<string, ProjectedEstimate>;
