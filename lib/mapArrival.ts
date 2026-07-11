import type { CrawlMode } from "@/components/map/ControlRail";

/** Landing drink-shape taps (`?drink=` / `?cocktails=1`) stay on the clean map. */
export function isDrinkShapeArrival(search: string): boolean {
  return /[?&]drink=/.test(search) || /[?&]cocktails=1(?:&|$)/.test(search);
}

/**
 * Curated / featured crawl deep-links (`?crawl=` or `?pubs=` + `mode=build`).
 * Map-first: show the polyline + mapped-route chip; keep the planner closed.
 */
export function isCuratedCrawlArrival(search: string): boolean {
  return /[?&]crawl=/.test(search) || (/[?&]pubs=/.test(search) && /[?&]mode=build/.test(search));
}

/**
 * Whether a clean city map arrival should call `fitCityBounds()` once.
 *
 * Skips when the URL carries drink / crawl / pubs intent, or when a mapped
 * route is already seeded — those arrivals own the camera (filter framing or
 * `fitRoute`), and fighting them feels broken.
 */
export function shouldFitCityBoundsOnArrival(
  search: string,
  hasMappedRoute = false,
): boolean {
  if (hasMappedRoute) return false;
  if (isDrinkShapeArrival(search)) return false;
  if (isCuratedCrawlArrival(search)) return false;
  // Bare `?pubs=` without mode=build still seeds stops — leave the camera alone.
  if (/[?&]pubs=/.test(search)) return false;
  return true;
}

/**
 * Whether the planner (left drawer) should open on first paint.
 *
 * Opens for URL-seeded hand-built crawls (`pubs=`, bare `mode=build`, `style=`
 * / `mode=`). Stays closed for drink-shape arrivals, curated crawl arrivals
 * (map-first polyline), and borough browse deep-links (`?q=` only).
 */
export function shouldOpenPlanningInitially(
  seededBuiltIds: string[],
  seededMode: CrawlMode,
  search: string,
): boolean {
  // Keep this in the initializer — do not force-close via useEffect
  // (react-hooks/set-state-in-effect).
  if (isDrinkShapeArrival(search)) return false;
  // Curated check before mode=build — curated URLs always carry mode=build.
  if (isCuratedCrawlArrival(search)) return false;
  return (
    seededBuiltIds.length > 0 || seededMode === "build" || /[?&](style|mode)=/.test(search)
  );
}
