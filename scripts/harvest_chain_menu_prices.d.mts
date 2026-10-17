import type { HarvestSource } from "../lib/harvest/sourcePolicy.ts";

type RobotsAnswer = { allowed: boolean; reason: string; evidence: string };
type RobotsAsk = (url: string) => Promise<RobotsAnswer>;

export type ChainPageRead = {
  ok: boolean;
  status: number;
  body: string;
  redirectedAway?: boolean;
  landedUrl?: string;
  error?: string;
};

/** One chain page, refused unread when its redirect lands off the source's own hosts. */
export declare function fetchText(
  url: string,
  options: { sourceId: string; fetchImpl?: typeof fetch },
): Promise<ChainPageRead>;

/** The menu pages a source names about itself, put back through its own allow-list. */
export declare function menuPagesFor(
  source: HarvestSource,
  spend: () => boolean,
  options: { robots: RobotsAsk; fetchImpl?: typeof fetch },
): Promise<{ pages: string[]; offAllowList: number; refusal: RobotsAnswer | null }>;

export type ChainPriceRow = {
  url: string;
  priceGbp: number;
  drinkLabel?: string;
  sourceId: string;
  label: string;
  observedAt: string;
};

export type ChainHarvestReport = {
  version: 1;
  generatedAt: string;
  pagesRead: number;
  pageBudget: number;
  sourcesAllowed: string[];
  sourcesSkipped: Array<{ id: string; reason: string; checkedOn: string; evidence: string }>;
  coverage: Array<{ city: string; pagesRead: number; venuesPriced: number; pagesWithNoPrice: number }>;
  drops: Record<string, number>;
  rowsFound: number;
};

/** One run over the chain sources, its network and clock edges injectable. */
export declare function harvestChainMenuPrices(options?: {
  sources?: readonly HarvestSource[];
  fetchImpl?: typeof fetch;
  robots?: RobotsAsk;
  sleepImpl?: (ms: number) => Promise<void>;
  pageBudget?: number;
}): Promise<{
  report: ChainHarvestReport;
  rows: ChainPriceRow[];
  skipped: ChainHarvestReport["sourcesSkipped"];
  allowed: HarvestSource[];
  spent: number;
}>;
