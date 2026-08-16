export declare const COMMON_SITEMAP_URL: string;
export declare const COMMON_SOURCE: { label: "common"; url: string };
export declare const COMMON_USER_AGENT: string;
export declare const COMMON_FETCH_GAP_MS: number;
export declare const COMMON_MAX_FETCHES_PER_RUN: number;
export declare const COMMON_TIME_EVIDENCE: string;

export type CommonOgPrefix = { placeName: string; dateText: string };
export type CommonParsedPost = { title: string; placeName: string; dateText: string };

export declare function parseCommonOgPrefix(text: string): CommonOgPrefix | null;
export declare function parseCommonPostHtml(html: string): CommonParsedPost | null;
export declare function parseCommonSitemap(xml: string): string[];

export type CommonSitemapEntry = { url: string; lastmod: number | null };
export declare function parseCommonSitemapEntries(xml: string): CommonSitemapEntry[];
export declare function commonCrawlOrder(entries: readonly CommonSitemapEntry[]): string[];
export declare function isStaleCommonDate(dateText: string, todayLondon: string): boolean;
export declare function commonStartsDate(dateText: string, todayLondon: string): string | null;

export type CommonEventRow = {
  id: string;
  placeName: string;
  kind: "event";
  /** London calendar date the post states. Common publishes no clock time. */
  startsDate: string;
  timeEvidence: string;
  title: string;
  source: { label: "common"; url: string };
  observedAt: string;
  confidence: "listed";
  sourceId: string;
};

export declare function toCommonEventRow(args: {
  url: string;
  parsed: CommonParsedPost;
  observedAt: string;
  todayLondon: string;
}): CommonEventRow | null;

export declare function refreshCommonEvents(opts?: {
  nowMs?: number;
  fetchImpl?: typeof fetch;
  outPath?: string;
  gapMs?: number;
  maxFetches?: number;
}): Promise<{
  rows: CommonEventRow[];
  droppedStale: number;
  droppedUnparseable: number;
  droppedFetch: number;
  reusedHeld: number;
  skippedOverBudget: number;
  fetched: number;
}>;
