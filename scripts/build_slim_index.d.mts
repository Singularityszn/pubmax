export type SlimCurationInput = {
  pub_name?: unknown;
  address?: unknown;
  description?: unknown;
  comment?: unknown;
  price_gbp?: number | null;
  source_datasets?: unknown;
};

export type SlimDrinkHintInput = {
  pint_name?: unknown;
  comment?: unknown;
  description?: unknown;
  cocktails?: unknown;
};

export function buildCurationHints(prices: readonly SlimCurationInput[]): {
  nearWater: boolean;
  hasStory: boolean;
};

export function buildDrinkHints(prices: readonly SlimDrinkHintInput[]): {
  drinkCategories: string[];
  drinkBrands: string[];
  drinkText: string;
};

export function assertCurrentFamousVenueRows<
  T extends {
    id: string;
    observedAt: string;
    expiresAt: string;
  },
>(rows: T[], now: Date | number): T[];

export function famousRowsForRebuild<
  T extends {
    id: string;
    observedAt: string;
    expiresAt: string;
  },
>(
  seedRows: T[],
  options: {
    lastSlim: { generatedAt?: unknown; rows?: unknown } | null;
    removedIds: readonly string[];
    refreshAt: Date | null;
  },
): { builtAt: Date; rows: T[] };

export function typeRelativePriceBands<
  T extends {
    id: string;
    kind: "bar" | "food" | "restaurant";
    anchor: { price: number };
  },
>(rows: readonly T[]): Map<string, 0 | 1 | 2>;
