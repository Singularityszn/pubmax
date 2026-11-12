// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type * as maplibregl from "maplibre-gl";
import { expect, it, vi } from "vitest";

import BeenHereLayer from "@/components/map/beenHere/BeenHereLayer";

const state = vi.hoisted(() => ({ visited: new Set(["glyph", "pill"]) }));
vi.mock("@/components/map/beenHere/useBeenHere", () => ({
  useBeenHerePostcodesOn: () => false,
  useBeenHereVenueIds: () => state.visited,
}));
vi.mock("@/components/map/beenHere/useLondonBeenHereProgress", () => ({
  useLondonBeenHereProgress: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])("clears marks until idle, with movement at mount: %s", async (movingAtMount) => {
  state.visited = new Set(["glyph", "pill", "selected-glyph", "selected-pill"]);
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setData(data: GeoJSON.FeatureCollection): void }>();
  const layers = new Map<string, { id: string }>([
    ["pubs-point", { id: "pubs-point" }],
    ["pubs-price-pill", { id: "pubs-price-pill" }],
    ["pubs-point-selected", { id: "pubs-point-selected" }],
    ["pubs-price-pill-selected", { id: "pubs-price-pill-selected" }],
  ]);
  const listeners = new Map<string, Set<() => void>>();
  let moving = movingAtMount;
  let rendered = [
    { properties: { id: "glyph" }, layer: { id: "pubs-point" }, geometry: { type: "Point", coordinates: [-0.1, 51.5] } },
    { properties: { id: "pill" }, layer: { id: "pubs-price-pill" }, geometry: { type: "Point", coordinates: [-0.11, 51.51] } },
    { properties: { id: "selected-glyph" }, layer: { id: "pubs-point-selected" }, geometry: { type: "Point", coordinates: [-0.12, 51.52] } },
    { properties: { id: "selected-pill" }, layer: { id: "pubs-price-pill-selected" }, geometry: { type: "Point", coordinates: [-0.13, 51.53] } },
  ];
  const map = {
    isStyleLoaded: () => true,
    isMoving: () => moving,
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayersOrder: () => [...layers.keys()],
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => { layers.set(layer.id, layer); },
    removeLayer: (id: string) => { layers.delete(id); },
    moveLayer: () => {},
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, options: { data: GeoJSON.FeatureCollection }) => {
      sources.set(id, { data: options.data, setData(data) { this.data = data; } });
    },
    removeSource: (id: string) => { sources.delete(id); },
    queryRenderedFeatures: () => rendered,
    on: (event: string, listener: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: () => void) => { listeners.get(event)?.delete(listener); },
  };
  const emit = (event: string) => { for (const listener of listeners.get(event) ?? []) listener(); };
  const marks = () => sources.get("been-here-marks")?.data ?? empty;
  const root = createRoot(document.createElement("div"));
  const render = () => root.render(<BeenHereLayer map={map as unknown as maplibregl.Map} />);
  try {
    await act(async () => { render(); });
    if (movingAtMount) {
      expect(marks().features).toEqual([]);
      moving = false;
      await act(async () => { emit("idle"); });
    }
    expect(marks().features.map((feature) => feature.properties)).toEqual([
      { id: "glyph", pill: false }, { id: "pill", pill: true },
      { id: "selected-glyph", pill: false }, { id: "selected-pill", pill: true },
    ]);
    expect(marks().features.map((feature) => feature.geometry)).toEqual([
      { type: "Point", coordinates: [-0.1, 51.5] },
      { type: "Point", coordinates: [-0.11, 51.51] },
      { type: "Point", coordinates: [-0.12, 51.52] },
      { type: "Point", coordinates: [-0.13, 51.53] },
    ]);
    for (const coordinates of [[-0.2, 51.51], [-0.2, 51.6]]) {
      rendered = rendered.map((feature) => feature.properties.id === "pill"
        ? { ...feature, geometry: { type: "Point", coordinates } }
        : feature);
      await act(async () => { emit("idle"); });
      expect(marks().features.find((feature) => feature.properties?.id === "pill")?.geometry).toEqual({
        type: "Point", coordinates,
      });
    }
    await act(async () => {
      moving = true;
      emit("movestart");
      expect(marks().features).toEqual([]);
    });
    state.visited = new Set(["pill"]);
    await act(async () => { render(); });
    expect(marks().features).toEqual([]);
    await act(async () => { emit("style.load"); });
    expect(marks().features).toEqual([]);
    rendered = [];
    moving = false;
    await act(async () => { emit("idle"); });
    expect(marks().features).toEqual([]);
    moving = true;
    await act(async () => { emit("movestart"); });
    rendered = [{ properties: { id: "pill" }, layer: { id: "pubs-point" }, geometry: { type: "Point", coordinates: [-0.3, 51.7] } }];
    moving = false;
    await act(async () => { emit("idle"); });
    expect(marks().features.map((feature) => feature.properties)).toEqual([{ id: "pill", pill: false }]);
    expect(marks().features[0]?.geometry).toEqual({ type: "Point", coordinates: [-0.3, 51.7] });
    state.visited = new Set();
    await act(async () => { render(); });
    expect(marks().features).toEqual([]);
  } finally {
    await act(async () => { root.unmount(); });
  }
  expect([...listeners.values()].every((entries) => entries.size === 0)).toBe(true);
});
