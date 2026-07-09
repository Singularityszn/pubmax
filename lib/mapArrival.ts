import type { CrawlMode } from "@/components/map/ControlRail";

/** Landing drink-shape taps (`?drink=` / `?cocktails=1`) stay on the clean map. */
export function isDrinkShapeArrival(search: string): boolean {
  return /[?&]drink=/.test(search) || /[?&]cocktails=1/.test(search);
}

/**
 * Whether the planner (left drawer) should open on first paint.
 *
 * Opens for shared/restored crawls (`builtIds`, `mode=build`, `style=` / `mode=`).
 * Stays closed for drink-shape arrivals and borough browse deep-links (`?q=` only)
 * so `/map?q=Barnet` filters pins without covering the map (outer-London PRD).
 */
export function shouldOpenPlanningInitially(
  seededBuiltIds: string[],
  seededMode: CrawlMode,
  search: string,
): boolean {
  // Keep this in the initializer — do not force-close via useEffect
  // (react-hooks/set-state-in-effect).
  if (isDrinkShapeArrival(search)) return false;
  return (
    seededBuiltIds.length > 0 || seededMode === "build" || /[?&](style|mode)=/.test(search)
  );
}
