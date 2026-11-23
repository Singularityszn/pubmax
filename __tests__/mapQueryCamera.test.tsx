// @vitest-environment jsdom

import { act, createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map as MapLibreMap, LngLatBounds } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { latestMapCameraRequestToken, palCameraDefaults, useMapCamera, useNearbyCameraFraming, useRouteCameraFraming } from "@/components/map/canvas/useMapCamera";
import { useMapPlanCoordinator, useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import { useNearMeRequests } from "@/components/map/pubmap/useNearMeRequests";
import { useMapOpeningCamera } from "@/components/map/useMapOpeningCamera";
import { useCuratedWalkFraming } from "@/components/map/canvas/useCuratedWalkFraming";
import { useRouteStopSelection } from "@/components/map/canvas/useRouteStopSelection";
import { useMapFocusPoint } from "@/components/map/canvas/useMapFocusPoint";
import { holdOpeningFrame } from "@/components/map/canvas/openingFrame";
import { MAP_OPENING_PREVIEW_RETRACT_EVENT } from "@/lib/mapOpeningPreview";
import { wireClickRouting } from "@/components/map/canvas/interactions";
import { PIN_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { currentCameraRequestToken, nextCameraRequestToken } from "@/lib/cameraIntent";
import { nextAreaCameraFocus, type MapCameraFocus } from "@/lib/mapCameraFocus";
import { requestMobileSheetDismiss } from "@/lib/mobileShell";
import type { Venue } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const pub = (id: string, longitude: number, latitude: number) =>
  ({ id, longitude, latitude }) as Venue;
const soho = [pub("soho-west", -0.139, 51.514), pub("soho-east", -0.129, 51.516)];
const surrounding = [...soho, pub("outside-query", -2.244, 53.483)];

let host: HTMLDivElement;
let root: Root;
let pendingFrame: FrameRequestCallback | undefined;
let camera: ReturnType<typeof useMapCamera>;
let mapViewport = { width: 1280, height: 900 };
const fitBounds = vi.fn();
const easeTo = vi.fn();
let reducedMotion = true;

describe("Pal camera defaults", () => {
  it("starts without a nearby request and retains explicit request tokens", () => {
    expect(palCameraDefaults({})).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: undefined })).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: 0 })).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: 3 })).toEqual({ nearbyRequestToken: 3 });
  });
});

beforeEach(() => {
  mapViewport = { width: 1280, height: 900 };
  reducedMotion = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  pendingFrame = undefined;
  fitBounds.mockReset();
  easeTo.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function mount(queryVenuesRef: { current: Venue[] }, route: Venue[] = [], gesture = { active: false, endedAt: null as number | null },
  routeLineRef: { current: GeoJSON.FeatureCollection } = { current: { type: "FeatureCollection", features: [] } },
  nearbyRequest = { current: 0 }, nearby = false,
  planRef?: { current: ReturnType<typeof useMapPlanCoordinator> | null },
  opening: { resolved: boolean; area: MapCameraFocus | null; walkPanelOpen?: boolean } = { resolved: false, area: null },
  readiness = { current: true }, canvasMounted = { current: true }, searchRecovery = { current: 0 }, selectedVenue: { current: string; requestToken?: number } = { current: "" },
  search = { current: "" }, planData: { venues: Venue[]; activePlanRoute: Venue[]; settledBuiltStopIds?: ReadonlySet<string> } = { venues: route, activePlanRoute: [] }) {
  function Canvas({ plan }: { plan: ReturnType<typeof useMapPlanCoordinator> }) {
    const presentation = useMapPlanPresentation({
      mode: plan.mode, builtIds: plan.builtIds, routeMapped: plan.routeMapped,
      settledBuiltStopIds: planData.settledBuiltStopIds,
      suggestedRoute: [], activePlanRoute: planData.activePlanRoute, venueById: new Map(planData.venues.map((venue) => [venue.id, venue])),
    });
    const currentRoute = planRef ? presentation.routeForMap : route;
    camera = useMapCamera({
      latestRequestToken: Math.max(planRef ? plan.routeRequestToken : 0, nearbyRequest.current,
        searchRecovery.current, opening.area?.token ?? 0, selectedVenue.current ? selectedVenue.requestToken ?? 0 : 0),
      mapRef: { current: {
        stop: vi.fn(), fitBounds, easeTo, getBearing: () => -8,
        getContainer: () => ({ clientWidth: mapViewport.width, clientHeight: mapViewport.height, querySelector: () => null,
          getBoundingClientRect: () => new DOMRect(0, 0, mapViewport.width, mapViewport.height) }),
      } as unknown as MapLibreMap },
      reducedRef: { current: reducedMotion },
      cityViewRef: { current: { center: [-0.13, 51.51], zoom: 12, pitch: 40, bearing: -8 } },
      cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
      routeRef: { current: currentRoute },
      routeLineRef,
      venuesRef: { current: surrounding },
      queryVenuesRef,
      gestureCameraRef: { current: gesture },
    });
    const location = useMapOpeningCamera({
      shouldResolveOpeningLocation: true,
      openingLocationResolved: opening.resolved,
      openingLocationCancelledRef: useRef(false),
      locationFirstMapView: { center: [-2.3216, 54.5232], zoom: 14 },
      cancelOpeningLocation: () => {},
    });
    useCuratedWalkFraming(Boolean(opening.walkPanelOpen), readiness.current, camera.fitRoute);
    useMapFocusPoint(readiness.current, opening.area ?? location.openingLocationFocus, useRef(null), camera.cinematic);
    useEffect(() => {
      if (readiness.current && searchRecovery.current) camera.fitQueryVenues("search-recovery", searchRecovery.current);
    });
    useNearbyCameraFraming({
      mapReady: readiness.current, userLocation: nearby ? { lat: 51.51, lng: -0.13 } : null,
      routeLength: currentRoute.length, nearbyMapVenues: soho, fitNearby: camera.fitNearby,
      framingOwedRef: { current: false }, requestToken: nearbyRequest.current,
    });
    useRouteCameraFraming({
      mapReady: Boolean(planRef) && readiness.current, routeKey: currentRoute.map((venue) => venue.id).join(">"),
      selectedVenueId: selectedVenue.current, requestToken: plan.routeRequestToken,
      routePending: presentation.routePending, fitRoute: camera.fitRoute,
    });
    return null;
  }
  function Camera() {
    const plan = useMapPlanCoordinator({
      mode: "build", builtIds: route.map((venue) => venue.id), routeMapped: true,
      planningOpen: false, nightArea: null,
    }, search.current);
    if (planRef) planRef.current = plan;
    return canvasMounted.current ? createElement(Canvas, { plan }) : null;
  }
  act(() => root.render(createElement(Camera)));
  return () => act(() => root.render(createElement(Camera)));
}

function fitQuery() {
  act(() => {
    camera.fitQueryVenues();
    pendingFrame?.(performance.now());
    pendingFrame = undefined;
  });
}

describe("a phone's opening frame", () => {
  it("keeps the free-map padding through the opening, and releases it before any other move the app makes", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    const city = { center: [-0.12, 51.52] as [number, number], zoom: 12, pitch: 38, bearing: 0 };
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    let padding = none;
    const jumpTo = vi.fn((options: { padding?: typeof none }) => {
      if (options.padding) padding = options.padding;
    });
    const map = {
      stop: vi.fn(), fitBounds, easeTo, jumpTo, on: vi.fn(), off: vi.fn(),
      setPadding: (next: typeof none) => { padding = next; },
      getPadding: () => padding,
      getCenter: () => ({ lng: city.center[0], lat: city.center[1] }),
      getZoom: () => city.zoom, getPitch: () => city.pitch, getBearing: () => 0,
      getContainer: () => ({ clientWidth: 390, clientHeight: 844 }),
      unproject: ([x, y]: [number, number]) => ({ lng: city.center[0] + x * 1e-5, lat: city.center[1] - y * 1e-5 }),
    } as unknown as MapLibreMap;
    holdOpeningFrame(map, city, city);
    expect(padding).toEqual({ top: 112, right: 0, bottom: 296, left: 0 });
    function Canvas() {
      camera = useMapCamera({
        latestRequestToken: 0, mapRef: { current: map }, reducedRef: { current: true },
        cityViewRef: { current: city }, cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
        routeRef: { current: [] }, routeLineRef: { current: { type: "FeatureCollection", features: [] } },
        venuesRef: { current: surrounding }, queryVenuesRef: { current: [] },
        gestureCameraRef: { current: { active: false, endedAt: null } },
      });
      return null;
    }
    act(() => root.render(createElement(Canvas)));
    const run = (move: () => void) => act(() => {
      move();
      const callback = pendingFrame;
      pendingFrame = undefined;
      callback?.(performance.now());
    });
    // No location shared: the answer re-aims at the city's own centre.
    run(() => camera.cinematic({ center: city.center, zoom: city.zoom }, "opening-location", "automatic"));
    run(() => camera.cinematic({ bearing: 4 }, "arrival", "automatic"));
    expect(easeTo).toHaveBeenCalledTimes(2);
    expect(jumpTo).not.toHaveBeenCalled();
    expect(padding.bottom).toBe(296);
    run(() => camera.cinematic({ center: [-0.13, 51.51], zoom: 15 }, "venue", "user"));
    expect(padding).toEqual(none);
    expect(jumpTo.mock.invocationCallOrder[0]).toBeLessThan(easeTo.mock.invocationCallOrder[2]!);
  });

  it("stands the preview down and drops the padding when the phone breakpoint changes during the opening", () => {
    let onChange: (() => void) | undefined;
    const query = { matches: true, addEventListener: (_: string, listener: () => void) => { onChange = listener; }, removeEventListener: vi.fn() };
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => query });
    const city = { center: [-0.12, 51.52] as [number, number], zoom: 12, pitch: 38, bearing: 0 };
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    let padding = none;
    const map = {
      on: vi.fn(), off: vi.fn(),
      jumpTo: (options: { padding?: typeof none }) => { if (options.padding) padding = options.padding; },
      setPadding: (next: typeof none) => { padding = next; },
      getPadding: () => padding,
      getCenter: () => ({ lng: city.center[0], lat: city.center[1] }),
      getZoom: () => city.zoom, getPitch: () => city.pitch, getBearing: () => 0,
      getContainer: () => ({ clientWidth: 844, clientHeight: 390 }),
      unproject: ([x, y]: [number, number]) => ({ lng: city.center[0] + x * 1e-5, lat: city.center[1] - y * 1e-5 }),
    } as unknown as MapLibreMap;
    const retracted = vi.fn();
    window.addEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, retracted);
    holdOpeningFrame(map, city, city);
    expect(padding.bottom).toBe(296);
    // The reader turns the phone on its side: the preview's CSS drops its offset.
    query.matches = false;
    onChange?.();
    window.removeEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, retracted);
    expect(retracted).toHaveBeenCalledTimes(1);
    expect(padding).toEqual(none);
  });
});

describe("walk panel overview framing", () => {
  function mountWalk(open = false) {
    mount({ current: soho }, soho, undefined, { current: {
      type: "FeatureCollection", features: [{ type: "Feature", properties: { source: "curated" },
        geometry: { type: "LineString", coordinates: soho.map((stop) => [stop.longitude, stop.latitude]) } }],
    } }, undefined, false, undefined, { resolved: false, area: null, walkPanelOpen: open });
  }
  function panel(rect: DOMRect) {
    const element = document.createElement("section");
    element.className = "mapDrawer left open";
    element.innerHTML = '<aside class="curatedWalkPanel"></aside>';
    document.body.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
    return element;
  }
  function frame() {
    act(() => {
      camera.fitRoute("user");
      const callback = pendingFrame;
      pendingFrame = undefined;
      callback?.(performance.now());
    });
    return fitBounds.mock.calls.at(-1)?.[1];
  }
  it("reports an opening walk fit as pending and lets a newer action cancel it", () => {
    mountWalk(true);
    expect(fitBounds).not.toHaveBeenCalled();
    expect(camera.cameraLanePending()).toBe(true);
    act(() => {
      camera.cinematic({ center: [-0.2, 51.5], zoom: 15 }, "area", "user");
      pendingFrame?.(performance.now());
    });
    expect(camera.cameraLanePending()).toBe(false);
    expect(easeTo).toHaveBeenCalledOnce();
    expect(fitBounds).not.toHaveBeenCalled();
  });
  it("fits the laid-out phone target while its entrance is still moving", () => {
    mapViewport = { width: 390, height: 664 };
    const drawer = panel(new DOMRect(0, 664, 390, 365));
    drawer.classList.add("mobileSharedSheet", "sheet-entering");
    drawer.dataset.sheetMotion = "entering";
    vi.stubGlobal("DOMMatrixReadOnly", class { m41 = 0; m42 = 365; });
    try {
      mountWalk(true);
      expect(camera.cameraLanePending()).toBe(true);
      for (let i = 0; i < 2; i += 1) {
        const callback = pendingFrame;
        pendingFrame = undefined;
        act(() => callback?.(performance.now()));
      }
      expect(fitBounds).toHaveBeenCalledOnce();
      expect(fitBounds.mock.calls[0]?.[1].padding.bottom).toBeGreaterThanOrEqual(397);
    } finally { drawer.remove(); }
  });
  it("reserves the final horizontal drawer edge before its entrance moves", () => {
    mountWalk();
    const drawer = panel(new DOMRect(52, 80, 380, 820));
    drawer.dataset.springAxis = "horizontal";
    vi.stubGlobal("DOMMatrixReadOnly", class { m41 = -380; m42 = 0; });
    try {
      expect(frame().padding.left).toBeGreaterThanOrEqual(840);
    } finally { drawer.remove(); }
  });
  it("keeps the existing phone padding for an ordinary pub route", () => {
    mapViewport = { width: 390, height: 664 };
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    mount({ current: soho }, soho);
    expect(frame().padding).toMatchObject({ right: 28, bottom: 200 });
  });
  it("releases a closing-sheet wait when a newer camera action takes ownership", () => {
    mountWalk();
    const portal = document.createElement("div");
    portal.className = "mobileSheetPortal";
    portal.dataset.sheetExiting = "true";
    portal.append(panel(new DOMRect(0, 563, 390, 28)));
    document.body.append(portal);
    try {
      frame();
      expect(camera.cameraLanePending()).toBe(true);
      act(() => { camera.cinematic({ center: [-0.2, 51.5], zoom: 15 }, "area", "user"); pendingFrame?.(performance.now()); });
      expect(easeTo).toHaveBeenCalled();
      expect(camera.cameraLanePending()).toBe(false);
    } finally { portal.remove(); }
  });
  it("keeps replaced automatic closing fits cancellable by the next user action", () => {
    mountWalk();
    const portal = document.createElement("div");
    portal.className = "mobileSheetPortal";
    portal.dataset.sheetExiting = "true";
    portal.append(panel(new DOMRect(0, 563, 390, 28)));
    document.body.append(portal);
    try {
      act(() => {
        camera.fitRoute();
        camera.fitRoute();
        camera.cinematic({ center: [-0.2, 51.5], zoom: 15 }, "area", "user");
        pendingFrame?.(performance.now());
      });
      expect(easeTo).toHaveBeenCalledOnce();
      expect(camera.cameraLanePending()).toBe(false);
    } finally { portal.remove(); }
  });
  it("reserves measured phone controls before their deferred components mount", () => {
    mapViewport = { width: 390, height: 664 };
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    mountWalk();
    const padding = frame().padding;
    expect(padding.right).toBeGreaterThanOrEqual(88);
    expect(padding.bottom).toBeGreaterThanOrEqual(280);
  });
  it("keeps a closed phone overview clear of the visible Pal and map utility controls", () => {
    mapViewport = { width: 390, height: 664 };
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    mountWalk();
    const surfaces = [
      ["palSummon", new DOMRect(68, 402, 246, 52)],
      ["mobileMapUtilityCorner", new DOMRect(326, 78, 52, 311)],
      ["mobileTabBar", new DOMRect(0, 600, 390, 64)],
    ] as const;
    const elements = surfaces.map(([className, rect]) => {
      const element = document.createElement("div");
      element.className = className;
      document.body.append(element);
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
      return element;
    });
    try {
      const padding = frame().padding;
      expect(padding.right).toBeGreaterThanOrEqual(88);
      expect(padding.bottom).toBeGreaterThanOrEqual(278);
    } finally { elements.forEach((element) => element.remove()); }
  });
  it("reserves the final tablet sheet position when its entrance has not moved yet", () => {
    mapViewport = { width: 768, height: 1024 };
    mountWalk();
    const drawer = panel(new DOMRect(0, 1024, 768, 1024));
    drawer.classList.add("springDrawer", "sheet-half");
    drawer.dataset.springAxis = "vertical";
    vi.stubGlobal("DOMMatrixReadOnly", class { m42 = 1082; });
    try {
      expect(frame().padding.bottom).toBeGreaterThanOrEqual(653);
    } finally { drawer.remove(); }
  });
  it("keeps a recovery fit pending while the walk sheet is closing", () => {
    mountWalk();
    const portal = document.createElement("div");
    portal.className = "mobileSheetPortal";
    portal.dataset.sheetExiting = "true";
    const drawer = panel(new DOMRect(0, 563, 390, 28));
    portal.append(drawer);
    document.body.append(portal);
    try {
      frame();
      expect(fitBounds).not.toHaveBeenCalled();
      expect(camera.cameraLanePending()).toBe(true);
    } finally { portal.remove(); }
  });
  it("fits the walk in a flat plane without changing ordinary route pitch", () => {
    mountWalk();
    const drawer = panel(new DOMRect(0, 80, 400, 820));
    try {
      expect(frame().pitch).toBe(0);
      drawer.remove();
      mount({ current: soho }, soho);
      expect(frame()).not.toHaveProperty("pitch");
    } finally { drawer.remove(); }
  });
  it("keeps usable map space when a walk panel fills the viewport", () => {
    mountWalk();
    const drawer = panel(new DOMRect(0, 0, 1280, 900));
    try {
      const padding = frame().padding;
      expect(padding.top + padding.bottom).toBeLessThanOrEqual(900 - 48);
      expect(padding.left + padding.right).toBeLessThanOrEqual(1280 - 48);
    } finally { drawer.remove(); }
  });
});

describe("the shipped near-me camera", () => {
  it.each([false, true])("frames the reader with one move, reduced motion: %s", (reduced) => {
    reducedMotion = reduced;
    mount({ current: soho });
    act(() => {
      camera.fitNearby({ lat: 51.51, lng: -0.13 }, surrounding, "user");
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [-0.13, 51.51], offset: [0, 20], duration: reduced ? 0 : 700,
    }));
    expect(fitBounds).not.toHaveBeenCalled();
    expect(camera.cameraLanePending()).toBe(false);
    expect(pendingFrame).toBeUndefined();
  });
});

describe("query camera with contextual price pins", () => {
  const picks = [{ lng: -0.22, lat: 51.56 }, { lng: -0.21, lat: 51.57 }];
  const flush = () => {
    const callback = pendingFrame;
    pendingFrame = undefined;
    act(() => callback?.(performance.now()));
  };
  const restore = () => {
    camera.fitRoute();
    camera.fitQueryVenues();
    camera.fitNearby({ lat: 51.51, lng: -0.13 }, soho);
    camera.cinematic({ bearing: 4 }, "arrival", "automatic");
  };

  describe.each([
    ["clusters", "zoom"],
    ["clusters-casing", "zoom"],
    ["cluster-count-badge", "zoom"],
    ["uk-base-overview", "zoom"],
    ["uk-base-overview-count", "leaves"],
  ] as const)("delayed %s %s response", (layer, wait) => {
    it.each([false, true])("preserves action order when the cluster click is newest: %s", async (clusterNewest) => {
      mount({ current: soho }, soho);
      let click: ((event: { point: { x: number; y: number } }) => void) | undefined;
      let resolveZoom!: (zoom: number) => void;
      let resolveLeaves!: (leaves: GeoJSON.Feature<GeoJSON.Point>[]) => void;
      const zoomResponse = new Promise<number>((resolve) => { resolveZoom = resolve; });
      const leavesResponse = new Promise<GeoJSON.Feature<GeoJSON.Point>[]>((resolve) => { resolveLeaves = resolve; });
      const getClusterLeaves = vi.fn(() => leavesResponse);
      wireClickRouting({
        on: (_event: string, handler: typeof click) => { click = handler; },
        getLayer: () => ({}),
        getSource: () => ({ getClusterExpansionZoom: () => zoomResponse, getClusterLeaves }),
        queryRenderedFeatures: () => [{
          layer: { id: layer }, properties: { cluster_id: 7 },
          geometry: { type: "Point", coordinates: [-0.2, 51.6] },
        }],
      } as unknown as MapLibreMap, {
        selectLandmark: vi.fn(), setHoveredVenue: vi.fn(), setActivePoi: vi.fn(),
        onVenueClickRef: { current: vi.fn() }, onUkBasePubClickRef: { current: vi.fn() },
        onRouteStopClickRef: { current: vi.fn() }, onTonightOpportunityClickRef: { current: vi.fn() },
        cityLandmarksRef: { current: [] }, tonightOpportunitiesRef: { current: [] }, cinematic: camera.cinematic,
      });
      if (clusterNewest) camera.fitRoute("user");
      click!({ point: { x: 10, y: 10 } });
      if (wait === "leaves") {
        await act(async () => { resolveZoom(PIN_MIN_ZOOM); });
        expect(getClusterLeaves).toHaveBeenCalledOnce();
      }
      if (!clusterNewest) camera.fitRoute("user");
      await act(async () => {
        resolveZoom(PIN_MIN_ZOOM - 1);
        resolveLeaves([{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-0.21, 51.61] } }]);
      });
      flush();
      if (clusterNewest) {
        expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({
          center: wait === "leaves" ? [-0.21, 51.61] : [-0.2, 51.6],
          zoom: wait === "leaves" ? PIN_MIN_ZOOM : PIN_MIN_ZOOM - 1,
        }));
        expect(fitBounds).not.toHaveBeenCalled();
      } else {
        expect(fitBounds).toHaveBeenCalledOnce();
        expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
          .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
        expect(easeTo).not.toHaveBeenCalled();
      }
    });
  });

  it("keeps pending and settled Pal picks ahead of automatic restorations and late Plan reads", () => {
    mount({ current: soho }, soho);
    camera.fitPalPicks(1, picks);
    restore();
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
    restore();
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect(easeTo).not.toHaveBeenCalled();
    camera.fitPalPicks(2, []);
    camera.fitRoute();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it.each(["search", "venue", "city", "cluster", "landmark"] as const)(
    "lets an explicit %s action replace pending Pal framing", (action) => {
      mount({ current: soho }, soho);
      camera.fitPalPicks(1, picks);
      if (action === "search") camera.fitQueryVenues("search-recovery", nextCameraRequestToken());
      else if (action === "city") camera.fitCityBounds();
      else camera.cinematic({ center: [-0.13, 51.51] }, action, "user");
      flush();
      expect(fitBounds.mock.calls.length + easeTo.mock.calls.length).toBe(1);
      if (action === "search") {
        expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
          .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
      } else if (action === "city") {
        expect(fitBounds.mock.calls[0]![0]).toEqual([[-0.3, 51.4], [0.1, 51.7]]);
      } else {
        expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.13, 51.51] }));
      }
      camera.fitQueryVenues();
      flush();
      expect(fitBounds.mock.calls.length + easeTo.mock.calls.length).toBe(2);
    },
  );

  it.each(["Map route", "stop change", "reverse", "curated crawl", "nearby crawl", "generated plan"])(
    "lets mounted %s actions end Pal ownership", (action) => {
      const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
      mount({ current: soho }, surrounding, { active: false, endedAt: null }, undefined, undefined, false, planRef);
      flush();
      fitBounds.mockClear();
      camera.fitPalPicks(1, picks);
      flush();
      expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
        .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
      act(() => {
        const plan = planRef.current!;
        if (action === "generated plan") plan.activateGeneratedPlan(null, soho.map((venue) => venue.id));
        else {
          if (action === "reverse") plan.setBuiltIds((ids) => [...ids].reverse());
          if (action.endsWith("crawl") || action === "stop change") plan.setBuiltIds(soho.map((venue) => venue.id));
          plan.mapRoute();
        }
      });
      flush();
      const expectedBounds = action === "Map route" || action === "reverse"
        ? [[-2.244, 51.514], [-0.129, 53.483]]
        : [[-0.139, 51.514], [-0.129, 51.516]];
      expect(fitBounds).toHaveBeenCalledTimes(2);
      expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
        .toEqual(expectedBounds);
      camera.fitQueryVenues();
      flush();
      expect(fitBounds).toHaveBeenCalledTimes(3);
      expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
        .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    },
  );

  it.each([false, true])("blocks a late mounted opening-location answer after Pal settles: %s", (settled) => {
    const opening = { resolved: false, area: null as MapCameraFocus | null };
    const rerender = mount({ current: soho }, [], undefined, undefined, undefined, false, undefined, opening);
    camera.fitPalPicks(1, picks);
    if (settled) flush();
    opening.resolved = true;
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
    expect(easeTo).not.toHaveBeenCalled();

    opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
    rerender();
    flush();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.1, 51.5] }));
    camera.fitQueryVenues();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it("applies mounted opening location normally without Pal picks", () => {
    const opening = { resolved: false, area: null as MapCameraFocus | null };
    const rerender = mount({ current: soho }, [], undefined, undefined, undefined, false, undefined, opening);
    opening.resolved = true;
    rerender();
    flush();
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-2.3216, 54.5232] }));
  });

  it("preserves a user route request until the mounted canvas becomes ready", () => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const readiness = { current: false };
    const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined, false, planRef, undefined, readiness);
    act(() => planRef.current!.mapRoute());
    camera.fitPalPicks(1, picks);
    flush();
    readiness.current = true;
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
      .toEqual([[-2.244, 51.514], [-0.129, 53.483]]);
  });

  it("preserves a route request made before the canvas mounts", () => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const readiness = { current: false };
    const canvasMounted = { current: false };
    const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined, false,
      planRef, undefined, readiness, canvasMounted);
    act(() => planRef.current!.mapRoute());
    canvasMounted.current = true;
    rerender();
    camera.fitPalPicks(1, picks);
    flush();
    readiness.current = true;
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
      .toEqual([[-2.244, 51.514], [-0.129, 53.483]]);
  });

  it("preserves a Near me request made before the canvas mounts", () => {
    const readiness = { current: false };
    const rerender = mount({ current: soho }, [], undefined, undefined, { current: nextCameraRequestToken() }, true,
      undefined, undefined, readiness);
    camera.fitPalPicks(1, picks);
    flush();
    readiness.current = true;
    rerender();
    flush();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.13, 51.51] }));
  });

  describe.each([false, true])("with the canvas initially mounted: %s", (mounted) => {
    describe.each(["clear", "hide", "one stop"] as const)("after route %s", (change) => {
      it.each(["nearby", "area", "search"] as const)("preserves the newer %s move on readiness", (action) => {
        const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
        const readiness = { current: false };
        const canvasMounted = { current: mounted };
        const nearbyRequest = { current: 0 };
        const searchRecovery = { current: 0 };
        const opening = { resolved: false, area: null as MapCameraFocus | null };
        const rerender = mount({ current: soho }, surrounding, undefined, undefined, nearbyRequest,
          action === "nearby", planRef, opening, readiness, canvasMounted, searchRecovery);
        act(() => planRef.current!.mapRoute());
        act(() => {
          if (change === "hide") planRef.current!.setRouteMapped(false);
          else planRef.current!.setBuiltIds(change === "clear" ? [] : [soho[0]!.id]);
        });
        if (action === "nearby") nearbyRequest.current = nextCameraRequestToken();
        else if (action === "area") opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
        else searchRecovery.current = nextCameraRequestToken();
        canvasMounted.current = true;
        readiness.current = true;
        rerender();
        flush();
        if (action === "search") {
          expect(fitBounds).toHaveBeenCalledOnce();
          expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
            .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
          expect(easeTo).not.toHaveBeenCalled();
        } else {
          expect(easeTo).toHaveBeenCalledOnce();
          expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({
            center: action === "nearby" ? [-0.13, 51.51] : [-0.1, 51.5],
          }));
          expect(fitBounds).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe.each([false, true])("request ordering with mounted canvas: %s", (mounted) => {
    describe.each(["route", "nearby"] as const)("retained %s request", (retained) => {
      describe.each(["area", "search", "nearby"] as const)("competing with %s", (action) => {
        it.each([false, true])("honours action order, retained request newest: %s", (retainedNewest) => {
          const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
          const readiness = { current: false };
          const canvasMounted = { current: mounted };
          const nearbyRequest = { current: 0 };
          const searchRecovery = { current: 0 };
          const opening = { resolved: false, area: null as MapCameraFocus | null };
          const rerender = mount({ current: soho }, retained === "route" ? surrounding : [], undefined,
            undefined, nearbyRequest, retained === "nearby" || action === "nearby", planRef, opening, readiness, canvasMounted, searchRecovery);
          const requestRetained = () => {
            if (retained === "route") act(() => planRef.current!.mapRoute());
            else nearbyRequest.current = nextCameraRequestToken();
          };
          const requestOther = () => {
            if (action === "area") opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
            else if (action === "search") searchRecovery.current = nextCameraRequestToken();
            else nearbyRequest.current = nextCameraRequestToken();
          };
          if (retainedNewest) { requestOther(); requestRetained(); }
          else { requestRetained(); requestOther(); }
          canvasMounted.current = true;
          readiness.current = true;
          rerender();
          flush();
          expect(fitBounds.mock.calls.length + easeTo.mock.calls.length).toBe(1);
          if (retainedNewest && retained === "route") {
            expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
              .toEqual([[-2.244, 51.514], [-0.129, 53.483]]);
          } else if (!retainedNewest && action === "search") {
            expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
              .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
          } else {
            expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({
              center: retainedNewest || action === "nearby" ? [-0.13, 51.51] : [-0.1, 51.5],
            }));
          }
        });
      });
    });
    it("does not restore an older consumed route after readiness returns", () => {
      const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
      const readiness = { current: true };
      const opening = { resolved: false, area: null as MapCameraFocus | null };
      const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined,
        false, planRef, opening, readiness);
      act(() => planRef.current!.mapRoute());
      flush();
      opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
      rerender();
      flush();
      fitBounds.mockClear();
      easeTo.mockClear();
      readiness.current = false;
      rerender();
      readiness.current = true;
      rerender();
      flush();
      expect(fitBounds).not.toHaveBeenCalled();
      expect(easeTo).not.toHaveBeenCalled();
    });
    describe.each(["one stop", "clear", "hide"] as const)("route %s", (change) => {
      describe.each(["area", "search", "nearby"] as const)("competing with %s", (action) => {
        it.each([false, true])("honours action order, release newest: %s", (releaseNewest) => {
          const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
          const readiness = { current: false };
          const canvasMounted = { current: mounted };
          const nearbyRequest = { current: 0 };
          const searchRecovery = { current: 0 };
          const opening = { resolved: false, area: null as MapCameraFocus | null };
          const rerender = mount({ current: soho }, surrounding, undefined, undefined, nearbyRequest,
            action === "nearby", planRef, opening, readiness, canvasMounted, searchRecovery);
          const release = () => act(() => {
            if (change === "hide") planRef.current!.hideRoute();
            else {
              planRef.current!.setBuiltIds(change === "clear" ? [] : [soho[0]!.id]);
              planRef.current!.mapRoute();
            }
          });
          const requestOther = () => {
            if (action === "area") opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
            else if (action === "search") searchRecovery.current = nextCameraRequestToken();
            else nearbyRequest.current = nextCameraRequestToken();
          };
          if (releaseNewest) { requestOther(); release(); }
          else { release(); requestOther(); }
          canvasMounted.current = true;
          readiness.current = true;
          rerender();
          flush();
          expect(fitBounds.mock.calls.length + easeTo.mock.calls.length).toBe(releaseNewest ? 0 : 1);
          if (!releaseNewest && action === "search") {
            expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
              .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
          } else if (!releaseNewest) {
            expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({
              center: action === "nearby" ? [-0.13, 51.51] : [-0.1, 51.5],
            }));
          }
          fitBounds.mockClear();
          camera.fitQueryVenues();
          flush();
          expect(fitBounds).toHaveBeenCalledOnce();
        });
      });
    });
  });

  it("frames a newly adopted walking link after an earlier route and area request", async () => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const opening = { resolved: false, area: null as MapCameraFocus | null };
    const search = { current: "" };
    const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined,
      false, planRef, opening, undefined, undefined, undefined, undefined, search);
    act(() => planRef.current!.mapRoute());
    flush();
    opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
    rerender();
    flush();
    fitBounds.mockClear();
    easeTo.mockClear();
    search.current = "mode=build&pubs=soho-west,soho-east";
    window.history.pushState(null, "", `/map?${search.current}`);
    await act(async () => { rerender(); });
    flush();
    expect(easeTo).not.toHaveBeenCalled();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it.each([false, true])("retains a walking-link request during hydration with an active Plan: %s", async (activePlan) => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const search = { current: "" };
    const planData = { venues: [...surrounding], activePlanRoute: activePlan ? surrounding : [] };
    const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined, false, planRef,
      undefined, undefined, undefined, undefined, undefined, search, planData);
    flush();
    fitBounds.mockClear();
    planData.venues = [];
    search.current = "mode=build&pubs=soho-west,soho-east";
    window.history.pushState(null, "", `/map?${search.current}`);
    await act(async () => { rerender(); });
    camera.fitPalPicks(1, picks);
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
    planData.venues = [soho[0]!];
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    planData.venues = soho;
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it.each([false, true])("preserves an asynchronous route request token, request is current: %s", (current) => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const rerender = mount({ current: soho }, soho, undefined, undefined, undefined, false, planRef);
    flush();
    fitBounds.mockClear();
    act(() => planRef.current!.hideRoute());
    flush();
    fitBounds.mockClear();
    const requestToken = nextCameraRequestToken();
    if (!current) nextCameraRequestToken();
    const latestToken = currentCameraRequestToken();
    act(() => planRef.current!.mapRoute(requestToken));
    rerender();
    flush();
    expect(currentCameraRequestToken()).toBe(latestToken);
    expect(planRef.current!.routeMapped).toBe(current);
    expect(fitBounds).toHaveBeenCalledTimes(current ? 1 : 0);
    if (current) expect(planRef.current!.routeRequestToken).toBe(requestToken);
  });

  it.each([false, true])("frames resolved shared stops after an unsuccessful lookup, active Plan: %s", async (activePlan) => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const search = { current: "" };
    const planData = { venues: [...surrounding], activePlanRoute: activePlan ? surrounding : [], settledBuiltStopIds: new Set<string>() };
    const rerender = mount({ current: soho }, surrounding, undefined, undefined, undefined, false, planRef,
      undefined, undefined, undefined, undefined, undefined, search, planData);
    flush();
    fitBounds.mockClear();
    planData.venues = soho;
    search.current = "mode=build&pubs=soho-west,removed-stop,soho-east";
    window.history.pushState(null, "", `/map?${search.current}`);
    await act(async () => { rerender(); });
    flush();
    expect(fitBounds).not.toHaveBeenCalled();
    planData.settledBuiltStopIds = new Set(["removed-stop"]);
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    act(() => planRef.current!.mapRoute());
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  describe.each(["area", "search", "nearby"] as const)("hydration competing with %s", (action) => {
    it.each([false, true])("preserves action order, route request newest: %s", (routeNewest) => {
      const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
      const planData: { venues: Venue[]; activePlanRoute: Venue[] } = { venues: [], activePlanRoute: [] };
      const opening = { resolved: false, area: null as MapCameraFocus | null };
      const nearbyRequest = { current: 0 };
      const searchRecovery = { current: 0 };
      const rerender = mount({ current: soho }, soho, undefined, undefined, nearbyRequest,
        action === "nearby", planRef, opening, undefined, undefined, searchRecovery, undefined, undefined, planData);
      flush();
      fitBounds.mockClear();
      easeTo.mockClear();
      const otherRequest = () => {
        if (action === "area") opening.area = nextAreaCameraFocus({ center: [-0.1, 51.5], zoom: 15 });
        else if (action === "search") searchRecovery.current = nextCameraRequestToken();
        else nearbyRequest.current = nextCameraRequestToken();
        rerender();
      };
      if (routeNewest) { otherRequest(); act(() => planRef.current!.mapRoute()); }
      else { act(() => planRef.current!.mapRoute()); otherRequest(); }
      flush();
      fitBounds.mockClear();
      easeTo.mockClear();
      planData.venues = soho;
      rerender();
      flush();
      expect(easeTo).not.toHaveBeenCalled();
      expect(fitBounds).toHaveBeenCalledTimes(routeNewest ? 1 : 0);
      if (routeNewest) expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
        .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    });
  });

  it.each(["clear", "hide", "one stop"] as const)("releases a route awaiting hydration after %s", (change) => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    const planData: { venues: Venue[]; activePlanRoute: Venue[] } = { venues: [], activePlanRoute: [] };
    const rerender = mount({ current: soho }, soho, undefined, undefined, undefined, false, planRef,
      undefined, undefined, undefined, undefined, { current: soho[0]!.id }, undefined, planData);
    act(() => planRef.current!.mapRoute());
    camera.fitPalPicks(1, picks);
    flush();
    act(() => {
      if (change === "hide") planRef.current!.hideRoute();
      else {
        planRef.current!.setBuiltIds(change === "clear" ? [] : [soho[0]!.id]);
        planRef.current!.mapRoute();
      }
    });
    camera.fitQueryVenues();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    planData.venues = soho;
    rerender();
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it.each(["route", "search", "venue", "city", "nearby"] as const)(
    "keeps a queued user %s ahead of a later Pal answer and automatic restoration", (action) => {
      mount({ current: soho }, soho);
      if (action === "route") camera.fitRoute("user");
      else if (action === "search") camera.fitQueryVenues("search-recovery", nextCameraRequestToken());
      else if (action === "city") camera.fitCityBounds();
      else if (action === "nearby") camera.fitNearby({ lat: 51.51, lng: -0.13 }, soho, "user");
      else camera.cinematic({ center: [-0.13, 51.51] }, "venue", "user");
      camera.fitPalPicks(1, picks);
      camera.fitPalPicks(2, picks.slice(0, 1), true);
      restore();
      flush();
      expect(fitBounds.mock.calls.length + easeTo.mock.calls.length).toBe(1);
      if (action === "route" || action === "search") {
        expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
          .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
      } else if (action === "city") {
        expect(fitBounds.mock.calls[0]![0]).toEqual([[-0.3, 51.4], [0.1, 51.7]]);
      } else {
        expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.13, 51.51] }));
      }
      camera.fitPalPicks(3, picks);
      flush();
      expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
        .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
    },
  );

  it.each(["automatic", "user"] as const)("discards a delayed %s Nearby move after a newer venue selection runs", (owner) => {
    mount({ current: soho });
    const sheet = document.createElement("div");
    sheet.className = "mobileSharedSheet open";
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 400, 1280, 500));
    host.append(sheet);
    camera.fitNearby({ lat: 51.51, lng: -0.13 }, soho, owner);
    const sheetFrame = pendingFrame;
    expect(sheetFrame).toBeTypeOf("function");
    camera.cinematic({ center: [-0.22, 51.56] }, "venue", "user");
    flush();
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [-0.22, 51.56] }));
    pendingFrame = sheetFrame;
    flush();
    flush();
    flush();
    flush();
    flush();
    expect(camera.cameraLanePending()).toBe(false);
    expect(easeTo).toHaveBeenCalledOnce();
  });

  describe.each(["sheet", "frame"] as const)("superseded Nearby %s wait", (wait) => {
    it.each(["pal", "automatic"] as const)("allows %s framing after a cold venue selection closes", (owner) => {
      const now = vi.spyOn(performance, "now").mockReturnValue(0);
      const selectedVenue = { current: "", requestToken: 0 };
      const rerender = mount({ current: soho }, [], undefined, undefined, undefined, false, undefined,
        undefined, undefined, undefined, undefined, selectedVenue);
      if (wait === "sheet") {
        const sheet = document.createElement("div");
        sheet.className = "mobileSharedSheet open";
        vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 400, 1280, 500));
        host.append(sheet);
      }
      camera.fitNearby({ lat: 51.51, lng: -0.13 }, soho, "user");
      const staleFrame = pendingFrame;
      expect(staleFrame).toBeTypeOf("function");
      selectedVenue.current = "unloaded-venue";
      selectedVenue.requestToken = nextCameraRequestToken();
      rerender();
      selectedVenue.current = "";
      rerender();
      now.mockReturnValue(1000);
      pendingFrame = staleFrame;
      flush();
      expect(easeTo).not.toHaveBeenCalled();
      expect(camera.cameraLanePending()).toBe(false);
      if (owner === "pal") camera.fitPalPicks(1, picks);
      else camera.fitQueryVenues();
      flush();
      expect(fitBounds).toHaveBeenCalledOnce();
      expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray()).toEqual(owner === "pal"
        ? [[-0.22, 51.56], [-0.21, 51.57]]
        : [[-0.139, 51.514], [-0.129, 51.516]]);
    });
  });

  it("keeps a newer Nearby claim when a superseded sheet wait completes", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const selectedVenue = { current: "", requestToken: 0 };
    const rerender = mount({ current: soho }, [], undefined, undefined, undefined, false, undefined,
      undefined, undefined, undefined, undefined, selectedVenue);
    const sheet = document.createElement("div");
    sheet.className = "mobileSharedSheet open";
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 400, 1280, 500));
    host.append(sheet);
    camera.fitNearby({ lat: 51.51, lng: -0.13 }, soho, "user");
    const staleFrame = pendingFrame;
    selectedVenue.current = "unloaded-venue";
    selectedVenue.requestToken = nextCameraRequestToken();
    rerender();
    selectedVenue.current = "";
    rerender();
    camera.fitNearby({ lat: 51.52, lng: -0.12 }, soho, "user");
    const currentFrame = pendingFrame;
    now.mockReturnValue(1000);
    pendingFrame = staleFrame;
    flush();
    camera.fitPalPicks(1, picks);
    camera.fitQueryVenues();
    expect(fitBounds).not.toHaveBeenCalled();
    pendingFrame = currentFrame;
    flush();
    flush();
    expect(easeTo).toHaveBeenCalledOnce();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.12, 51.52] }));
    expect(camera.cameraLanePending()).toBe(false);
  });

  describe.each([false, true])("with inspector open: %s", (inspectorOpen) => {
    it.each(["one stop", "clear", "hide"] as const)("releases Pal ownership after route %s", (change) => {
      const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
      mount({ current: soho }, soho, undefined, undefined, undefined, false, planRef,
        undefined, undefined, undefined, undefined, { current: inspectorOpen ? soho[0]!.id : "" });
      camera.fitPalPicks(1, picks);
      flush();
      act(() => {
        if (change === "hide") planRef.current!.hideRoute();
        else {
          planRef.current!.setBuiltIds(change === "clear" ? [] : [soho[0]!.id]);
          planRef.current!.mapRoute();
        }
      });
      flush();
      camera.fitQueryVenues();
      flush();
      expect(fitBounds).toHaveBeenCalledTimes(2);
      expect((fitBounds.mock.calls.at(-1)![0] as LngLatBounds).toArray())
        .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    });
  });

  it("blocks mounted restoration updates while Pal owns the camera", () => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    mount({ current: soho }, surrounding, { active: false, endedAt: null }, undefined, undefined, false, planRef);
    flush();
    fitBounds.mockClear();
    camera.fitPalPicks(1, picks);
    act(() => {
      planRef.current!.setBuiltIds(soho.map((venue) => venue.id));
      planRef.current!.setRouteMapped(true);
    });
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.22, 51.56], [-0.21, 51.57]]);
    act(() => planRef.current!.mapRoute());
    flush();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect((fitBounds.mock.calls[1]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it("cancels a queued Pal move when picks clear before its frame", () => {
    mount({ current: soho });
    camera.fitPalPicks(1, picks);
    camera.fitPalPicks(2, []);
    flush();
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("lands a move the person asked the Pal for inside the gesture hold, where answer framing stands down", () => {
    const gesture = { active: false, endedAt: performance.now() - 500 };
    mount({ current: soho }, soho, gesture);
    camera.fitPalPicks(1, picks);
    flush();
    expect(fitBounds).not.toHaveBeenCalled();
    camera.fitPalPicks(2, picks.slice(0, 1), true);
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    gesture.active = true;
    camera.fitPalPicks(3, picks.slice(0, 1), true);
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
  });

  it("ends Pal ownership when a gesture interrupts the pending move", () => {
    const gesture = { active: false, endedAt: null as number | null };
    mount({ current: soho }, soho, gesture);
    camera.fitPalPicks(1, picks);
    gesture.active = true;
    flush();
    expect(fitBounds).not.toHaveBeenCalled();
    gesture.active = false;
    gesture.endedAt = performance.now() - 3_000;
    camera.fitRoute();
    flush();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it("lets an explicit Near me request frame the same location after retained Pal picks", () => {
    const requestToken = { current: 0 };
    const rerender = mount({ current: soho }, [], { active: false, endedAt: null }, undefined, requestToken, true);
    camera.fitPalPicks(1, picks);
    flush();
    expect(fitBounds).toHaveBeenCalledOnce();
    expect(easeTo).not.toHaveBeenCalled();
    requestToken.current = nextCameraRequestToken();
    rerender();
    flush();
    expect(easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-0.13, 51.51] }));
  });

  it("fits road detours beyond the stops and reads the latest road during recovery", () => {
    const line = (geometry: GeoJSON.Geometry): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }],
    });
    const routeLineRef = { current: line({ type: "LineString", coordinates: [] }) };
    mount({ current: [] }, soho, { active: false, endedAt: null }, routeLineRef);
    const fit = (owner: "automatic" | "user" = "automatic") => act(() => {
      camera.fitRoute(owner);
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    fit();
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    routeLineRef.current = line({ type: "MultiLineString", coordinates: [
      [[-0.16, 51.52], [-0.13, 51.515]], [[-0.12, 51.51], [NaN, 51.5], [-0.1, Infinity]],
    ] });
    fit();
    expect(fitBounds).toHaveBeenCalledTimes(2);
    expect((fitBounds.mock.calls[1]![0] as LngLatBounds).toArray())
      .toEqual([[-0.16, 51.51], [-0.12, 51.52]]);
    routeLineRef.current = line({ type: "LineString", coordinates: [[-0.18, 51.53]] });
    fit("user");
    expect((fitBounds.mock.calls[2]![0] as LngLatBounds).toArray())
      .toEqual([[-0.18, 51.514], [-0.129, 51.53]]);
  });

  it("ignores non-line geometry and never frames a road without route stops", () => {
    const routeLineRef: { current: GeoJSON.FeatureCollection } = { current: {
      type: "FeatureCollection", features: [{ type: "Feature", properties: {},
        geometry: { type: "Point", coordinates: [-2, 53] } }],
    } };
    mount({ current: [] }, soho, { active: false, endedAt: null }, routeLineRef);
    act(() => { camera.fitRoute(); pendingFrame?.(performance.now()); });
    expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
      .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    fitBounds.mockClear();
    pendingFrame = undefined;
    mount({ current: [] }, [], { active: false, endedAt: null }, routeLineRef);
    act(() => { camera.fitRoute("user"); pendingFrame?.(performance.now()); });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("reserves the tablet toolbar and status lane before transport data arrives", () => {
    const toolbar = document.createElement("div");
    toolbar.className = "mapToolbar";
    toolbar.getBoundingClientRect = () => ({ top: 171, bottom: 230, height: 59 }) as DOMRect;
    document.body.append(toolbar);
    mount({ current: [] }, soho);
    act(() => {
      camera.fitRoute();
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    toolbar.remove();
    expect(fitBounds.mock.calls[0]?.[1].padding.top).toBeGreaterThanOrEqual(386);
  });

  it("recovers the whole walk immediately after a drag while automatic fits stand down", () => {
    mount({ current: [] }, soho, { active: false, endedAt: performance.now() }, {
      current: { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: [[-0.16, 51.52]] } }] },
    });
    act(() => {
      camera.fitRoute();
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    expect(fitBounds).not.toHaveBeenCalled();
    act(() => {
      camera.fitRoute("user");
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    expect(fitBounds).toHaveBeenCalledOnce();
    act(() => {
      camera.fitRoute("user");
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it("lets a short walking route reach street zoom without changing its bearing", () => {
    mount({ current: [] }, [pub("first-stop", -0.135, 51.511), pub("last-stop", -0.134, 51.5115)]);
    act(() => {
      camera.fitRoute();
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    const options = fitBounds.mock.calls[0]?.[1];
    expect(options.maxZoom).toBeGreaterThanOrEqual(17);
    expect(options.bearing).toBe(-8);
    expect(options.duration).toBe(0);
  });

  it("frames only the query matches while other pins remain in the map dataset", () => {
    mount({ current: soho });
    fitQuery();
    const bounds = fitBounds.mock.calls[0]?.[0] as LngLatBounds;
    expect(bounds.toArray()).toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
  });

  it("reads the latest query matches when a later search moves the camera", () => {
    const queryVenuesRef = { current: soho };
    mount(queryVenuesRef);
    queryVenuesRef.current = [pub("hatton", -0.109, 51.518)];
    fitQuery();
    const bounds = fitBounds.mock.calls[0]?.[0] as LngLatBounds;
    expect(bounds.toArray()).toEqual([[-0.109, 51.518], [-0.109, 51.518]]);
  });

  it("keeps the camera still when the query has no matches", () => {
    mount({ current: [] });
    fitQuery();
    expect(fitBounds).not.toHaveBeenCalled();
  });
});

describe("closing a route stop", () => {
  it.each([
    ["home", false], ["home", true], ["direct dismiss", false], ["direct dismiss", true],
  ] as const)("recovers a cold mapped walk after %s and its remaining venue resolves, reader moved: %s", async (exit, moved) => {
    const fitRoute = vi.fn();
    const restoreCamera = vi.fn();
    const gesture = { current: { active: false, endedAt: null, movementSerial: 0 } };
    let navigation!: ReturnType<typeof useMapSurfaceNavigation>;
    let resolveVenues!: () => void;
    const selectedToken = nextCameraRequestToken();
    window.history.replaceState(null, "", "/map?mode=build&pubs=soho-west,soho-east&sel=soho-west");
    function Journey() {
      const [venues, setVenues] = useState(soho.slice(0, 1));
      const [selected, setSelected] = useState("soho-west");
      const [closeToken, setCloseToken] = useState(0);
      const presentation = useMapPlanPresentation({ mode: "build", builtIds: soho.map(pub => pub.id),
        routeMapped: true, suggestedRoute: [], activePlanRoute: [],
        venueById: new Map(venues.map(pub => [pub.id, pub])) });
      resolveVenues = () => setVenues(soho);
      navigation = useMapSurfaceNavigation({
        arrivalSearch: window.location.search, surfaceId: selected ? "venue" : "none", surfaceTitle: "Stop",
        surfaceState: { ...EMPTY_MAP_SURFACE_STATE, venueId: selected }, selectionHint: "",
        mappedRouteActive: presentation.routeForMap.length >= 2,
        mappedRoutePending: presentation.routePending,
        selectedVenueRequestToken: selectedToken, onVenueClose: setCloseToken,
        onRestore: entry => setSelected(entry?.id === "venue" ? entry.state?.venueId ?? "" : ""),
        onReturnToMap: restoreCamera, onHome: () => setSelected(""), onSurfaceClose: () => {},
      });
      useRouteCameraFraming({ mapReady: true, routeKey: presentation.routeForMap.map(pub => pub.id).join(">"),
        routePending: presentation.routePending, selectedVenueId: selected, closeRequestToken: closeToken,
        gestureCameraRef: gesture, fitRoute });
      return null;
    }
    await act(async () => root.render(createElement(Journey)));
    if (moved) gesture.current.movementSerial += 1;
    await act(async () => {
      const landed = new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true }));
      if (exit === "direct dismiss") requestMobileSheetDismiss(() => {});
      else navigation.home();
      await landed;
    });
    expect(fitRoute).not.toHaveBeenCalled();
    act(() => resolveVenues());
    expect(restoreCamera).not.toHaveBeenCalled();
    if (moved) expect(fitRoute).not.toHaveBeenCalled();
    else expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", selectedToken);
  });

  it.each(["direct dismiss", "no-walk clear"])("does not retain a selection marker after %s without a walk", (exit) => {
    const fitRoute = vi.fn();
    let selected = "stop";
    let routeKey = "";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey, selectedVenueId: selected,
        closeRequestToken: closeToken, fitRoute });
      return null;
    }
    const render = () => act(() => root.render(createElement(Camera)));
    render();
    selected = "";
    if (exit === "direct dismiss") closeToken = nextCameraRequestToken();
    render();
    fitRoute.mockClear();
    routeKey = "a>b";
    render();
    expect(fitRoute).toHaveBeenCalledExactlyOnceWith("automatic", 0);
  });

  // The ownership contract requires the newest deliberate request to win,
  // even when route data or map readiness delays both requests.
  it.each([
    ["route data", "close", false], ["route data", "close", true],
    ["route data", "route", false], ["route data", "route", true],
    ["map readiness", "close", false], ["map readiness", "close", true],
    ["map readiness", "route", false], ["map readiness", "route", true],
  ] as const)("honours the newest %s-delayed %s request, reader moved: %s", (delay, newest, moved) => {
    const gesture = { current: { active: false, endedAt: null, movementSerial: 0 } };
    let selected = "stop";
    let ready = false;
    let requestToken = nextCameraRequestToken();
    let closeToken = 0;
    function Camera() {
      const ownedCamera = useMapCamera({
        latestRequestToken: latestMapCameraRequestToken({ routeRequestToken: requestToken,
          closeVenueRequestToken: closeToken, nearbyRequestToken: 0,
          selectedVenueId: selected, selectedVenueRequestToken: 0 }),
        mapRef: { current: { stop: vi.fn(), fitBounds, getBearing: () => -8,
          getContainer: () => ({ clientWidth: 1280, clientHeight: 900,
            getBoundingClientRect: () => ({ top: 0 }) }),
        } as unknown as MapLibreMap },
        reducedRef: { current: true }, cityViewRef: { current: {
          center: [-0.13, 51.51], zoom: 12, pitch: 40, bearing: -8 } },
        cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
        routeRef: { current: soho }, routeLineRef: { current: { type: "FeatureCollection", features: [] } },
        venuesRef: { current: soho }, gestureCameraRef: gesture,
      });
      useRouteCameraFraming({ mapReady: delay === "route data" || ready,
        routePending: delay === "route data" && !ready, routeKey: "a>b",
        selectedVenueId: selected, requestToken, closeRequestToken: closeToken,
        gestureCameraRef: gesture, fitRoute: ownedCamera.fitRoute });
      return null;
    }
    const render = () => act(() => root.render(createElement(Camera)));
    render();
    selected = "";
    closeToken = nextCameraRequestToken();
    if (moved) gesture.current.movementSerial += 1;
    render();
    if (newest === "route") requestToken = nextCameraRequestToken();
    ready = true;
    render();
    act(() => { pendingFrame?.(performance.now()); pendingFrame = undefined; });
    if (moved && newest === "close") expect(fitBounds).not.toHaveBeenCalled();
    else {
      expect(fitBounds).toHaveBeenCalledOnce();
      expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
        .toEqual([[-0.139, 51.514], [-0.129, 51.516]]);
    }
  });

  it.each([
    ["home", false], ["home", true],
    ["back", false], ["back", true],
    ["browser back", false], ["browser back", true],
    ["parent home", false], ["parent home", true],
  ] as const)("keeps walk camera ownership through %s, reader moved: %s", async (exit, moved) => {
    const fitRoute = vi.fn();
    const restoreCamera = vi.fn();
    const gesture = { current: { active: false, endedAt: null, movementSerial: 0 } };
    let navigation: ReturnType<typeof useMapSurfaceNavigation>;
    const selectedToken = nextCameraRequestToken();
    let mapWalk: () => void;
    let openStop: () => void;
    window.history.replaceState(null, "", "/map");
    function Journey() {
      const [mapped, setMapped] = useState(false);
      const [selected, setSelected] = useState("");
      const [closeToken, setCloseToken] = useState(0);
      navigation = useMapSurfaceNavigation({
        arrivalSearch: "", surfaceId: "none", surfaceTitle: "",
        surfaceState: EMPTY_MAP_SURFACE_STATE, selectionHint: "",
        mappedRouteActive: mapped,
        onRestore: (entry) => setSelected(entry?.id === "venue" ? entry.state?.venueId ?? "" : ""),
        onReturnToMap: restoreCamera,
        selectedVenueRequestToken: selectedToken,
        onVenueClose: setCloseToken,
        onHome: () => setSelected(""), onSurfaceClose: () => {},
      });
      mapWalk = () => setMapped(true);
      openStop = () => {
        navigation.open({ id: "venue", title: "Stop", state: { ...EMPTY_MAP_SURFACE_STATE, venueId: "b" } });
        setSelected("b");
      };
      useRouteCameraFraming({
        mapReady: true, routeKey: mapped ? "a>b" : "", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: gesture, fitRoute,
      });
      return null;
    }
    async function traverse(action: () => void) {
      await act(async () => {
        const landed = new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => resolve(), { once: true });
        });
        action();
        await landed;
      });
    }
    act(() => root.render(createElement(Journey)));
    act(() => navigation.open({
      id: "planner", title: "Plan",
      state: { ...EMPTY_MAP_SURFACE_STATE, returnCamera: { center: [-0.14, 51.54], zoom: 14 } },
    }));
    act(() => mapWalk());
    act(() => openStop());
    fitRoute.mockClear();
    if (moved) gesture.current.movementSerial += 1;

    await traverse(() => {
      if (exit === "home") navigation.home();
      else if (exit === "browser back") window.history.back();
      else navigation.back();
    });
    expect(restoreCamera).not.toHaveBeenCalled();
    expect(fitRoute).toHaveBeenCalledTimes(moved ? 0 : 1);
    if (!moved) expect(fitRoute).toHaveBeenCalledWith("user", expect.any(Number));

    if (exit !== "home") {
      await traverse(() => {
        if (exit === "parent home") navigation.home();
        else navigation.back();
      });
    }
    expect(restoreCamera).not.toHaveBeenCalled();
    expect(fitRoute).toHaveBeenCalledTimes(moved ? 0 : 1);
  });

  it.each(["nearby", "search", "area"] as const)("keeps a newer queued %s camera move when the venue closes", async (action) => {
    const selectedToken = nextCameraRequestToken();
    let request = 0;
    let navigation!: ReturnType<typeof useMapSurfaceNavigation>;
    const refs = {
      mapRef: { current: { stop: vi.fn(), fitBounds, easeTo, getBearing: () => -8,
        getContainer: () => ({ clientWidth: 1280, clientHeight: 900,
          getBoundingClientRect: () => ({ top: 0, width: 1280, height: 900 }) }),
      } as unknown as MapLibreMap },
      reducedRef: { current: true }, cityViewRef: { current: {
        center: [-0.13, 51.51] as [number, number], zoom: 12, pitch: 40, bearing: -8 } },
      cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] as [[number, number], [number, number]] },
      routeRef: { current: soho }, routeLineRef: { current: { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection },
      venuesRef: { current: soho }, queryVenuesRef: { current: soho.slice(0, 1) },
      gestureCameraRef: { current: { active: false, endedAt: null, movementSerial: 0 } },
    };
    window.history.replaceState(null, "", "/map");
    function Journey() {
      const [selected, setSelected] = useState("stop");
      const [closeToken, setCloseToken] = useState(0);
      navigation = useMapSurfaceNavigation({
        arrivalSearch: "", surfaceId: "none", surfaceTitle: "",
        surfaceState: EMPTY_MAP_SURFACE_STATE, selectionHint: "", mappedRouteActive: true,
        selectedVenueRequestToken: selectedToken, onVenueClose: setCloseToken,
        onHome: () => setSelected(""), onSurfaceClose: () => {},
        onRestore: (entry) => setSelected(entry?.id === "venue" ? "stop" : ""),
      });
      camera = useMapCamera({ ...refs, latestRequestToken: Math.max(selectedToken, request, closeToken) });
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: refs.gestureCameraRef, fitRoute: camera.fitRoute });
      return null;
    }
    act(() => root.render(createElement(Journey)));
    act(() => navigation.open({ id: "venue", title: "Stop",
      state: { ...EMPTY_MAP_SURFACE_STATE, venueId: "stop" } }));
    request = nextCameraRequestToken();
    act(() => root.render(createElement(Journey)));
    act(() => {
      if (action === "nearby") camera.fitNearby({ lat: 51.52, lng: -0.12 }, soho, "user", request);
      else if (action === "search") camera.fitQueryVenues("search-recovery", request);
      else camera.cinematic({ center: [-0.12, 51.52], zoom: 14 }, "area", "user", request);
    });
    await act(async () => {
      const landed = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
      navigation.home();
      await landed;
    });
    act(() => { pendingFrame?.(performance.now()); pendingFrame = undefined; });
    if (action === "search") {
      expect(fitBounds).toHaveBeenCalledOnce();
      expect((fitBounds.mock.calls[0]![0] as LngLatBounds).toArray())
        .toEqual([[-0.139, 51.514], [-0.139, 51.514]]);
    } else {
      expect(fitBounds).not.toHaveBeenCalled();
      expect(easeTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ center: [-0.12, 51.52] }));
    }
  });

  // Near me owns the latest deliberate request even if geolocation resolves
  // after navigation. A close signal must not invalidate that pending request.
  it.each([false, true])("honours delayed Near me when a venue closes, mapped walk: %s", async (mapped) => {
    let resolveLocation!: PositionCallback;
    vi.stubGlobal("navigator", { geolocation: {
      getCurrentPosition: (success: PositionCallback) => { resolveLocation = success; },
      watchPosition: vi.fn(),
    } });
    let navigation!: ReturnType<typeof useMapSurfaceNavigation>;
    let runNearMe!: ReturnType<typeof useNearMeRequests>["runNearMe"];
    const selectedToken = nextCameraRequestToken();
    const location = vi.fn();
    const nearbyToken = vi.fn();
    window.history.replaceState(null, "", "/map");
    function Journey() {
      const [closeToken, setCloseToken] = useState(0);
      navigation = useMapSurfaceNavigation({
        arrivalSearch: "", surfaceId: "none", surfaceTitle: "",
        surfaceState: EMPTY_MAP_SURFACE_STATE, selectionHint: "",
        mappedRouteActive: mapped,
        selectedVenueRequestToken: selectedToken,
        onRestore: () => {}, onHome: () => {}, onSurfaceClose: () => {},
        onVenueClose: setCloseToken,
      });
      ({ runNearMe } = useNearMeRequests({
        cityId: "london", stopCount: 2, invalidatePrivateCamera: () => {},
        setNearbyError: () => {}, setNearbyLoading: () => {}, setUserLocation: location,
        setNearbyRequestToken: nearbyToken, setPendingNearMeRequest: () => {},
        openChooseAreaRef: { current: () => {} },
      }));
      return createElement("output", null, closeToken);
    }
    act(() => root.render(createElement(Journey)));
    act(() => navigation.open({ id: "venue", title: "Stop",
      state: { ...EMPTY_MAP_SURFACE_STATE, venueId: "b" } }));
    act(() => runNearMe("tap"));
    const request = currentCameraRequestToken();
    await act(async () => {
      const landed = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
      navigation.home();
      await landed;
    });
    expect(host.textContent).toBe(String(mapped ? selectedToken : 0));
    expect(currentCameraRequestToken()).toBe(request);
    act(() => resolveLocation({ coords: { latitude: 51.52, longitude: -0.12 } } as GeolocationPosition));
    expect(location).toHaveBeenCalledExactlyOnceWith({ lat: 51.52, lng: -0.12 });
    expect(nearbyToken).toHaveBeenCalledExactlyOnceWith(request);
  });

  // The close contract preserves reader movement across separate React commits.
  // An automatic fit after the late signal would overwrite that movement.
  it.each([false, true])("preserves movement when selection clears before the close signal: %s", (moved) => {
    const fitRoute = vi.fn();
    const gesture = { current: { active: false, endedAt: null, movementSerial: 0 } };
    let selected = "stop";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: gesture, fitRoute });
      return null;
    }
    act(() => root.render(createElement(Camera)));
    fitRoute.mockClear();
    if (moved) gesture.current.movementSerial += 1;
    selected = "";
    act(() => root.render(createElement(Camera)));
    expect(fitRoute).not.toHaveBeenCalled();
    closeToken = nextCameraRequestToken();
    act(() => root.render(createElement(Camera)));
    if (moved) expect(fitRoute).not.toHaveBeenCalled();
    else expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", closeToken);
  });

  it("honours another explicit route request when an earlier close signal arrives late", () => {
    const fitRoute = vi.fn();
    let selected = "stop";
    const venueToken = nextCameraRequestToken();
    let requestToken = 0;
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        requestToken, closeRequestToken: closeToken, fitRoute });
      return null;
    }
    const render = () => act(() => root.render(createElement(Camera)));
    render();
    selected = "";
    requestToken = nextCameraRequestToken();
    render();
    expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", requestToken);
    fitRoute.mockClear();
    closeToken = venueToken;
    requestToken = nextCameraRequestToken();
    render();
    expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", requestToken);
  });

  it("captures a fresh movement baseline when the same venue opens again", () => {
    const fitRoute = vi.fn();
    const gesture = { current: { active: false, endedAt: null, movementSerial: 0 } };
    let selected = "stop";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: gesture, fitRoute });
      return null;
    }
    const render = () => act(() => root.render(createElement(Camera)));
    render();
    selected = "";
    render();
    gesture.current.movementSerial += 1;
    selected = "stop";
    render();
    selected = "";
    closeToken = nextCameraRequestToken();
    render();
    expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", closeToken);
  });

  it("retains a close signal that arrives before selection clears", () => {
    const fitRoute = vi.fn();
    let selected = "stop";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        closeRequestToken: closeToken, fitRoute });
      return null;
    }
    act(() => root.render(createElement(Camera)));
    closeToken = nextCameraRequestToken();
    act(() => root.render(createElement(Camera)));
    selected = "";
    act(() => root.render(createElement(Camera)));
    expect(fitRoute).toHaveBeenCalledExactlyOnceWith("user", closeToken);
  });

  it("does not claim the camera when there is no walk", () => {
    const fitRoute = vi.fn();
    const gesture = { current: { active: false, endedAt: null as number | null, movementSerial: 0 } };
    let selected = "stop";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: gesture, fitRoute });
      return null;
    }
    act(() => root.render(createElement(Camera)));
    fitRoute.mockClear();
    selected = "";
    closeToken = nextCameraRequestToken();
    act(() => root.render(createElement(Camera)));
    expect(fitRoute).not.toHaveBeenCalled();
  });
  it.each([false, true])("restores the walk unless the reader moved it: %s", (moved) => {
    const fitRoute = vi.fn();
    const gesture = { current: { active: false, endedAt: null as number | null, movementSerial: 0 } };
    let selected = "stop";
    let closeToken = 0;
    function Camera() {
      useRouteCameraFraming({ mapReady: true, routeKey: "a>b", selectedVenueId: selected,
        closeRequestToken: closeToken, gestureCameraRef: gesture, fitRoute });
      return null;
    }
    act(() => root.render(createElement(Camera)));
    fitRoute.mockClear();
    if (moved) gesture.current.movementSerial += 1;
    selected = "";
    closeToken = nextCameraRequestToken();
    act(() => root.render(createElement(Camera)));
    if (moved) expect(fitRoute).not.toHaveBeenCalled();
    else expect(fitRoute).toHaveBeenCalledWith("user", closeToken);
  });
});

it("restores selection as soon as a replacement route source arrives, before worker data", () => {
  const states = new Map<string, { selected: boolean }>();
  const listeners = new Map<string, (event: { sourceId: string }) => void>();
  let sourceReady = true;
  let source = {};
  const map = {
    getSource: () => sourceReady ? source : undefined,
    getFeatureState: ({ id }: { id: string }) => states.get(id) ?? {},
    setFeatureState: ({ id }: { id: string }, state: { selected: boolean }) => states.set(id, state),
    on: (event: string, listener: (event: { sourceId: string }) => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
  } as unknown as MapLibreMap;
  function SelectedStop({ id }: { id: string }) {
    const mapRef = useRef(map);
    useRouteStopSelection(true, mapRef, id);
    return null;
  }
  act(() => root.render(createElement(SelectedStop, { id: "christmas-1" })));
  expect(states.get("christmas-1")?.selected).toBe(true);
  act(() => {
    states.clear();
    sourceReady = false;
    listeners.get("style.load")?.({ sourceId: "route-stops" });
    source = {};
    sourceReady = true;
    listeners.get("styledata")?.({ sourceId: "route-stops" });
  });
  expect(states.get("christmas-1")?.selected).toBe(true);
  act(() => {
    states.clear();
    sourceReady = false;
    listeners.get("styledata")?.({ sourceId: "route-stops" });
    source = {};
    sourceReady = true;
    listeners.get("sourcedata")?.({ sourceId: "route-stops" });
  });
  expect(states.get("christmas-1")?.selected).toBe(true);
  act(() => root.render(createElement(SelectedStop, { id: "christmas-6" })));
  expect(states.get("christmas-1")?.selected).toBe(false);
  expect(states.get("christmas-6")?.selected).toBe(true);
  act(() => root.render(null));
  expect(listeners.size).toBe(0);
});
