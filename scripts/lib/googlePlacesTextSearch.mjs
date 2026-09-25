const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.location";

/**
 * Live Places Text Search only: responses are never cached or written to disk.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {number} [options.maxLiveCalls]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPlacesTextSearchClient({
  apiKey,
  maxLiveCalls = 100,
  fetchImpl = fetch,
}) {
  let liveCallCount = 0;

  async function searchText(textQuery) {
    if (liveCallCount >= maxLiveCalls) {
      throw new Error(
        `Places Text Search budget exhausted (${maxLiveCalls} live calls)`,
      );
    }
    liveCallCount += 1;
    const response = await fetchImpl(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery }),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    return {
      textQuery,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      body,
    };
  }

  return {
    searchText,
    getLiveCallCount: () => liveCallCount,
  };
}

export function placesFromSearchPayload(payload) {
  if (!payload?.body) return [];
  if (Array.isArray(payload.body.places)) return payload.body.places;
  return [];
}
