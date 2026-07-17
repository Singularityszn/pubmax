import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPois,
  buildTransitLines,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import { poisToGeoJSON } from "@/components/map/canvas/geojson";
import { defaultPoiHiddenMobile } from "@/lib/poiToggleGroups";
import type { Poi } from "@/lib/pois";

const londonPois = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/london_pois.json"), "utf8"),
) as Poi[];

function sceneHarness(transitNetworkVisible: boolean) {
  const layers: Array<Record<string, unknown>> = [];
  const sources = new Map<string, unknown>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => sources.set(id, source),
  };
  const ctx = {
    map,
    tokens: {
      ink: "#111111",
      inkDeep: "#000000",
      paper: "#ffffff",
      muted: "#777777",
    },
    dark: false,
    textFont: ["Noto Sans Bold"],
    addLayerOnce: (layer: Record<string, unknown>) => layers.push(layer),
    poiHidden: defaultPoiHiddenMobile(),
    transitNetworkVisible,
    transitLinesPath: "/data/tfl_lines.json",
    poisData: poisToGeoJSON(londonPois),
  } as unknown as SceneCtx;
  return { ctx, layers, sources };
}

describe("mobile transport scene", () => {
  it("builds zoom-gated Tube and Rail station layers from the mobile defaults", () => {
    const { ctx, layers, sources } = sceneHarness(false);
    buildPois(ctx);

    expect(sources.has("pois")).toBe(true);
    const source = sources.get("pois") as { data: GeoJSON.FeatureCollection };
    const stations = source.data.features.filter((feature) => {
      const category = feature.properties?.category;
      return category === "tube" || category === "rail";
    });
    expect(stations.filter((feature) => feature.properties?.category === "tube").length).toBeGreaterThan(0);
    expect(stations.filter((feature) => feature.properties?.category === "rail").length).toBeGreaterThan(0);
    const major = layers.find((layer) => layer.id === "pois-transport-major");
    const minor = layers.find((layer) => layer.id === "pois-transport-minor");
    const labels = layers.find((layer) => layer.id === "pois-transport-label");
    expect(major?.minzoom).toBe(9.5);
    expect(minor?.minzoom).toBe(12.4);
    expect(labels?.minzoom).toBe(13);
    for (const layer of [major, minor, labels]) {
      const filter = JSON.stringify(layer?.filter);
      expect(filter).toContain("tube");
      expect(filter).toContain("rail");
    }
  });

  it("keeps the coloured network optional while station symbols remain visible", () => {
    const mobile = sceneHarness(false);
    buildTransitLines(mobile.ctx);
    expect(mobile.layers.filter((layer) => String(layer.id).startsWith("tube-lines-")))
      .toHaveLength(3);
    for (const layer of mobile.layers) {
      expect((layer.layout as { visibility?: string }).visibility).toBe("none");
    }

    const desktop = sceneHarness(true);
    buildTransitLines(desktop.ctx);
    for (const layer of desktop.layers) {
      expect((layer.layout as { visibility?: string }).visibility).toBe("visible");
    }
  });
});
