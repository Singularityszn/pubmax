export declare const COMMON_SITEMAP_URL: string;
export declare const COMMON_SOURCE: { label: "common"; url: string };
export declare const COMMON_USER_AGENT: string;
export declare const COMMON_FETCH_GAP_MS: number;

export type CommonOgPrefix = { placeName: string; dateText: string };
export type CommonParsedPost = { title: string; placeName: string; dateText: string };

export declare function parseCommonOgPrefix(text: string): CommonOgPrefix | null;
export declare function parseCommonPostHtml(html: string): CommonParsedPost | null;
export declare function parseCommonSitemap(xml: string): string[];
export declare function isStaleCommonDate(dateText: string, todayLondon: string): boolean;

export type CommonEventRow = {
  id: string;
  placeName: string;
  kind: "event";
  startsAt: string;
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
}): Promise<{
  rows: CommonEventRow[];
  droppedStale: number;
  droppedUnparseable: number;
  droppedFetch: number;
}>;
