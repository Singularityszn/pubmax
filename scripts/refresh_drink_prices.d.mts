// Hand-maintained declarations for refresh_drink_prices.mjs so the vitest suite
// (__tests__/refreshDrinkPricesPermission.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

import type { DrinkUpdateRow } from "./lib/venueMatch.d.mts";

export declare const DRINK_SOURCE_POLICY_IDS: Readonly<Record<string, string>>;

export type DrinkSourceAllowlistRow = {
  id: string;
  label: string;
  url: string;
  kind: string;
  licence: string;
  permissible: boolean;
};

export declare function fetchFromDrinkSource(
  source: DrinkSourceAllowlistRow,
  options?: {
    limit?: number;
    scratchCacheDir?: string | null;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    robots?: (url: string) => Promise<{ allowed: boolean; evidence: string }>;
  },
): Promise<{ rows: DrinkUpdateRow[]; refused: string | null }>;

export declare function planLatestDrinkWrite<T extends DrinkUpdateRow>(input: {
  existing: T[];
  incoming: T[];
}): { ok: boolean; merged: T[]; replaced: number; message: string | null };

export declare function reviewBranchName(date?: Date): string;

export declare function importReviewedDrinkPrices(inputPath: string, options: {
  expectedSha256: string;
  sourcePdfPath: string;
  scratchDir?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  written: boolean;
  addedRows: number;
  totalRows: number;
  generatedAt?: string;
  inputSha256?: string;
  sourcePdfSha256?: string;
  paths?: string[];
  permissions: Array<{ url: string; allowed: boolean; reason?: string }>;
}>;
