import type { FoodPriceUpdate } from "../lib/foodPriceUpdates.ts";

export type FoodPricePack = { $comment: string; version: 1; generatedAt: string; updates: FoodPriceUpdate[] };

export declare function publishedFoodRow(row: Record<string, unknown>): Record<string, unknown>;
export declare function buildFoodPricePack(input: {
  existing: unknown;
  harvested: ReadonlyArray<Record<string, unknown>>;
  now?: number;
}): {
  pack: FoodPricePack;
  summary: {
    harvested: number;
    accepted: number;
    notPublished: number;
    venuesRestated: number;
    rowsKeptFromEarlierReads: number;
    rows: number;
    generatedAt: string;
  };
};
