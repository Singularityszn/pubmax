import { readFileSync } from "node:fs";
import path from "node:path";

import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { buildUkBase, type SceneCtx } from "@/components/map/canvas/buildScene";
import { OSM_ATTRIBUTION, type Tokens } from "@/components/map/canvas/tokens";

// ODbL attribution for OUR pub data (F8). A large share of the venues we draw
// are OSM-derived - the curated index's outer-London OSM venues today, the whole
// UK base layer as it rolls out - and the OSMF attribution guidelines expect a
// browsable map to credit the contributors in the map corner, not only on an
// About page. This file pins that the credit is wired to the MAP rather than to
// one optional source, because a source-only credit vanishes in every city that
// does not load that source.

const REPO = path.join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO, relative), "utf8");
}

describe("OpenStreetMap attribution", () => {
  it("names OpenStreetMap contributors and the licence", () => {
    expect(OSM_ATTRIBUTION).toContain("OpenStreetMap contributors");
    expect(OSM_ATTRIBUTION).toContain("ODbL");
    expect(OSM_ATTRIBUTION).toContain("©");
  });

  it("passes the credit to the map itself, so it survives every style and city", () => {
    // Asserted on the constructor call rather than a live map: MapLibre needs a
    // WebGL context, which vitest's node environment has not got. What matters
    // is that `customAttribution` is set at construction - the corner control
    // is then MapLibre's own, and a style swap (theme toggle, fallback style)
    // cannot drop a map-level attribution the way it drops a style-level one.
    const canvas = read("components/PubMapCanvas.tsx");
    expect(canvas).toMatch(
      /attributionControl:\s*\{\s*compact:\s*true,\s*customAttribution:\s*OSM_ATTRIBUTION,\s*\}/,
    );
  });

  it("ships the ODbL header on the UK base manifest itself, with the fetch day", () => {
    // The gazetteer and places.json headers are fenced elsewhere; the base
    // layer's own header is the manifest every shard reader opens first, so
    // the licence and the fetch day ride it rather than the hand-written
    // README alone. scripts/validate-data.mjs holds the same line in CI.
    const manifest = JSON.parse(read("public/data/uk_base/manifest.json")) as {
      license?: unknown;
      attribution?: unknown;
      generatedFrom?: { fetchedAt?: unknown };
    };
    expect(manifest.license).toBe("ODbL 1.0");
    expect(manifest.attribution).toBe("© OpenStreetMap contributors");
    expect(typeof manifest.generatedFrom?.fetchedAt).toBe("string");
    expect(manifest.generatedFrom?.fetchedAt).not.toBe("");
  });

  it("also credits the wholly-OSM UK base source on the source itself", () => {
    const sources = new Map<string, Record<string, unknown>>();
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, spec: Record<string, unknown>) => sources.set(id, spec),
      getLayer: () => undefined,
      setPaintProperty: () => {},
      setLayoutProperty: () => {},
    } as unknown as maplibregl.Map;

    buildUkBase({
      map,
      tokens: new Proxy({}, { get: () => "#000000" }) as unknown as Tokens,
      dark: false,
      textFont: ["Noto Sans Regular"],
      addLayerOnce: (() => {}) as SceneCtx["addLayerOnce"],
      poiHidden: {} as SceneCtx["poiHidden"],
      transitLinesPath: null,
      showLandmarks: true,
      landmarksGeoJSON: { type: "FeatureCollection", features: [] },
      poisData: { type: "FeatureCollection", features: [] },
      routeLine: { type: "FeatureCollection", features: [] },
      routeStops: { type: "FeatureCollection", features: [] },
      bandCorridor: { type: "FeatureCollection", features: [] },
      bandColor: "#000000",
      bandMemberIds: [],
      pubsData: { type: "FeatureCollection", features: [] },
      userLocationData: { type: "FeatureCollection", features: [] },
      ukBaseData: { type: "FeatureCollection", features: [] },
      tonightData: { type: "FeatureCollection", features: [] },
      tonightVisible: false,
      selectedId: "",
      selectionMuteStore: new Map<string, unknown>(),
    } satisfies SceneCtx);

    expect(sources.get("uk-base")?.attribution).toBe(OSM_ATTRIBUTION);
  });
});
