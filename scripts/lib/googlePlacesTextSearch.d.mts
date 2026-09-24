export const DEFAULT_CACHE_DIR: string;

export function placesCacheFilePath(cacheDir: string, textQuery: string): string;

export function createPlacesTextSearchClient(options: {
  apiKey: string;
  cacheDir?: string;
  maxLiveCalls?: number;
  fetchImpl?: typeof fetch;
}): {
  searchText: (textQuery: string) => Promise<Record<string, unknown>>;
  getLiveCallCount: () => number;
  cacheDir: string;
};

export function placesFromSearchPayload(
  payload: { body?: { places?: unknown[] } },
): unknown[];
