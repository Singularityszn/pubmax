import { getCity, parseCityId } from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";

export type MapWarmConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

export type MapWarmFetchInit = {
  cache?: "force-cache";
};

export type MapWarmDeps = {
  fetch: (url: string, init?: MapWarmFetchInit) => Promise<unknown>;
  navigator: unknown;
  paths?: readonly string[];
  seen?: Set<string>;
};

export const MAP_INTENT_WARM_PATHS = [
  "/data/venues_slim.json",
  "/data/london_pois.json",
  "/data/tfl_lines.json",
] as const;

const BLOCKED_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);
const sessionSeen = new Set<string>();

/** Slim (+ optional POI/transit) paths to warm for a map href. */
export function warmPathsForMapHref(href: string): readonly string[] {
  const path = href.split("?")[0] || href;
  if (path === "/map" || path === "/map/") return MAP_INTENT_WARM_PATHS;
  const match = /^\/map\/([^/]+)\/?$/.exec(path);
  if (!match) return MAP_INTENT_WARM_PATHS;
  const cityId = parseCityId(match[1]);
  if (!cityId) return MAP_INTENT_WARM_PATHS;
  const city = getCity(cityId);
  const paths: string[] = [city.slimVenuesPath];
  if (city.poisPath) paths.push(city.poisPath);
  if (city.transitLinesPath) paths.push(city.transitLinesPath);
  return paths;
}

export function shouldWarmMapIntent(nav: unknown): boolean {
  if (!nav || typeof nav !== "object") return false;

  const connection = (nav as { connection?: unknown }).connection;
  if (!connection) return true;
  if (typeof connection !== "object") return true;

  const { saveData, effectiveType } = connection as MapWarmConnection;
  if (saveData === true) return false;
  return !(
    typeof effectiveType === "string" && BLOCKED_EFFECTIVE_TYPES.has(effectiveType)
  );
}

export function warmMapIntentData({
  fetch: doFetch,
  navigator: nav,
  paths = MAP_INTENT_WARM_PATHS,
  seen,
}: MapWarmDeps): void {
  if (!shouldWarmMapIntent(nav)) return;

  for (const path of paths) {
    if (seen?.has(path)) continue;
    seen?.add(path);

    try {
      void Promise.resolve(doFetch(path, { cache: "force-cache" })).catch(() => {
        // Best-effort warmup only. Navigation must never depend on it.
      });
    } catch {
      // Best-effort warmup only. Navigation must never depend on it.
    }
  }
}

export function warmMapIntent(): void {
  warmMapIntentData({
    fetch: (url, init) =>
      typeof fetch === "function"
        ? fetch(url, init)
        : Promise.reject(new Error("fetch unavailable")),
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    seen: sessionSeen,
  });
}

/** Session-deduped route prefetch + slim-data warm (landing CTAs + tab bar). */
const warmedRoutes = new Set<string>();

export type MapRoutePrefetcher = {
  prefetch: (href: string) => void;
};

/**
 * Wave K2 — warm map navigation on intent.
 * Prefetches the Next.js route chunk and the city slim (+ POI/transit) payloads
 * once per session. Does not prefetch full venue detail.
 */
export function warmMapRoute(
  router: MapRoutePrefetcher,
  href = "/map",
  seen: Set<string> = warmedRoutes,
): void {
  const prefetchHref = href.split("?")[0] || href;
  if (seen.has(prefetchHref)) return;
  seen.add(prefetchHref);
  try {
    router.prefetch(prefetchHref);
  } catch {
    // Best-effort — navigation must never depend on prefetch.
  }
  // Only warm slim/POI payloads for map routes (not Discover etc.).
  if (prefetchHref === "/map" || prefetchHref.startsWith("/map/")) {
    warmMapIntentData({
      fetch: (url, init) =>
        typeof fetch === "function"
          ? fetch(url, init)
          : Promise.reject(new Error("fetch unavailable")),
      navigator: typeof navigator !== "undefined" ? navigator : undefined,
      paths: warmPathsForMapHref(prefetchHref),
      seen: sessionSeen,
    });
  }
}

/** Convenience: warm the share URL for a known city id. */
export function warmCityMapRoute(
  router: MapRoutePrefetcher,
  cityId: string,
  seen?: Set<string>,
): void {
  warmMapRoute(router, cityMapShareUrl(cityId), seen);
}
