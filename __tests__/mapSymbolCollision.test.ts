import type maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  buildLandmarks,
  buildPois,
  buildPubs,
  CLUSTER_COLLISION_PADDING,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  LANDMARK_ICON_PRIORITY_ZOOM,
  PIN_MIN_ZOOM,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import { clusterEntranceProgress, pinSortKeyExpr } from "@/components/map/canvas/filters";
import { landmarksToGeoJSON } from "@/components/map/canvas/geojson";
import type { Landmark } from "@/lib/landmarks";
import type { Tokens } from "@/components/map/canvas/tokens";

// The mobile map's density contract (owner report: "as you load the map all the
// places are so grouped together … you can see they are so close and it's so
// janky"). Every rule below is one that, when broken, puts two symbols on top of
// each other on a 390px-wide phone, so they are asserted on the built scene
// rather than left to a screenshot review.

type BuiltLayer = maplibregl.AddLayerObject & {
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};

function buildScenePieces(selectedId = "") {
  const layers = new Map<string, BuiltLayer>();
  const sources = new Map<string, Record<string, unknown>>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: Record<string, unknown>) => sources.set(id, spec),
    getLayer: (id: string) => layers.get(id),
    setPaintProperty: () => {},
    setLayoutProperty: () => {},
  } as unknown as maplibregl.Map;

  const ctx = {
    map,
    tokens: new Proxy({}, { get: () => "#000000" }) as unknown as Tokens,
    dark: false,
    textFont: ["Noto Sans Regular"],
    addLayerOnce: ((layer: BuiltLayer) => layers.set(layer.id, layer)) as SceneCtx["addLayerOnce"],
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
    tonightData: { type: "FeatureCollection", features: [] },
    tonightVisible: false,
    selectedId,
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;

  buildLandmarks(ctx);
  buildPois(ctx);
  buildPubs(ctx);
  return { layers, sources };
}

describe("pub clustering density (scales to a UK-wide source)", () => {
  const { sources } = buildScenePieces();
  const pubs = sources.get("pubs")!;

  it("clusters the pubs source up to CLUSTER_MAX_ZOOM at the mobile radius", () => {
    expect(pubs.cluster).toBe(true);
    expect(pubs.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
    expect(pubs.clusterRadius).toBe(CLUSTER_RADIUS_PX);
  });

  it("keeps a mixed band where dense pockets stay clustered and roomy pubs are pins", () => {
    // Pins may appear from PIN_MIN_ZOOM while the source still clusters, which
    // is exactly what stops a dense street from unclustering into a pile.
    expect(PIN_MIN_ZOOM).toBeLessThanOrEqual(CLUSTER_MAX_ZOOM);
  });

  it("stops clustering below every camera zoom that targets one venue", () => {
    // Venue selection flies to max(zoom, 14) and the landmark inspector to 15;
    // a selected pub must always be a real pin, never swallowed by a cluster.
    expect(CLUSTER_MAX_ZOOM).toBeLessThan(14);
  });

  it("groups wider than the widest cluster disc so two discs cannot touch", () => {
    // `clusters` circle-radius tops out at 16px (+ stroke) — a grouping radius
    // under that diameter would let neighbouring discs overlap.
    expect(CLUSTER_RADIUS_PX).toBeGreaterThan(2 * 16);
  });
});

describe("symbol collision policy", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("drops crowded pub pins instead of stacking them", () => {
    const pins = layout("pubs-point");
    expect(pins["icon-allow-overlap"]).toBe(false);
    expect(pins["icon-ignore-placement"]).toBe(false);
    // Padding has to clear the widest halo ring a pin wears (radius ≤ 15px at
    // z15 on the scraped / drops / what's-on layers).
    expect(pins["icon-padding"]).toBeGreaterThanOrEqual(4);
    expect(pins["symbol-sort-key"]).toEqual(pinSortKeyExpr(""));
  });

  it("allows only the selected pub pin to overlap competing symbols", () => {
    const selectedLayers = buildScenePieces("venue-abc").layers;
    const pins = (selectedLayers.get("pubs-point")?.layout ?? {}) as Record<string, unknown>;

    expect(pins["icon-allow-overlap"]).toEqual([
      "case",
      ["==", ["get", "id"], "venue-abc"],
      true,
      false,
    ]);
  });

  it("keeps the cluster count drawn while still reserving the disc's space", () => {
    const count = layout("cluster-count");
    // A numberless disc would be worse than a tight fit…
    expect(count["text-allow-overlap"]).toBe(true);
    // …but a circle layer contributes nothing to the collision index, so the
    // count's padded box is what keeps other labels off the disc.
    expect(count["text-ignore-placement"]).toBe(false);
    expect(count["text-padding"]).toBe(CLUSTER_COLLISION_PADDING);
  });

  it("drops crowded landmark names rather than overprinting them", () => {
    const landmark = layout("landmarks-icon");
    expect(landmark["text-allow-overlap"]).toBe(false);
    expect(landmark["text-ignore-placement"]).toBe(false);
    // The icon survives when only the name has to go.
    expect(landmark["text-optional"]).toBe(true);
  });

  it("lets landmark icons yield below the inspector band and win at/above it", () => {
    const landmark = layout("landmarks-icon");
    expect(landmark["icon-allow-overlap"]).toEqual([
      "step",
      ["zoom"],
      false,
      LANDMARK_ICON_PRIORITY_ZOOM,
      true,
    ]);
    // Never invisible to placement — that flag is what let one pictogram
    // bulldoze every neighbouring label into a pile.
    expect(landmark["icon-ignore-placement"]).toBe(false);
  });

  it("collides transport roundels too", () => {
    expect(layout("pois-transport-major")["icon-allow-overlap"]).toBe(false);
    expect(layout("pois-transport-minor")["icon-allow-overlap"]).toBe(false);
  });

  it("leaves no app symbol layer invisible to the collision index", () => {
    for (const [id, layer] of layers) {
      if (layer.type !== "symbol") continue;
      const props = (layer.layout ?? {}) as Record<string, unknown>;
      expect(
        { id, icon: props["icon-ignore-placement"] ?? false },
        `${id} must not ignore placement`,
      ).toEqual({ id, icon: false });
      expect(
        { id, text: props["text-ignore-placement"] ?? false },
        `${id} must not ignore placement`,
      ).toEqual({ id, text: false });
    }
  });
});

describe("pinSortKeyExpr (placement priority when pins compete)", () => {
  it("puts the selected pin at the front of the queue", () => {
    const expr = pinSortKeyExpr("venue-abc") as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["==", ["get", "id"], "venue-abc"]);
    expect(expr[2]).toBe(0);
  });

  it("ranks story pins ahead of priced pins ahead of the rest", () => {
    expect(pinSortKeyExpr("")).toEqual([
      "case",
      ["get", "story"],
      1,
      ["<", ["coalesce", ["get", "bucket"], 3], 3],
      2,
      3,
    ]);
  });
});

describe("clusterEntranceProgress (load-in fade)", () => {
  it("starts at 0 and settles at exactly 1", () => {
    expect(clusterEntranceProgress(0, 400)).toBe(0);
    expect(clusterEntranceProgress(400, 400)).toBe(1);
    expect(clusterEntranceProgress(4000, 400)).toBe(1);
  });

  it("never leaves the 0..1 range for a negative or zero-length window", () => {
    expect(clusterEntranceProgress(-50, 400)).toBe(0);
    expect(clusterEntranceProgress(10, 0)).toBe(1);
  });

  it("eases out — most of the fade lands in the first half", () => {
    expect(clusterEntranceProgress(200, 400)).toBeGreaterThan(0.5);
    expect(clusterEntranceProgress(200, 400)).toBeLessThan(1);
  });
});

describe("landmarksToGeoJSON priority", () => {
  it("stamps curation order onto every feature as the collision sort key", () => {
    const catalog = [
      { id: "a", name: "A", coordinates: [0, 0], icon: "x" },
      { id: "b", name: "B", coordinates: [1, 1], icon: "y" },
    ] as unknown as readonly Landmark[];
    const collection = landmarksToGeoJSON(catalog);
    expect(collection.features.map((feature) => feature.properties?.priority)).toEqual([0, 1]);
  });
});
