// @vitest-environment jsdom

import { act, createElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map, LngLatBounds } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { palCameraDefaults, useMapCamera, useNearbyCameraFraming, useRouteCameraFraming } from "@/components/map/canvas/useMapCamera";
import { useMapPlanCoordinator, useMapPlanPresentation } from "@/components/map/pubmap/useMapPlanCoordinator";
import { useMapOpeningCamera } from "@/components/map/useMapOpeningCamera";
import { useMapFocusPoint } from "@/components/map/canvas/useMapFocusPoint";
import { wireClickRouting } from "@/components/map/canvas/interactions";
import { PIN_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { nextCameraRequestToken } from "@/lib/cameraIntent";
import { nextAreaCameraFocus, type MapCameraFocus } from "@/lib/mapCameraFocus";
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
const fitBounds = vi.fn();
const easeTo = vi.fn();

describe("Pal camera defaults", () => {
  it("starts without a nearby request and retains explicit request tokens", () => {
    expect(palCameraDefaults({})).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: undefined })).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: 0 })).toEqual({ nearbyRequestToken: 0 });
    expect(palCameraDefaults({ nearbyRequestToken: 3 })).toEqual({ nearbyRequestToken: 3 });
  });
});

beforeEach(() => {
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
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function mount(queryVenuesRef: { current: Venue[] }, route: Venue[] = [], gesture = { active: false, endedAt: null as number | null },
  routeLineRef: { current: GeoJSON.FeatureCollection } = { current: { type: "FeatureCollection", features: [] } },
  nearbyRequest = { current: 0 }, nearby = false,
  planRef?: { current: ReturnType<typeof useMapPlanCoordinator> | null },
  opening = { resolved: false, area: null as MapCameraFocus | null },
  readiness = { current: true }, canvasMounted = { current: true }, searchRecovery = { current: 0 }, selectedVenue = { current: "" },
  search = { current: "" }, planData: { venues: Venue[]; activePlanRoute: Venue[] } = { venues: route, activePlanRoute: [] }) {
  function Canvas({ plan }: { plan: ReturnType<typeof useMapPlanCoordinator> }) {
    const presentation = useMapPlanPresentation({
      mode: plan.mode, builtIds: plan.builtIds, routeMapped: plan.routeMapped,
      suggestedRoute: [], activePlanRoute: planData.activePlanRoute, venueById: new Map(planData.venues.map((venue) => [venue.id, venue])),
    });
    const currentRoute = planRef ? presentation.routeForMap : route;
    camera = useMapCamera({
      latestRequestToken: Math.max(planRef ? plan.routeRequestToken : 0, nearbyRequest.current,
        searchRecovery.current, opening.area?.token ?? 0),
      mapRef: { current: {
        stop: vi.fn(), fitBounds, easeTo, getBearing: () => -8,
        getContainer: () => ({ clientWidth: 1280, clientHeight: 900,
          getBoundingClientRect: () => ({ top: 0, width: 1280, height: 900 }) }),
      } as unknown as Map },
      reducedRef: { current: true },
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
      } as unknown as Map, {
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

  it.each(["one stop", "clear", "hide"] as const)("releases Pal ownership after route %s with the inspector open", (change) => {
    const planRef: { current: ReturnType<typeof useMapPlanCoordinator> | null } = { current: null };
    mount({ current: soho }, soho, undefined, undefined, undefined, false, planRef,
      undefined, undefined, undefined, undefined, { current: soho[0]!.id });
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
