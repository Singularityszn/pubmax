// @vitest-environment jsdom

import { act, createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map as MapLibreMap, LngLatBounds } from "maplibre-gl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useMapCamera, useRouteCameraFraming } from "@/components/map/canvas/useMapCamera";
import { useMapPlanCoordinator, useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { useTypedSearchCamera } from "@/components/map/pubmap/useTypedSearchCamera";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const route = [
  { id: "route-a", longitude: -0.2, latitude: 51.5 },
  { id: "route-b", longitude: -0.1, latitude: 51.6 },
] as Venue[];
const matches = [
  { id: "search-a", longitude: -0.3, latitude: 51.7 },
  { id: "search-b", longitude: -0.25, latitude: 51.75 },
] as Venue[];
const venueById = new Map(route.map((venue) => [venue.id, venue]));
const fitBounds = vi.fn();
const easeTo = vi.fn();
let host: HTMLDivElement;
let root: Root;
let pendingFrame: FrameRequestCallback | undefined;
let plan: ReturnType<typeof useMapPlanCoordinator>;

function SearchCamera({ focused, matchCount }: { focused: boolean; matchCount: number }) {
  const coordinator = useMapPlanCoordinator({
    mode: "build", builtIds: route.map((venue) => venue.id), routeMapped: false,
    planningOpen: false, nightArea: null,
  });
  useEffect(() => { plan = coordinator; });
  const presentation = useMapPlanPresentation({
    mode: coordinator.mode, builtIds: coordinator.builtIds, routeMapped: coordinator.routeMapped,
    suggestedRoute: [], activePlanRoute: [], venueById,
  });
  const routeRef = useRef(presentation.routeForMap);
  useEffect(() => { routeRef.current = presentation.routeForMap; });
  const [searchToken, setSearchToken] = useState(0);
  const [selection, setSelection] = useState({ id: "", token: 0 });
  const [nearbyMapResult, setNearbyMapResult] = useState<string | null>("nearby");
  const selectVenue = (id: string, _tab: "overview", token: number) => {
    setSelection({ id, token });
  };
  const queryVenuesRef = useRef(matches.slice(0, matchCount));
  const { fitQueryVenues, fitRoute, cinematic } = useMapCamera({
    latestRequestToken: Math.max(coordinator.routeRequestToken, searchToken, selection.token),
    mapRef: useRef({
      stop: vi.fn(), fitBounds, easeTo, getBearing: () => 0,
      getContainer: () => ({ clientWidth: 1280, clientHeight: 900,
        getBoundingClientRect: () => ({ top: 0, width: 1280, height: 900 }) }),
    } as unknown as MapLibreMap),
    reducedRef: useRef(true),
    cityViewRef: useRef({ center: [-0.13, 51.51] as [number, number], zoom: 12, pitch: 40, bearing: 0 }),
    cityBoundsRef: useRef<[[number, number], [number, number]]>([[-0.3, 51.4], [0.1, 51.7]]),
    routeRef,
    routeLineRef: useRef({ type: "FeatureCollection", features: [] }),
    venuesRef: useRef([...route, ...matches]),
    queryVenuesRef,
    gestureCameraRef: useRef({ active: false, endedAt: null }),
  });
  useEffect(() => {
    if (searchToken) fitQueryVenues("search-recovery", searchToken);
  }, [fitQueryVenues, searchToken]);
  useRouteCameraFraming({
    mapReady: true, routeKey: presentation.routeForMap.map((venue) => venue.id).join(">"),
    selectedVenueId: selection.id, requestToken: coordinator.routeRequestToken, fitRoute,
  });
  useEffect(() => {
    const venue = matches.find((venue) => venue.id === selection.id);
    if (venue) cinematic({ center: [venue.longitude, venue.latitude] }, "venue", "user", selection.token);
  }, [cinematic, selection]);
  useTypedSearchCamera({
    disabled: false, query: "Soho", searchFieldFocused: focused, searchOverlayOpen: false,
    venuesRef: queryVenuesRef, ownedQueryRef: useRef(null), selectVenue,
    setSearchRecoveryToken: setSearchToken, setNearbyMapResult,
  });
  return createElement("output", {
    "data-selected": selection.id, "data-nearby": nearbyMapResult, "data-search-token": searchToken,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => { pendingFrame = undefined; });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fitBounds.mockReset();
  easeTo.mockReset();
  pendingFrame = undefined;
});

function flushCamera() {
  const frame = pendingFrame;
  pendingFrame = undefined;
  act(() => frame?.(performance.now()));
}

it.each([1, 2])("keeps a newer route ahead of a delayed search with %s matches", (matchCount) => {
  act(() => root.render(createElement(SearchCamera, { focused: true, matchCount })));
  act(() => root.render(createElement(SearchCamera, { focused: false, matchCount })));
  act(() => plan.mapRoute());
  flushCamera();
  act(() => vi.runOnlyPendingTimers());
  flushCamera();
  act(() => vi.runOnlyPendingTimers());
  flushCamera();
  expect(easeTo).not.toHaveBeenCalled();
  expect(host.querySelector("output")?.getAttribute("data-selected")).toBe("");
  expect(host.querySelector("output")?.getAttribute("data-nearby")).toBe("nearby");
  expect(host.querySelector("output")?.getAttribute("data-search-token")).toBe("0");
  expect(fitBounds).toHaveBeenCalledOnce();
  expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
    .toEqual([[-0.2, 51.5], [-0.1, 51.6]]);
});

it.each([1, 2])("lets a later search replace an older route with %s matches", (matchCount) => {
  act(() => root.render(createElement(SearchCamera, { focused: true, matchCount })));
  act(() => plan.mapRoute());
  flushCamera();
  fitBounds.mockClear();
  act(() => root.render(createElement(SearchCamera, { focused: false, matchCount })));
  act(() => vi.runOnlyPendingTimers());
  flushCamera();
  if (matchCount === 1) {
    expect(host.querySelector("output")?.getAttribute("data-selected")).toBe("search-a");
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.3, 51.7] }));
    expect(fitBounds).not.toHaveBeenCalled();
  } else {
    expect(Number(host.querySelector("output")?.getAttribute("data-search-token"))).toBeGreaterThan(0);
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.3, 51.7], [-0.25, 51.75]]);
    expect(easeTo).not.toHaveBeenCalled();
  }
  expect(host.querySelector("output")?.hasAttribute("data-nearby")).toBe(false);
});
