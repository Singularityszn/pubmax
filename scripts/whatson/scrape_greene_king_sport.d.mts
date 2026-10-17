// Hand-maintained declarations for scrape_greene_king_sport.mjs so the vitest
// suite (__tests__/whatsOnHarvestPermission.test.ts) type-checks under the
// repo's allowJs:false tsconfig. Keep in sync with the runtime module.

export declare const GREENE_KING_SPORT_SOURCE_ID: string;

export declare function openGreeneKingSportReader(network?: {
  fetchImpl?: typeof fetch;
  robots?: (url: string) => Promise<{ allowed: boolean; evidence: string }>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<(url: string) => Promise<string>>;
