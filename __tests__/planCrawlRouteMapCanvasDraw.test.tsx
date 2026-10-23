/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  line: { setData: vi.fn() },
  stops: { setData: vi.fn() },
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    on() {}
    once() {}
    loaded() { return true; }
    getSource(id: string) { return id === "route-line" ? sources.line : id === "route-stops" ? sources.stops : undefined; }
    fitBounds() {}
    setStyle() {}
    remove() {}
  }
  class LngLatBounds {}
  return { Map: FakeMap, LngLatBounds, setWorkerUrl: () => undefined };
});
vi.mock("@/components/map/canvas/planRoutePreviewScene", () => ({
  syncPlanRoutePreviewScene: (_map: unknown, line: unknown, stops: unknown) => {
    sources.line.setData(line);
    sources.stops.setData(stops);
  },
}));

import PlanCrawlRouteMapCanvas from "@/components/map/canvas/PlanCrawlRouteMapCanvas";

const LINE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-0.14, 51.51], [-0.13, 51.52]] } }],
};
const STOPS: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const COORDS: [number, number][] = [[-0.14, 51.51], [-0.13, 51.52]];

let host: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];
let reduce = false;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  reduce = false;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") ? reduce : false, media: query }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  sources.line.setData.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (drawKey: string) => act(async () => {
  root.render(
    <PlanCrawlRouteMapCanvas drawKey={drawKey} stopCoords={COORDS} routeLine={LINE} routeStops={STOPS} lineCoords={COORDS} />,
  );
});

/** Whether a draw began: it takes the line back to nothing before its first frame. */
const drawBegan = () => sources.line.setData.mock.calls.some(([data]) => (
  (data as GeoJSON.FeatureCollection).features.length === 0
  || JSON.stringify(data) !== JSON.stringify(LINE)
));

describe("PlanCrawlRouteMapCanvas draw", () => {
  it("draws a new ordered route that arrives on the same map, once", async () => {
    await render("draw-a>b>c");
    expect(drawBegan()).toBe(true);
    sources.line.setData.mockClear();

    await render("draw-c>a>b");
    expect(drawBegan()).toBe(true);
    sources.line.setData.mockClear();

    await render("draw-a>b>c");
    expect(sources.line.setData).not.toHaveBeenCalled();
  });

  it("does not draw for reduced motion", async () => {
    await render("reduced-a>b");
    sources.line.setData.mockClear();
    reduce = true;
    await render("reduced-b>a");
    expect(sources.line.setData).not.toHaveBeenCalled();
  });
});
