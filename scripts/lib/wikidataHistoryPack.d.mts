export const WIKIDATA_HISTORY_PACK_VERSION: 1;
export const WIKIDATA_SOURCE: Readonly<{ source: string; sourceUrl: string; license: string; licenseUrl: string }>;
export const HISTORY_PROPERTIES: readonly ["P571", "P1435", "P149", "P84"];
export type HistoryFact = [property: string, value: string];
export type WikidataHistoryPack = {
  version: 1;
  source: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  retrievedAt: string;
  counts: { wanted: number; withHistory: number };
  items: Record<string, HistoryFact[]>;
};
export function historyQuery(qids: readonly string[]): string;
export function timeAtPrecision(value: unknown, precision: unknown): string | null;
export function compactBinding(binding: unknown): [string, HistoryFact] | null;
export function wantedQids(linksPack: unknown): Set<string>;
export function buildWikidataHistoryPack(input: {
  wanted: Set<string>;
  bindings: readonly unknown[];
  retrievedAt: string;
}): WikidataHistoryPack;
export function wikidataSparqlRead(
  query: string,
  options?: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    baseDelayMs?: number;
  },
): Promise<unknown[]>;
