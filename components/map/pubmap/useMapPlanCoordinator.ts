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
 * The built stops that name a retired pub, in the crawl's own order. They draw
 * no pin and join no walking leg, but a shared crawl link never loses them.
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
  // Crawl routes price stops as pints, so a bar/food id that sneaks into
  // builtIds (old URL, stale localStorage) must never resolve into the route.
  const builtRoute = useMemo(
    () =>
      builtIds
        .map((id) => venueById.get(id))
        .filter((venue): venue is Venue => venue !== undefined && isPubVenue(venue)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const retiredStops = useMemo(
    () => (mode === "suggest" ? [] : builtRouteRetiredStops(builtIds, venueById, retiredById)),
    [builtIds, mode, retiredById, venueById],
  );
  const routeMappedActive = routeMapped && route.length >= 2;
  const routeForMap = useMemo(
    () => (routeMappedActive ? route : activePlanRoute),
    [activePlanRoute, route, routeMappedActive],
  );
  const routeForMapLegs = useMemo(() => buildRouteLegs(routeForMap, "walk"), [routeForMap]);

  return { route, retiredStops, routeMappedActive, routeForMap, routeForMapLegs };
}
