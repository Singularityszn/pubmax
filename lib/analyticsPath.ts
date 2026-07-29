const PRODUCT_EVENT_STATIC_SURFACES = new Set([
  "/",
  "/map",
  "/moment",
  "/pal",
  "/plan",
  "/stories",
  "/tonight",
  "/you",
]);

const PAGEVIEW_STATIC_SURFACES = new Set([
  "/",
  "/about",
  "/activity",
  "/borough",
  "/choose-city",
  "/contributors",
  "/crawls",
  "/discover",
  "/drinks",
  "/feed",
  "/historic",
  "/map",
  "/messages",
  "/moment",
  "/near",
  "/onboarding",
  "/pal",
  "/pal/chat",
  "/pint-index",
  "/plan",
  "/privacy",
  "/profile",
  "/pubs",
  "/rounds",
  "/stories",
  "/terms",
  "/today",
  "/tonight",
  "/we-are-out",
  "/you",
]);

const PRODUCT_EVENT_DYNAMIC_SURFACES: readonly [RegExp, string][] = [
  [/^\/messages\/[^/]+$/, "/messages/[id]"],
  [/^\/plan\/[^/]+$/, "/plan/[id]"],
  [/^\/rounds\/[^/]+$/, "/rounds/[code]"],
  [/^\/u\/[^/]+$/, "/u/[handle]"],
];

const PAGEVIEW_DYNAMIC_SURFACES: readonly [RegExp, string][] = [
  [/^\/add\/[^/]+$/, "/add/[handle]"],
  [/^\/bar-tab\/[^/]+$/, "/bar-tab/[id]"],
  [/^\/borough\/[^/]+$/, "/borough/[slug]"],
  [/^\/crawls\/[^/]+$/, "/crawls/[slug]"],
  [/^\/historic\/[^/]+$/, "/historic/[slug]"],
  [/^\/landmark\/[^/]+$/, "/landmark/[id]"],
  [/^\/ledger\/[^/]+$/, "/ledger/[id]"],
  [/^\/map\/[^/]+$/, "/map/[city]"],
  [/^\/messages\/[^/]+$/, "/messages/[id]"],
  [/^\/p\/[^/]+$/, "/p/[id]"],
  [/^\/pint-index\/[^/]+$/, "/pint-index/[month]"],
  [/^\/plan\/[^/]+$/, "/plan/[id]"],
  [/^\/plan\/[^/]+\/recap$/, "/plan/[id]/recap"],
  [/^\/recap\/[^/]+$/, "/recap/[storyId]"],
  [/^\/rounds\/[^/]+$/, "/rounds/[code]"],
  [/^\/u\/[^/]+$/, "/u/[handle]"],
  [/^\/u\/[^/]+\/lists\/[^/]+$/, "/u/[handle]/lists/[listType]"],
];

export function analyticsUrlWithoutQuery(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Validate the path shape shared by analytics sinks. Unknown encoded values
 * fail closed before either purpose-specific vocabulary is applied.
 */
function safeAnalyticsPathname(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 120) return null;
  const pathname = path.split("?")[0];
  if (
    pathname.includes("#")
    || pathname.includes("%")
    || /[\u0000-\u001f\u007f]/.test(pathname)
  ) return null;
  return pathname;
}

/**
 * Original closed path vocabulary for registry-known product events.
 * Pageview work must not widen which product-event paths leave the browser.
 */
export function analyticsSurfaceFromPath(path: unknown): string | null {
  const pathname = safeAnalyticsPathname(path);
  if (!pathname) return null;
  if (PRODUCT_EVENT_STATIC_SURFACES.has(pathname)) return pathname;
  return PRODUCT_EVENT_DYNAMIC_SURFACES
    .find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** Closed pageview vocabulary with every dynamic value replaced by a template. */
export function analyticsPageviewSurfaceFromPath(path: unknown): string | null {
  const pathname = safeAnalyticsPathname(path);
  if (!pathname) return null;
  if (PAGEVIEW_STATIC_SURFACES.has(pathname)) return pathname;
  return PAGEVIEW_DYNAMIC_SURFACES
    .find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}
