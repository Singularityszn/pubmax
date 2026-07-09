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
 * Wave K2 — warm `/map` navigation on intent.
 * Prefetches the Next.js route chunk and the slim map payloads once per session.
 * Does not prefetch full venue detail.
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
  if (prefetchHref === "/map") warmMapIntent();
}
