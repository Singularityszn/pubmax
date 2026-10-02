"use client";

import { useCallback, useMemo, useState } from "react";

import type { CrawlMode } from "@/components/map/ControlRail";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

type InitialPlanState = {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  planningOpen: boolean;
  nightArea: NightAreaSlug | null;
};

/** Owns mobile planning activation state so PubMap does not coordinate it piecemeal. */
export function useMapPlanCoordinator(initial: InitialPlanState) {
  const [mode, setMode] = useState<CrawlMode>(initial.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(initial.builtIds);
  const [routeMapped, setRouteMapped] = useState(initial.routeMapped);
  const [planningOpen, setPlanningOpen] = useState(initial.planningOpen);
  const [plannedNightArea, setPlannedNightArea] = useState<NightAreaSlug | null>(initial.nightArea);

  const activateGeneratedPlan = useCallback((nightArea: NightAreaSlug | null, venueIds: string[]) => {
    setMode("build");
    setBuiltIds(venueIds);
    setRouteMapped(true);
    setPlannedNightArea(nightArea);
  }, []);

  return {
    mode,
    setMode,
    builtIds,
    setBuiltIds,
    routeMapped,
    setRouteMapped,
    planningOpen,
    setPlanningOpen,
    plannedNightArea,
    setPlannedNightArea,
    activateGeneratedPlan,
  };
}

/** A built stop whose pub left the map, named where it sat in the crawl. */
export type RetiredRouteStop = {
  id: string;
  name: string;
  /** The index in the drawn route of the stop it sits before (the route's length when last). */
  beforeRouteIndex: number;
};

/**
 * The built stops that name a retired pub, placed among the walked stops. They
 * draw no pin and join no walking leg, but the stop list names them in place.
 */
export function builtRouteRetiredStops(
  builtIds: readonly string[],
  venueById: ReadonlyMap<string, Venue>,
  retiredById: ReadonlyMap<string, Venue>,
): RetiredRouteStop[] {
  const stops: RetiredRouteStop[] = [];
  let routeIndex = 0;
  for (const id of builtIds) {
    const venue = venueById.get(id);
    if (venue && isPubVenue(venue)) {
      routeIndex += 1;
      continue;
    }
    const retired = retiredById.get(id);
    if (retired?.retired) stops.push({ id, name: retired.name, beforeRouteIndex: routeIndex });
  }
  return stops;
}

/**
 * The built crawl's stops, in order. Crawl routes price stops as pints, so a
 * bar/food id that sneaks into builtIds (old URL, stale localStorage) never
 * resolves into the route. A stop whose pub left the map stays in its place,
 * so sharing or saving the crawl never loses it; it is skipped wherever the
 * route is walked or drawn.
 */
export function builtRouteStops(
  builtIds: readonly string[],
  venueById: ReadonlyMap<string, Venue>,
  retiredById: ReadonlyMap<string, Venue>,
): Venue[] {
  return builtIds.flatMap((id) => {
    const venue = venueById.get(id);
    if (venue) return isPubVenue(venue) ? [venue] : [];
    const retired = retiredById.get(id);
    return retired?.retired ? [retired] : [];
  });
}

/** Resolves exactly one route presentation: explicit mapped route first, restored plan second. */
export function useMapPlanPresentation({
  mode,
  builtIds,
  routeMapped,
  suggestedRoute,
  activePlanRoute,
  venueById,
  retiredById,
}: {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  suggestedRoute: Venue[];
  activePlanRoute: Venue[];
  venueById: ReadonlyMap<string, Venue>;
  retiredById: ReadonlyMap<string, Venue>;
}) {
  const builtRoute = useMemo(
    () => builtRouteStops(builtIds, venueById, retiredById),
    [builtIds, retiredById, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const walkedRoute = useMemo(() => route.filter((venue) => !venue.retired), [route]);
  const retiredStops = useMemo(
    () => (mode === "suggest" ? [] : builtRouteRetiredStops(builtIds, venueById, retiredById)),
    [builtIds, mode, retiredById, venueById],
  );
  const routeMappedActive = routeMapped && walkedRoute.length >= 2;
  const routeForMap = useMemo(
    () => (routeMappedActive ? walkedRoute : activePlanRoute),
    [activePlanRoute, walkedRoute, routeMappedActive],
  );
  const routeForMapLegs = useMemo(() => buildRouteLegs(routeForMap, "walk"), [routeForMap]);

  return { route, retiredStops, routeMappedActive, routeForMap, routeForMapLegs };
}
