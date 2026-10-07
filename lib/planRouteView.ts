// What the Plan result reads out of its stops: the one summary line, the walk
// between two stops and the price stamp on a card. Pure, so the card list, the
// header and the tests all say the same figure.
//
// HONEST OR ABSENT. A figure that is not in the stop's own record is never
// invented: a total that needs every stop prints only when every stop has the
// figure, and a walk that was timed for a different neighbour prints nothing
// until the map has measured the new one.

import { legMinutes } from "@/lib/routeLegs";
import type { WalkLegDistance } from "@/lib/walkRoute";

export type RouteViewStop = {
  venueId: string;
  venueName: string;
  /** Minutes from the stop before it, as the generator timed them. */
  walkingMinutesFromPrevious?: number | null;
  /** The stop the generator timed that walk FROM. A reorder breaks the match. */
  walkFromVenueId?: string;
  estimatedPintPricePence?: number | null;
  priceKind?: "listed" | "estimated";
};

/** Walk minutes the browser measured per leg, keyed by `fromId>toId`. */
export type MeasuredLegMinutes = ReadonlyMap<string, number>;

export function legKey(fromVenueId: string, toVenueId: string): string {
  return `${fromVenueId}>${toVenueId}`;
}

/**
 * `/api/walk-route` legs, indexed by position, mapped onto the stops they join.
 * Only a routed leg is a measured walk: a straight-line one is not printed as one.
 */
export function measuredLegMinutes(
  venueIds: readonly string[],
  legs: readonly WalkLegDistance[],
): MeasuredLegMinutes {
  const out = new Map<string, number>();
  for (const leg of legs) {
    if (leg.source !== "ors") continue;
    const from = venueIds[leg.fromIndex];
    const to = venueIds[leg.toIndex];
    if (!from || !to || !Number.isFinite(leg.distanceKm) || leg.distanceKm <= 0) continue;
    // The generator times a leg with this same function, so a measured walk and a
    // generated one never differ by their rounding.
    out.set(legKey(from, to), legMinutes(leg.distanceKm));
  }
  return out;
}

/**
 * The walk into `stop` from `previous`. The generator's figure counts only when
 * it was timed from this very neighbour, otherwise the map's own measurement of
 * this pair, otherwise nothing.
 */
export function walkMinutesBetween(
  previous: RouteViewStop,
  stop: RouteViewStop,
  measured?: MeasuredLegMinutes,
): number | null {
  const timed = stop.walkingMinutesFromPrevious;
  if (
    typeof timed === "number"
    && Number.isFinite(timed)
    && timed >= 0
    && stop.walkFromVenueId === previous.venueId
  ) {
    return Math.max(1, Math.round(timed));
  }
  return measured?.get(legKey(previous.venueId, stop.venueId)) ?? null;
}

export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

/** A stamp on a card: always pounds and pence, so a column of prices lines up. */
export function formatPenceFixed(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function walkLabel(minutes: number): string {
  return `${minutes} min walk`;
}

/** `3 stops`, `1 stop`. The unit is the product's own word for a Stop. */
function stopCountLabel(count: number): string {
  return count === 1 ? "1 stop" : `${count} stops`;
}

export function routeTotals(
  stops: readonly RouteViewStop[],
  measured?: MeasuredLegMinutes,
): { pricePence: number | null; walkMinutes: number | null } {
  const priced = stops.length > 0
    && stops.every((stop) => typeof stop.estimatedPintPricePence === "number" && stop.estimatedPintPricePence > 0);
  const pricePence = priced
    ? stops.reduce((total, stop) => total + (stop.estimatedPintPricePence as number), 0)
    : null;
  let walkMinutes = 0;
  for (let index = 1; index < stops.length; index += 1) {
    const leg = walkMinutesBetween(stops[index - 1]!, stops[index]!, measured);
    if (leg === null) return { pricePence, walkMinutes: null };
    walkMinutes += leg;
  }
  return { pricePence, walkMinutes: stops.length > 1 ? walkMinutes : null };
}

/** `3 stops · £18 each · 18 min walk`, each part only when it is real. */
export function routeSummaryLine(
  stops: readonly RouteViewStop[],
  measured?: MeasuredLegMinutes,
): string {
  const totals = routeTotals(stops, measured);
  return [
    stopCountLabel(stops.length),
    totals.pricePence === null ? null : `${formatPence(totals.pricePence)} each`,
    totals.walkMinutes === null ? null : walkLabel(totals.walkMinutes),
  ].filter((part): part is string => part !== null).join(" · ");
}

export function priceKindLabel(kind: RouteViewStop["priceKind"]): string | null {
  if (kind === "listed") return "Listed price";
  if (kind === "estimated") return "Estimated price";
  return null;
}

/** The page's heading: where and when, in the product's own words. */
export function routeHeading(daypart: string | null | undefined, areaName: string | null): string {
  if (!areaName) return "Your route";
  return `${daypart === "daytime" ? "Today" : "Tonight"} in ${areaName}`;
}
