export type OsmPub = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  postcode?: string | null;
  website?: string | null;
  operator?: string | null;
  brewery?: string | null;
  /** Set by the UK OSM pack when this pub already exists in curated data. */
  curatedRef?: { source: string; id: string } | null;
};

export type TavilyPrice = {
  venueKey: string;
  drinkName: string;
  category: "beer";
  priceGbp: number;
  servingSize: "pint" | "568ml";
  source: { label: string; url: string; licence: string };
  observedAt: string;
};

export type TavilyEnrichmentResult = {
  city: string;
  totalPubs: number;
  startIndex: number;
  nextIndex: number;
  queriesSpent: number;
  creditsSpent: number;
  matchedPubs: number;
  prices: TavilyPrice[];
  pages: Array<Record<string, unknown>>;
  delegatedChains: Array<{ pub: OsmPub; chain: string; harvester: string }>;
  /** One entry per venue the run resolved, in the order it resolved them. */
  outcomes?: VenueEnrichmentOutcome[];
  complete: boolean;
};

export const CITY_DEFINITIONS: Readonly<
  Record<string, { id: string; displayName: string; bbox: [number, number, number, number] }>
>;
export const OFFICIAL_SITE_SOURCE_LICENCE: string;

export type SearchProvider = {
  search(options: Record<string, unknown>): Promise<{
    results: Array<Record<string, unknown>>;
    creditsSpent?: number;
  }>;
};

export function venueKeyForOsmPub(pub: OsmPub): string;
export function classifyChainPub(
  pub: OsmPub,
): { chain: string; harvester: string } | null;
export function selectCityPubs(cityId: string, allPubs: OsmPub[]): OsmPub[];
export function isOfficialResult(
  pub: OsmPub,
  result: { title?: string; url?: string; content?: string },
): boolean;
export function extractPintPrices(
  markdown: string,
): Array<{ drinkName: string; priceGbp: number; servingSize: "pint" | "568ml" }>;
export function mergeCanonicalPrices<T extends {
  venueKey: string;
  drinkName: string;
  category: string;
}>(existing: T[], incoming: T[]): T[];
/** What one venue in a run came to. `failed` means a query was spent on it and
 *  no answer came back, which is what the scheduler owes a bounded retry. */
export type VenueEnrichmentOutcome = {
  index: number;
  osmId: string;
  status: "matched" | "empty" | "delegated" | "no-website" | "refused-source" | "failed";
  error?: string;
};

export const TAVILY_CREDITS_PER_SEARCH: number;
export const MAX_TAVILY_CREDITS_PER_RUN: number;

export function runCityEnrichment(options: {
  city: string;
  pubs: OsmPub[];
  apiKey?: string;
  searchProvider?: SearchProvider;
  maxQueries?: number;
  /** Lowers the credit ceiling (400 per run); it can never raise it. */
  maxCredits?: number;
  startIndex?: number;
  /** Explicit venues to walk, for re-attempting ones a previous run deferred.
   *  When given it replaces the sequential sweep and leaves the cursor alone. */
  indices?: number[];
  observedAt?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (state: Record<string, unknown>) => void | Promise<void>;
  /** A venue whose search failed is a fact about that venue, not the run. The
   *  default is "abort", so every existing caller keeps its old behaviour. */
  onVenueError?: (info: {
    pub: OsmPub;
    index: number;
    error: unknown;
  }) => "abort" | "continue";
  signal?: AbortSignal;
}): Promise<TavilyEnrichmentResult>;
