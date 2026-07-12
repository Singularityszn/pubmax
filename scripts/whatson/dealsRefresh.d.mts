// Hand-maintained declarations for dealsRefresh.mjs so the vitest suite
// (__tests__/whatsOnDeals.test.ts) type-checks under the repo's
// allowJs:false tsconfig. Keep in sync with the runtime module.

export type ChainSource = { label: string; url: string };

export declare const WETHERSPOONS_FOOD_DRINK_SOURCE: ChainSource;
export declare const WETHERSPOONS_PRICING_SOURCE: ChainSource;

export type WetherspoonsDealDef = {
  id: string;
  dayName: string;
  startTime: string;
  endTime: string;
  title: string;
  terms: string;
};

export declare const WETHERSPOONS_DEALS: WetherspoonsDealDef[];

export type WetherspoonsPubRecord = {
  slug?: string;
  name?: string;
  postcode?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type WhatsOnDealRow = {
  id: string;
  placeName: string;
  lat?: number;
  lng?: number;
  kind: "deal";
  startsAt: string;
  endsAt?: string;
  title: string;
  detail: string;
  source: ChainSource;
  observedAt: string;
  confidence: "listed";
};

export declare function londonWallClockToIso(
  dateStr: unknown,
  timeStr: unknown,
): string | null;

export declare function filterGreaterLondonWetherspoons(
  pubs: WetherspoonsPubRecord[],
): WetherspoonsPubRecord[];

export declare function buildWetherspoonsDealRows(input: {
  deals: WetherspoonsDealDef[];
  venues: WetherspoonsPubRecord[];
  observedAt: string;
}): WhatsOnDealRow[];
