import type { CityId } from "@/lib/cities";
import {
  lastRideFetchUrl,
  type LastRideResult,
} from "@/lib/lastRide";

const CLIENT_CACHE_TTL_MS = 60_000;
const CLIENT_CACHE_LIMIT = 32;

type LastRidePayload = Partial<LastRideResult> & { error?: string };
type CacheEntry = {
  expiresAt: number;
  promise: Promise<LastRidePayload>;
};

const resultCache = new Map<string, CacheEntry>();

function trimCache(): void {
  while (resultCache.size > CLIENT_CACHE_LIMIT) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    resultCache.delete(oldestKey);
  }
}

export function loadLastRide(
  cityId: CityId,
  lat: number,
  lng: number,
): Promise<LastRidePayload> | null {
  const url = lastRideFetchUrl(cityId, lat, lng);
  if (!url) return null;

  const now = Date.now();
  const cached = resultCache.get(url);
  if (cached && cached.expiresAt > now) {
    resultCache.delete(url);
    resultCache.set(url, cached);
    return cached.promise;
  }
  if (cached) resultCache.delete(url);

  const promise = fetch(url)
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(new Error(String(response.status))),
    )
    .then((data: LastRidePayload) => data)
    .catch((error: unknown) => {
      resultCache.delete(url);
      throw error;
    });
  resultCache.set(url, { expiresAt: now + CLIENT_CACHE_TTL_MS, promise });
  trimCache();
  return promise;
}

export function prefetchLastRide(cityId: CityId, lat: number, lng: number): void {
  void loadLastRide(cityId, lat, lng)?.catch(() => {
    // Prefetch is opportunistic. LastTrainCard owns the visible fallback.
  });
}

export function __resetLastRideClientCache(): void {
  resultCache.clear();
}
