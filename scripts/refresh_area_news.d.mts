import type { AreaNewsEntry, KeenablePage, KeenableResult } from "./lib/keenableAreaNews.d.mts";

export type AreaNewsSnapshot = {
  version: 1;
  generatedAt: string;
  entries: AreaNewsEntry[];
  [key: string]: unknown;
};

export const AREA_NEWS_DATASET_PATH: string;
export const AREA_NEWS_DATASET_COMMENT: string;
export const AREA_NEWS_REFRESH_QUERIES: readonly string[];

export function readAreaNewsDataset(path?: string): AreaNewsSnapshot;
export function writeAreaNewsDataset(snapshot: AreaNewsSnapshot, path?: string): void;
export function refreshAreaNews(input?: {
  now?: number | string;
  queries?: readonly string[];
  env?: Record<string, unknown>;
  knownAreas?: ReadonlySet<string>;
  searchFn?: (query: string, options?: Record<string, unknown>) => Promise<KeenableResult[]>;
  fetchFn?: (url: string, options?: Record<string, unknown>) => Promise<KeenablePage>;
  previousDataset?: AreaNewsSnapshot;
  writeDataset?: (snapshot: AreaNewsSnapshot) => void;
  logger?: (line: string) => void;
  maxResults?: number;
  maxCandidates?: number;
}): Promise<AreaNewsSnapshot>;
