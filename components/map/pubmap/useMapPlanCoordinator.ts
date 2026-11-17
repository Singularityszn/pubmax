"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import { isLatestCameraRequest, nextCameraRequestToken } from "@/lib/cameraIntent";
import { canonicalBundledVenueId } from "@/lib/bundledVenueAliases";
import type { CrawlMode } from "@/components/map/ControlRail";
import { ownsCrawlUrlEntry } from "@/components/map/useCrawlUrl";
import { readMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import { buildMapSeed } from "@/lib/pubMap";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedWalkKm, curatedWalkMinutes, type MapRouteStop } from "@/lib/curatedWalk";

type InitialPlanState = {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  planningOpen: boolean;
  nightArea: NightAreaSlug | null;
};

type PlanRequest = Pick<InitialPlanState, "mode" | "builtIds" | "routeMapped">;

function canonicalMapStops(ids: string[]): string[] {
  return [...new Set(ids.map(canonicalBundledVenueId))];
}

/** The ordered walk a map seed asks to draw, or "" when it asks for none. */
function requestedWalk({ mode, builtIds, routeMapped }: PlanRequest): string {
  return mode === "build" && routeMapped && builtIds.length >= 2 ? builtIds.join(",") : "";
}

/** How many walking-route links a mounted map adopted, and the pub the last one named. */
export type WalkRequest = { count: number; selectedVenueId: string };

/** Owns mobile planning activation state so PubMap does not coordinate it piecemeal. */
export function useMapPlanCoordinator(initial: InitialPlanState, search = "") {
  const [{ mode, builtIds, routeMapped }, setPlan] = useState<PlanRequest>(() => ({
    mode: initial.mode,
    builtIds: canonicalMapStops(initial.builtIds),
    routeMapped: initial.routeMapped,
  }));
  const setMode = useCallback((value: SetStateAction<CrawlMode>) => {
    setPlan((current) => ({ ...current, mode: typeof value === "function" ? value(current.mode) : value }));
  }, []);
  const setBuiltIds = useCallback((value: SetStateAction<string[]>) => {
    setPlan((current) => ({ ...current, builtIds: canonicalMapStops(typeof value === "function" ? value(current.builtIds) : value) }));
  }, []);
  const setRouteMapped = useCallback((value: SetStateAction<boolean>) => {
    setPlan((current) => ({ ...current, routeMapped: typeof value === "function" ? value(current.routeMapped) : value }));
  }, []);
  const [routeRequestToken, setRouteRequestToken] = useState(0);
  const mapRoute = useCallback((requestToken = nextCameraRequestToken()) => {
    if (!isLatestCameraRequest(requestToken)) return;
    setRouteMapped(true);
    setRouteRequestToken(requestToken);
  }, [setRouteMapped]);
  const hideRoute = useCallback(() => {
    setRouteMapped(false);
    setRouteRequestToken(nextCameraRequestToken());
  }, [setRouteMapped]);
  const [planningOpen, setPlanningOpen] = useState(initial.planningOpen);
  const [plannedNightArea, setPlannedNightArea] = useState<NightAreaSlug | null>(initial.nightArea);
  const [walkRequest, setWalkRequest] = useState<WalkRequest>({ count: 0, selectedVenueId: "" });

  // A map that stays mounted across client navigation still owes a new
  // walking-route link its walk, so the router's search is read through the
  // same seed a fresh map uses. The decision waits for the commit, after the
  // router has landed the link's entry, and is about that entry alone. A search
  // whose walk is not the walk the live address asks for was handed back late,
  // from an entry the reader has since left, and asks for nothing. A walk the
  // live address does ask for is a new link only on an entry this map's URL
  // sync never wrote; its own writes never overwrite the reader's stops or map
  // a walk they hid.
  const request = useMemo(() => buildMapSeed(search), [search]);
  const requestKey = requestedWalk(request);
  const observedEntry = useRef<{ state: unknown; length: number; search: string } | null>(null);
  useEffect(() => {
    const entry = { state: window.history.state as unknown, length: window.history.length, search: window.location.search };
    const previous = observedEntry.current;
    if (previous && previous.state === entry.state && previous.length === entry.length && previous.search === entry.search) return;
    if (!previous && requestKey === requestedWalk(initial)) {
      observedEntry.current = entry;
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled
        || new URLSearchParams(search).toString() !== new URLSearchParams(window.location.search).toString()) return;
      observedEntry.current = entry;
      if (!requestKey || ownsCrawlUrlEntry(window.history.state)
        || readMapSurfaceHistory(window.history.state)) return;
      setMode("build");
      setBuiltIds(request.builtIds);
      mapRoute();
      setWalkRequest((current) => ({
        count: current.count + 1,
        selectedVenueId: request.selectedVenueId,
      }));
    });
    return () => {
      cancelled = true;
    };
  });

  const activateGeneratedPlan = useCallback((nightArea: NightAreaSlug | null, venueIds: string[]) => {
    setMode("build");
    setBuiltIds(venueIds);
    mapRoute();
    setPlannedNightArea(nightArea);
  }, [mapRoute, setBuiltIds, setMode]);

  const releasePlannerMode = useCallback((keepFixedWalk = false) => {
    setPlan((current) => keepFixedWalk !== true && current.builtIds.length === 0 && current.mode === "build"
      ? { ...current, routeMapped: false, mode: "suggest" }
      : current);
  }, []);

  return {
    mode,
    setMode,
    releasePlannerMode,
    builtIds,
    setBuiltIds,
    routeMapped,
    setRouteMapped,
    mapRoute,
    hideRoute,
    routeRequestToken,
    planningOpen,
    setPlanningOpen,
    plannedNightArea,
    setPlannedNightArea,
    activateGeneratedPlan,
    walkRequest,
  };
}

/**
 * Owns the curated crawl whose blurb is shown under the route title. A
 * walking-route link the mounted map adopted is no longer that crawl, so the
 * reset happens during the render that sees the adoption, never a commit later.
 */
export function useActiveCuratedCrawl<Crawl>(initial: Crawl | null, walkRequest: WalkRequest) {
  const [activeCrawl, setActiveCrawl] = useState<Crawl | null>(initial);
  const [adoptedWalk, setAdoptedWalk] = useState(walkRequest);
  if (adoptedWalk !== walkRequest) {
    setAdoptedWalk(walkRequest);
    setActiveCrawl(null);
  }
  return [activeCrawl, setActiveCrawl] as const;
}

/** Resolves exactly one route presentation: explicit mapped route first, restored plan second. */
export function useMapPlanPresentation({
  mode,
  builtIds,
  routeMapped,
  suggestedRoute,
  activePlanRoute,
  venueById,
  settledBuiltStopIds,
  activeCrawl,
}: {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  activeCrawl?: CuratedCrawl | null;
  suggestedRoute: Venue[];
  activePlanRoute: Venue[];
  venueById: ReadonlyMap<string, Venue>;
  settledBuiltStopIds?: ReadonlySet<string>;
}) {
  // Crawl routes price stops as pints, so a bar/food id that sneaks into
  // builtIds (old URL, stale localStorage) must never resolve into the route.
  const builtRoute = useMemo(
    () =>
      builtIds
        .map((id) => venueById.get(canonicalBundledVenueId(id)))
        .filter((venue): venue is Venue => venue !== undefined && isPubVenue(venue)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const routePending = routeMapped && mode === "build" && builtIds.length >= 2
    && builtIds.some((id) => !venueById.has(canonicalBundledVenueId(id)) && !settledBuiltStopIds?.has(id));
  const walk = mode === "build" ? activeCrawl?.walk : undefined;
  const routeMappedActive = routeMapped && (walk ? walk.stops.length >= 2 : route.length >= 2);
  const routeForMap = useMemo<MapRouteStop[]>(
    () => routeMappedActive ? walk?.stops ?? route : activePlanRoute,
    [activePlanRoute, route, routeMappedActive, walk],
  );
  const routeForMapLegs = useMemo(() => {
    const summary = buildRouteLegs(routeMappedActive ? route : activePlanRoute, "walk");
    if (!walk || !routeMappedActive) return summary;
    const totalKm = curatedWalkKm(walk);
    return { ...summary, totalKm, totalMinutes: curatedWalkMinutes(walk) };
  }, [activePlanRoute, route, routeMappedActive, walk]);

  return { route, routePending, routeMappedActive, routeForMap, routeForMapLegs };
}
