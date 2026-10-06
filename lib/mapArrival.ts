import type { CrawlMode } from "@/lib/venues";

/** Landing drink-shape taps (`?drink=` / `?cocktails=1`) stay on the clean map. */
export function isDrinkShapeArrival(search: string): boolean {
  const params = new URLSearchParams(search);
  const completedBeerShare = params.get("drink") === "beer"
    && params.get("mode") === "build"
    && !params.get("brand")?.trim()
    && !params.get("sub")?.trim()
    && params.get("topshelf") !== "1"
    && params.get("cocktails") !== "1"
    && new Set((params.get("pubs") ?? "").split(",").map((id) => id.trim()).filter(Boolean)).size >= 2;
  if (completedBeerShare) return false;
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
 * Outer-borough / place browse deep-links (`?q=Barnet`, `?q=Croydon&mode=suggest`).
 * Map-first: frame the filtered venues; keep the planner closed.
 * Excludes drink / crawl / pubs arrivals that also carry `q=`.
 */
export function isBoroughBrowseArrival(search: string): boolean {
  if (!/[?&]q=/.test(search)) return false;
  if (isDrinkShapeArrival(search)) return false;
  if (isCuratedCrawlArrival(search)) return false;
  if (/[?&]pubs=/.test(search)) return false;
  return true;
}

/**
 * Borough browse (`?q=`): fit the filtered venue set once after load.
 * Query-venue framing owns the camera — not city bounds.
 */
export function shouldFitQueryVenuesOnArrival(search: string): boolean {
  return isBoroughBrowseArrival(search);
}

/**
 * What a URL-restored search query (`?q=`) should do to the camera once the map
 * is ready and the pins have matched. Mirrors typed search (#371): one match
 * flies to and opens that venue; several frame them all; zero never moves the
 * camera and never claims pins (the count chips stay honest at nothing).
 */
export type QueryRestoreFit = "select-single" | "fit-many" | "none";

export function resolveQueryRestoreFit(matchCount: number): QueryRestoreFit {
  if (matchCount <= 0) return "none";
  if (matchCount === 1) return "select-single";
  return "fit-many";
}

export type ArrivalQueryRestore = "wait" | "select-single" | "fit-many" | "retire";

/**
 * Decide whether the frozen arrival query may still move the live Map.
 *
 * `arrivalSearch` is intentionally frozen at mount, but `currentQuery` belongs
 * to the reader after that. Clearing or changing search therefore retires the
 * one-shot restore. A Venue selection owns the camera too, so it also retires
 * restoration instead of leaving a latent replay after the sheet closes.
 */
export function resolveArrivalQueryRestore(input: {
  arrivalSearch: string;
  currentQuery: string;
  mapReady: boolean;
  selectedVenueId: string;
  didRestore: boolean;
  matchCount: number;
}): ArrivalQueryRestore {
  const arrivalQuery = new URLSearchParams(input.arrivalSearch).get("q")?.trim() ?? "";
  if (
    !shouldFitQueryVenuesOnArrival(input.arrivalSearch) ||
    !arrivalQuery ||
    input.currentQuery.trim() !== arrivalQuery ||
    input.selectedVenueId ||
    input.didRestore
  ) {
    return "retire";
  }
  if (!input.mapReady) return "wait";
  const fit = resolveQueryRestoreFit(input.matchCount);
  return fit === "none" ? "wait" : fit;
}

/**
 * Whether the planner (left drawer) should open on first paint.
 *
 * Opens for shared/restored crawls (`builtIds` from storage, bare `mode=build`,
 * `style=` / `mode=`). Stays closed for drink-shape arrivals, curated crawl
 * arrivals (map-first polyline), and borough browse deep-links (`?q=` —
 * always map-first, even when `mode=` / `style=` is also present).
 */
export function shouldOpenPlanningInitially(
  seededBuiltIds: string[],
  seededMode: CrawlMode,
  search: string,
): boolean {
  // Keep this in the initializer — do not force-close via useEffect
  // (react-hooks/set-state-in-effect).
  if (/[?&]plan=1(?:&|$)/.test(search)) return true;
  if (isDrinkShapeArrival(search)) return false;
  // Curated check before mode=build — curated URLs always carry mode=build.
  if (isCuratedCrawlArrival(search)) return false;
  // Borough browse always closes the planner (map-first), even with mode=/style=.
  if (isBoroughBrowseArrival(search)) return false;
  return (
    seededBuiltIds.length > 0 || seededMode === "build" || /[?&](style|mode)=/.test(search)
  );
}
