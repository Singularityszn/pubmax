import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.location";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CACHE_DIR = join(
  __dirname,
  "../../data/famous_venues/places_text_search_cache",
);

function cacheKey(textQuery) {
  return createHash("sha256").update(textQuery).digest("hex");
}

function cachePath(cacheDir, textQuery) {
  return join(cacheDir, `${cacheKey(textQuery)}.json`);
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.cacheDir]
 * @param {number} [options.maxLiveCalls]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPlacesTextSearchClient({
  apiKey,
  cacheDir = DEFAULT_CACHE_DIR,
  maxLiveCalls = 95,
  fetchImpl = fetch,
}) {
  let liveCallCount = 0;

  async function searchText(textQuery, { forceLive = false } = {}) {
    mkdirSync(cacheDir, { recursive: true });
    const path = cachePath(cacheDir, textQuery);
    if (!forceLive && existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, "utf8"));
      return { ...cached, fromCache: true, textQuery };
    }
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
    const body = await response.json();
    const payload = {
      textQuery,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      body,
    };
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
    return { ...payload, fromCache: false, textQuery };
  }

  return {
    searchText,
    getLiveCallCount: () => liveCallCount,
    cacheDir,
  };
}

export function placesFromSearchPayload(payload) {
  if (!payload?.body) return [];
  if (Array.isArray(payload.body.places)) return payload.body.places;
  return [];
}
