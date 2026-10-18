import { haversineKm } from "@/lib/haversine";
import { legMinutes, WALK_KMH } from "@/lib/routeLegs";
import { legCacheKey, stopPairs, type LngLat, type WalkRouteSource } from "@/lib/walkRoute";
import { consumeOrsBudget } from "@/lib/walkRouteBudget";
import { fetchWalkLegRoute, orsApiKey, type RoutedWalkLeg } from "@/lib/walkRouteProvider";
import { walkRouteStore } from "@/lib/walkRouteStore";

export type PlanWalkingStop = {
  lat: number;
  lng: number;
  /** Curated venue id, so a leg between two venues can use the street-walk table. */
  venueId?: string;
};

/** Street kilometres between two venues, or null to keep the straight line. */
export type StreetWalkKm = (fromVenueId: string, toVenueId: string) => number | null;

type PlanWalkingLegEstimate = {
  fromIndex: number;
  toIndex: number;
  from: LngLat;
  to: LngLat;
  distanceKm: number;
  minutes: number;
  /** "street" is the offline street-walk table, used where ORS did not route the leg. */
  source: WalkRouteSource | "street";
};

export type PlanWalkingEstimate = {
  legs: PlanWalkingLegEstimate[];
  walkingMinutesFromPrevious: Array<number | null>;
  straightLineWalkingKm: number;
  estimatedWalkingMinutes: number;
  /**
   * "routed" when every leg is ORS, "street" when every leg is ORS or the
   * street-walk table and at least one is the table, else "straight-line".
   */
  distanceBasis: "straight-line" | "routed" | "street";
};

function distanceBasisFor(legs: readonly PlanWalkingLegEstimate[]): PlanWalkingEstimate["distanceBasis"] {
  if (legs.length === 0 || legs.some((leg) => leg.source === "straight")) return "straight-line";
  return legs.every((leg) => leg.source === "ors") ? "routed" : "street";
}

function stopToLngLat(stop: PlanWalkingStop): LngLat {
  return [stop.lng, stop.lat];
}

export function routePathDistanceKm(coordinates: readonly LngLat[]): number {
  let km = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index];
    const to = coordinates[index + 1];
    if (from && to) km += haversineKm(from, to);
  }
  return km;
}

function walkingMinutesFromRoutedLeg(route: RoutedWalkLeg): number {
  if (route.durationSeconds !== null && route.durationSeconds > 0) {
    return Math.max(1, Math.ceil(route.durationSeconds / 60));
  }
  return legMinutes(routePathDistanceKm(route.coordinates));
}

function perStopMinutes(stopsCount: number, legs: readonly PlanWalkingLegEstimate[]): Array<number | null> {
  const minutes: Array<number | null> = Array.from({ length: stopsCount }, () => null);
  for (const leg of legs) {
    minutes[leg.toIndex] = leg.minutes;
  }
  return minutes;
}

export function estimateStraightLinePlanWalking(
  stops: readonly PlanWalkingStop[],
  streetWalkKm?: StreetWalkKm,
): PlanWalkingEstimate {
  const coordinates = stops.map(stopToLngLat);
  let straightLineWalkingKm = 0;
  const legs = stopPairs(coordinates).map((pair): PlanWalkingLegEstimate => {
    const straightKm = haversineKm(pair.from, pair.to);
    straightLineWalkingKm += straightKm;
    const fromId = stops[pair.fromIndex]?.venueId;
    const toId = stops[pair.toIndex]?.venueId;
    const streetKm = fromId && toId ? streetWalkKm?.(fromId, toId) ?? null : null;
    const distanceKm = streetKm ?? straightKm;
    return {
      fromIndex: pair.fromIndex,
      toIndex: pair.toIndex,
      from: pair.from,
      to: pair.to,
      distanceKm,
      minutes: legMinutes(distanceKm),
      source: streetKm === null ? "straight" : "street",
    };
  });
  const anyStreet = legs.some((leg) => leg.source === "street");
  return {
    legs,
    walkingMinutesFromPrevious: perStopMinutes(stops.length, legs),
    straightLineWalkingKm,
    estimatedWalkingMinutes: anyStreet
      ? legs.reduce((total, leg) => total + leg.minutes, 0)
      : straightLineWalkingKm > 0 ? Math.ceil((straightLineWalkingKm / WALK_KMH) * 60) : 0,
    distanceBasis: distanceBasisFor(legs),
  };
}

export async function estimatePlanWalking(
  stops: readonly PlanWalkingStop[],
  streetWalkKm?: StreetWalkKm,
): Promise<PlanWalkingEstimate> {
  const straight = estimateStraightLinePlanWalking(stops, streetWalkKm);
  if (straight.legs.length === 0 || orsApiKey() === null) return straight;

  let store: ReturnType<typeof walkRouteStore>;
  try {
    store = walkRouteStore();
  } catch {
    return straight;
  }
  const legs = await Promise.all(straight.legs.map(async (leg): Promise<PlanWalkingLegEstimate> => {
    const key = legCacheKey(leg.from, leg.to);
    try {
      const cached = await store.getLeg(key);
      if (cached) {
        const distanceKm = routePathDistanceKm(cached);
        return {
          ...leg,
          distanceKm,
          minutes: legMinutes(distanceKm),
          source: "ors",
        };
      }
    } catch {
      // Cache failures should not affect plan generation or routing attempts.
    }

    // A real provider call is about to happen (cache miss + key present). Draw
    // down the global daily ORS budget FIRST, exactly like /api/walk-route does
    // (app/api/plans/generate shares the same ors-global:<UTC-date> bucket), so
    // Friday-night plan generation can't drain the day's quota outside the cap.
    // Over budget -> keep this leg's straight-line estimate (fail-soft).
    if (!(await consumeOrsBudget())) return leg;

    let routed: RoutedWalkLeg | null = null;
    try {
      routed = await fetchWalkLegRoute(leg.from, leg.to);
    } catch {
      return leg;
    }
    if (!routed) return leg;
    try {
      await store.putLeg(key, routed.coordinates);
    } catch {
      // Store writes are quota-saving only; generation still uses the routed leg.
    }
    return {
      ...leg,
      distanceKm: routePathDistanceKm(routed.coordinates),
      minutes: walkingMinutesFromRoutedLeg(routed),
      source: "ors",
    };
  }));

  const hasMeasuredLeg = legs.some((leg) => leg.source !== "straight");
  return {
    ...straight,
    legs,
    walkingMinutesFromPrevious: perStopMinutes(stops.length, legs),
    estimatedWalkingMinutes: hasMeasuredLeg
      ? legs.reduce((total, leg) => total + leg.minutes, 0)
      : straight.estimatedWalkingMinutes,
    // Match lib/routeLegs withRoutedDistances: "routed" only when every leg is.
    distanceBasis: distanceBasisFor(legs),
  };
}
