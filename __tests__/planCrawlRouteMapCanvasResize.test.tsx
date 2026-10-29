/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  phone: false,
  ready: true,
  events: new Map<string, Set<() => void>>(),
  fit: vi.fn(), removed: vi.fn(), scene: vi.fn(),
  line: { setData: vi.fn() },
}));
const emit = (event: string) => state.events.get(event)?.forEach(callback => callback());

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    on(event: string, callback: () => void) {
      if (!state.events.has(event)) state.events.set(event, new Set());
      state.events.get(event)!.add(callback);
    }
    off(event: string, callback: () => void) { state.events.get(event)?.delete(callback); }
    once(event: string, callback: () => void) {
      const once = () => { this.off(event, once); callback(); };
      this.on(event, once);
    }
    loaded() { return state.ready; }
    getSource() { return state.ready ? state.line : undefined; }
    fitBounds(bounds: unknown, options: unknown) { state.fit(bounds, options); }
    setStyle() { state.ready = false; }
    remove() { state.removed(); }
  }
  class LngLatBounds {
    constructor(public southWest: number[], public northEast: number[]) {}
  }
  return { Map: FakeMap, LngLatBounds, setWorkerUrl: vi.fn() };
});
vi.mock("@/components/map/canvas/webgl", () => ({
  mapPixelRatio: () => 1,
  followMapPixelRatio: () => () => {},
}));
vi.mock("@/components/map/canvas/planRoutePreviewScene", () => ({ syncPlanRoutePreviewScene: state.scene }));

import PlanCrawlRouteMapCanvas from "@/components/map/canvas/PlanCrawlRouteMapCanvas";

const STOPS: [number, number][] = [[-0.14, 51.51], [-0.135, 51.515], [-0.13, 51.52]];
const DETOUR: [number, number][] = [[-0.18, 51.49], ...STOPS, [-0.11, 51.54]];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.phone = false; state.ready = true; state.events.clear();
  for (const mock of [state.fit, state.removed, state.scene]) mock.mockClear();
  document.documentElement.dataset.theme = "light";
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") || state.phone, media: query }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host.remove(); vi.unstubAllGlobals();
});
async function render(lineCoords = STOPS) {
  await act(async () => root?.render(<PlanCrawlRouteMapCanvas drawKey="resize-proof" stopCoords={STOPS} routeLine={EMPTY} routeStops={EMPTY} lineCoords={lineCoords} />));
}

describe("static route preview resizing", () => {
  it("refits the same mounted route with phone padding when the map resizes", async () => {
    await render();
    state.fit.mockClear(); state.scene.mockClear(); state.phone = true;
    await act(async () => emit("resize"));
    expect(state.fit).toHaveBeenCalledWith(
      { southWest: [-0.14, 51.51], northEast: [-0.13, 51.52] },
      expect.objectContaining({ padding: { top: 36, right: 28, bottom: 36, left: 28 }, maxZoom: 18, bearing: 0, pitch: 0 }),
    );
    expect(state.scene).not.toHaveBeenCalled();
  });

  it("frames the current detour on a container resize event, not initial stops", async () => {
    await render(); await render(DETOUR); state.fit.mockClear();
    await act(async () => emit("resize"));
    expect(state.fit).toHaveBeenCalledWith(
      { southWest: [-0.18, 51.49], northEast: [-0.11, 51.54] },
      expect.objectContaining({ padding: 52 }),
    );
  });

  it("waits for a replacement style to restore the route before fitting again", async () => {
    await render(DETOUR);
    await act(async () => { document.documentElement.dataset.theme = "dark"; });
    state.fit.mockClear();
    await act(async () => emit("resize"));
    expect(state.fit).not.toHaveBeenCalled();
    state.ready = true;
    await act(async () => emit("style.load"));
    expect(state.fit).toHaveBeenCalledWith(
      { southWest: [-0.18, 51.49], northEast: [-0.11, 51.54] }, expect.anything(),
    );
  });

  it("removes the resize listener on unmount", async () => {
    await render();
    expect(state.events.get("resize")?.size).toBe(1);
    await act(async () => root?.unmount()); root = null;
    state.fit.mockClear(); emit("resize");
    expect(state.fit).not.toHaveBeenCalled();
    expect(state.events.get("resize")?.size ?? 0).toBe(0);
    expect(state.removed).toHaveBeenCalledOnce();
  });
});
