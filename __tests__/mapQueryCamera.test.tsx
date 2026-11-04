// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map, LngLatBounds } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapCamera } from "@/components/map/canvas/useMapCamera";
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
  vi.unstubAllGlobals();
});

function mount(queryVenuesRef: { current: Venue[] }, route: Venue[] = [], gesture = { active: false, endedAt: null as number | null },
  routeLineRef: { current: GeoJSON.FeatureCollection } = { current: { type: "FeatureCollection", features: [] } }) {
  function Camera() {
    camera = useMapCamera({
      mapRef: { current: {
        stop: vi.fn(), fitBounds, getBearing: () => -8,
        getContainer: () => ({ clientWidth: 1280, clientHeight: 900, getBoundingClientRect: () => ({ top: 0 }) }),
      } as unknown as Map },
      reducedRef: { current: true },
      cityViewRef: { current: { center: [-0.13, 51.51], zoom: 12, pitch: 40, bearing: -8 } },
      cityBoundsRef: { current: [[-0.3, 51.4], [0.1, 51.7]] },
      routeRef: { current: route },
      routeLineRef,
      venuesRef: { current: surrounding },
      queryVenuesRef,
      gestureCameraRef: { current: gesture },
    });
    return null;
  }
  act(() => root.render(createElement(Camera)));
}

function fitQuery() {
  act(() => {
    camera.fitQueryVenues();
    pendingFrame?.(performance.now());
    pendingFrame = undefined;
  });
}

describe("query camera with contextual price pins", () => {
  it("fits road detours beyond the stops and reads the latest road during recovery", () => {
    const line = (geometry: GeoJSON.Geometry): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }],
    });
    const routeLineRef = { current: line({ type: "LineString", coordinates: [] }) };
    mount({ current: [] }, soho, { active: false, endedAt: null }, routeLineRef);
    const fit = (kind: "route" | "route-recovery" = "route") => act(() => {
      camera.fitRoute(kind);
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
    fit("route-recovery");
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
    act(() => { camera.fitRoute("route-recovery"); pendingFrame?.(performance.now()); });
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
      camera.fitRoute("route-recovery");
      pendingFrame?.(performance.now());
      pendingFrame = undefined;
    });
    expect(fitBounds).toHaveBeenCalledOnce();
    act(() => {
      camera.fitRoute("route-recovery");
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
