"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CrawlMode } from "@/components/map/ControlRail";
import { ownsCrawlUrlEntry } from "@/components/map/useCrawlUrl";
import { readMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import { buildMapSeed } from "@/lib/pubMap";
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

type PlanRequest = Pick<InitialPlanState, "mode" | "builtIds" | "routeMapped">;

/** The ordered walk a map seed asks to draw, or "" when it asks for none. */
function requestedWalk({ mode, builtIds, routeMapped }: PlanRequest): string {
  return mode === "build" && routeMapped && builtIds.length >= 2 ? builtIds.join(",") : "";
}

/** How many walking-route links a mounted map adopted, and the pub the last one named. */
export type WalkRequest = { count: number; selectedVenueId: string };

/** Owns mobile planning activation state so PubMap does not coordinate it piecemeal. */
export function useMapPlanCoordinator(initial: InitialPlanState, search = "") {
  const [mode, setMode] = useState<CrawlMode>(initial.mode);
  const [builtIds, setBuiltIds] = useState<string[]>(initial.builtIds);
  const [routeMapped, setRouteMapped] = useState(initial.routeMapped);
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
    if (previous?.state === entry.state && previous.length === entry.length && previous.search === entry.search) return;
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
      setRouteMapped(true);
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
}: {
  mode: CrawlMode;
  builtIds: string[];
  routeMapped: boolean;
  suggestedRoute: Venue[];
  activePlanRoute: Venue[];
  venueById: ReadonlyMap<string, Venue>;
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
  const routeMappedActive = routeMapped && route.length >= 2;
  const routeForMap = useMemo(
    () => (routeMappedActive ? route : activePlanRoute),
    [activePlanRoute, route, routeMappedActive],
  );
  const routeForMapLegs = useMemo(() => buildRouteLegs(routeForMap, "walk"), [routeForMap]);

  return { route, routeMappedActive, routeForMap, routeForMapLegs };
}
