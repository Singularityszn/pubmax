import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.location";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Gitignored operator cache; never commit raw Places responses. */
export const DEFAULT_CACHE_DIR = join(
  __dirname,
  "../../data/famous_venues/.places_text_search_cache",
);

function cacheKey(textQuery) {
  return createHash("sha256").update(textQuery).digest("hex");
}

export function placesCacheFilePath(cacheDir, textQuery) {
  return join(cacheDir, `${cacheKey(textQuery)}.json`);
}

function isSuccessfulCachePayload(payload) {
  const status = payload?.httpStatus;
  return typeof status === "number" && status >= 200 && status < 300;
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
  /** When false, live `--places` always hits the API and only writes the cache (never reads it). */
  readCache = false,
}) {
  let liveCallCount = 0;

  async function searchText(textQuery) {
    mkdirSync(cacheDir, { recursive: true });
    const path = placesCacheFilePath(cacheDir, textQuery);
    if (readCache && existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, "utf8"));
      if (isSuccessfulCachePayload(cached)) {
        return { ...cached, fromCache: true, textQuery };
      }
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
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    const payload = {
      textQuery,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      body,
    };
    if (response.ok) {
      writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
    }
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
