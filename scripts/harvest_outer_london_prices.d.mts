export type HarvestDrinkUpdate = {
  venueKey: string;
  drinkName: string;
  category: string;
  priceGbp: number;
  source: {
    label: string;
    url: string;
    licence: string;
  };
  observedAt: string;
};

export function mergeDrinkUpdates<T extends HarvestDrinkUpdate>(
  existing: T[],
  incoming: T[],
): T[];

export function priorPublishedSourceFor(
  row: { website?: string },
  priorEntries: Array<{
    website?: string;
    sourceUrl?: string;
    result?: string;
  }>,
): string | undefined;

export function pubDiscoveryAvailable(environment?: Record<string, string | undefined>): boolean;

export function outerLondonUrlRefusal(url: string, pubWebsite: string): string | null;

export function canonicalHarvestUrl(url: string): string | null;

export function selectDiscoveredOuterLondonMenu(
  candidates: readonly unknown[],
  pubWebsite: string,
): string | null;

export function fetchGatedOuterLondonPage(
  url: string,
  pubWebsite: string,
  deps: {
    fetchRefreshPage: (input: { job: string; url: string }) => Promise<unknown>;
    robotsChecker: (url: string) => Promise<{ allowed?: boolean; evidence?: string }>;
  },
): Promise<unknown>;

export function scrape(
  url: string,
  pubName: string,
  pubWebsite: string,
  robotsChecker: (url: string) => Promise<{ allowed?: boolean; evidence?: string }>,
): Promise<{
  markdown: string;
  links: string[];
  finalUrl: string;
  json: {
    drinks: import("../lib/harvest/tavilyVenueDrinkPrices").TavilyVenueDrinkPrice[];
    reading: import("../lib/harvest/ukPriceCrawl").UkPriceReading;
  };
}>;

export function verbatimValidateHarvestedDrinks(
  extracted: Array<{ drinkName: string; category: string; priceGbp: number }>,
  pagePounds: Set<string>,
): Array<{ drinkName: string; category: string; priceGbp: number }>;
