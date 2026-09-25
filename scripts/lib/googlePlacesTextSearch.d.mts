export type PlacesSearchPayload = {
  textQuery: string;
  fetchedAt: string;
  httpStatus: number;
  body: { places?: unknown[] };
};

export function createPlacesTextSearchClient(options: {
  apiKey: string;
  maxLiveCalls?: number;
  fetchImpl?: typeof fetch;
}): {
  searchText: (textQuery: string) => Promise<PlacesSearchPayload>;
  getLiveCallCount: () => number;
};

export function placesFromSearchPayload(
  payload: { body?: { places?: unknown[] } },
): unknown[];
