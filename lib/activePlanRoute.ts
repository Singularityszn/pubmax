import { clampStopIndex } from "@/lib/activePlan";
import type { PlanStopDTO } from "@/lib/plan";
import type { Venue } from "@/lib/venues";

// C2 — active-plan → map-route geometry. When a plan is "on tonight"
// (lib/activePlan), its ordered stops are drawn on the map through the EXACT
// same paint the crawl planner uses (route-line + numbered route-stops in
// components/map/canvas/buildScene + geojson.routeToLine/routeToStops). This
// pure mapper is the single seam between the plan's stop list and that paint:
// it turns PlanStopDTO[] into the ordered Venue[] those existing helpers already
// consume — no second route renderer, no new geometry code.
//
// Honest-empty by construction:
//   • Stops are ordered by their stored `position` (never insertion order), so a
//     plan that came back out of order still walks in the intended sequence.
//   • Each stop is resolved against the loaded venue index; a stop whose venue
//     isn't on the map yet (id churn, a non-London plan on a London map) is
//     dropped rather than faked — the line only ever joins real, locatable pins.
//   • Duplicate venue ids collapse to their first appearance, so a doubled stop
//     can't stack two markers or fold a zero-length leg into the line.
//   • Fewer than two resolvable stops → [] (a single point is not a walk, and
//     routeToLine already emits nothing below two points — matching the crawl
//     planner's own `route.length >= 2` gate for "there is a route to draw").
export function planStopsToRouteVenues(
  stops: readonly PlanStopDTO[] | null | undefined,
  venueById: ReadonlyMap<string, Venue>,
): Venue[] {
  if (!stops || stops.length === 0) return [];
  const ordered = [...stops].sort((a, b) => a.position - b.position);
  const seen = new Set<string>();
  const venues: Venue[] = [];
  for (const stop of ordered) {
    if (!stop || typeof stop.venueId !== "string" || stop.venueId === "") continue;
    if (seen.has(stop.venueId)) continue;
    const venue = venueById.get(stop.venueId);
    if (!venue) continue;
    seen.add(stop.venueId);
    venues.push(venue);
  }
  return venues.length >= 2 ? venues : [];
}

/**
 * Tonight's next stop on the map: the stop after the person's cursor
 * (`ActivePlanRef.stopIndex`, moved only by a tap in Night Mode), in the plan's
 * stored order, as Night Mode reads it (nightModeSheetModel.ts). Null when the
 * cursor is on the last stop, or when that pub is not on the map. The map Pal
 * waits beside it (components/map/canvas/palMarker.ts).
 */
export function planNextStopVenue(
  stops: readonly PlanStopDTO[] | null | undefined,
  stopIndex: number,
  venueById: ReadonlyMap<string, Venue>,
): Venue | null {
  if (!stops || stops.length < 2) return null;
  const ordered = [...stops].sort((a, b) => a.position - b.position);
  const next = ordered[clampStopIndex(stopIndex, ordered.length) + 1];
  if (!next || typeof next.venueId !== "string") return null;
  return venueById.get(next.venueId) ?? null;
}
