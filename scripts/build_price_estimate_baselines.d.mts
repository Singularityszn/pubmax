type DrinkModel = {
  category: "wine" | "cocktail";
  minGbp: number;
  maxGbp: number;
  servingNote: string;
};

export const DRINK_MODELS: readonly DrinkModel[];

export function buildDrinkBaselines(
  updates: ReadonlyArray<{
    venueKey: string;
    category: string;
    priceGbp: number;
    source: { url: string; [key: string]: unknown };
    [key: string]: unknown;
  }>,
  allowedHosts: Set<string>,
  boundaries: unknown,
  model: DrinkModel,
  report: { drinks: Record<string, unknown> },
): {
  minGbp: number;
  maxGbp: number;
  servingNote: string;
  regions: Array<{
    kind: "london_borough";
    code: string;
    label: string;
    medianGbp: number;
    sampleSize: number;
    operatorCount: number;
    provenance: string;
    sourceUrls: string[];
  }>;
};
