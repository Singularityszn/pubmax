// @vitest-environment jsdom

import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { syncPlanRoutePreviewScene } from "@/components/map/canvas/planRoutePreviewScene";

type FakeLayer = {
  id: string;
  type: string;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
};

/** Just enough of maplibregl.Map for the preview scene: a layer stack with
 *  paint/layout state and GeoJSON sources that remember their last data. */
function fakeMap(basemap: FakeLayer[]) {
  const layers: FakeLayer[] = basemap.map((layer) => ({ ...layer }));
  const sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
  const find = (id: string) => layers.find((layer) => layer.id === id);
  const map = {
    getStyle: () => ({ layers: layers.map(({ id, type }) => ({ id, type })) }),
    getLayer: (id: string) => find(id),
    addLayer: (spec: { id: string; type: string; paint?: object; layout?: object }, before?: string) => {
      const layer = {
        id: spec.id,
        type: spec.type,
        paint: { ...(spec.paint ?? {}) },
        layout: { ...(spec.layout ?? {}) },
      };
      const at = before ? layers.findIndex((entry) => entry.id === before) : -1;
      if (at >= 0) layers.splice(at, 0, layer);
      else layers.push(layer);
    },
    moveLayer: (id: string, before?: string) => {
      const layer = find(id);
      if (!layer) return;
      layers.splice(layers.indexOf(layer), 1);
      const at = before ? layers.findIndex((entry) => entry.id === before) : -1;
      if (at >= 0) layers.splice(at, 0, layer);
      else layers.push(layer);
    },
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: { data?: unknown }) => {
      const source = {
        data: spec.data,
        setData(data: unknown) {
          source.data = data;
        },
      };
      sources.set(id, source);
    },
    getPaintProperty: (id: string, name: string) => find(id)?.paint[name],
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = find(id);
      if (layer) layer.paint[name] = value;
    },
    getLayoutProperty: (id: string, name: string) => find(id)?.layout[name],
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const layer = find(id);
      if (layer) layer.layout[name] = value;
    },
    setLayerZoomRange: () => {},
    setFilter: () => {},
  };
  const order = () => layers.map((layer) => layer.id);
  return { map: map as unknown as maplibregl.Map, find, sources, order };
}

function lineFC(coordinates: number[][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }],
  };
}

const STOPS: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { n: 1, name: "First pub", labelSide: "east" },
      geometry: { type: "Point", coordinates: [-0.14, 51.51] },
    },
    {
      type: "Feature",
      properties: { n: 2, name: "Second pub", labelSide: "west" },
      geometry: { type: "Point", coordinates: [-0.13, 51.52] },
    },
  ],
};

describe("syncPlanRoutePreviewScene", () => {
  // QA journeys F23. buildRouteStops owns this for the full map and the card:
  // the discs are a circle layer and take no part in collision, so the number
  // claims its disc and is placed (top layer first) before the names.
  it("seats the stop numbers before the names, each claiming its whole disc", () => {
    const { map, find, order } = fakeMap([{ id: "place_other", type: "symbol", paint: {}, layout: {} }]);
    syncPlanRoutePreviewScene(map, lineFC([[-0.14, 51.51], [-0.13, 51.52]]), STOPS);

    const ids = order();
    expect(ids.indexOf("route-stops")).toBeLessThan(ids.indexOf("route-stops-name"));
    expect(ids.indexOf("route-stops-name")).toBeLessThan(ids.indexOf("route-stops-label"));
    expect(find("route-stops-label")?.layout["text-padding"]).toBe(9);
    expect(find("route-stops-label")?.layout["text-allow-overlap"]).toBe(true);
    expect(find("route-stops-name")?.layout["text-allow-overlap"]).toBeUndefined();
  });

  it("keeps the stop numbers' and names' own styling when a routed line arrives later", () => {
    const { map, find, sources } = fakeMap([{ id: "place_other", type: "symbol", paint: {}, layout: {} }]);
    const straight = lineFC([
      [-0.14, 51.51],
      [-0.13, 51.52],
    ]);
    const routed = lineFC([
      [-0.14, 51.51],
      [-0.138, 51.516],
      [-0.13, 51.52],
    ]);

    syncPlanRoutePreviewScene(map, straight, STOPS);
    const nameColor = find("route-stops-name")?.paint["text-color"];
    const numberColor = find("route-stops-label")?.paint["text-color"];
    const numberHalo = find("route-stops-label")?.paint["text-halo-color"];
    expect(nameColor).toBeDefined();
    expect(numberColor).toBeDefined();

    syncPlanRoutePreviewScene(map, routed, STOPS);

    expect(sources.get("route-line")?.data).toEqual(routed);
    expect(find("route-stops-name")?.paint["text-color"]).toEqual(nameColor);
    expect(find("route-stops-label")?.paint["text-color"]).toEqual(numberColor);
    expect(find("route-stops-label")?.paint["text-halo-color"]).toEqual(numberHalo);
  });
});
