import type maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  buildLandmarks,
  buildPois,
  buildPubs,
  buildUkBase,
  CLUSTER_COLLISION_PADDING,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  LANDMARK_ICON_PRIORITY_ZOOM,
  PIN_HALO_ENVELOPE_PX,
  PIN_MIN_ZOOM,
  PROVISIONAL_BADGE_OFFSET_PX,
  PROVISIONAL_BADGE_RADIUS_MAX_PX,
  UK_BASE_ICON_OPACITY,
  UK_BASE_ICON_SIZE_EXPR,
  UK_BASE_MIN_ZOOM,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import {
  clusterEntranceProgress,
  pinSortKeyExpr,
  PIN_ICON_SIZE_EXPR,
  pubIconOpacityExpr,
  selectedPinFilter,
} from "@/components/map/canvas/filters";
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
  filter?: unknown;
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
    ukBaseData: { type: "FeatureCollection", features: [] },
    tonightData: { type: "FeatureCollection", features: [] },
    tonightVisible: false,
    selectedId,
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;

  buildLandmarks(ctx);
  buildPois(ctx);
  buildUkBase(ctx);
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

describe("UK base layer (unpriced, visually subordinate, never clustered)", () => {
  const { layers, sources } = buildScenePieces();
  const base = sources.get("uk-base")!;
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("is its own source and is NOT clustered", () => {
    // Clustering base pubs into the curated `pubs` source would inflate every
    // London cluster count and grey out its donut — the curated overview below
    // the pin floor has to stay exactly what it was.
    expect(base.type).toBe("geojson");
    expect(base.cluster).toBeUndefined();
    expect(sources.get("pubs")!.cluster).toBe(true);
  });

  it("only appears from the pin floor, so the overview never carries it", () => {
    expect((layers.get("uk-base-point") as { minzoom?: number }).minzoom).toBe(UK_BASE_MIN_ZOOM);
    expect(UK_BASE_MIN_ZOOM).toBe(PIN_MIN_ZOOM);
  });

  it("draws under the curated pins, which is also how it loses collisions", () => {
    // Placement runs top layer first, so a base pin can only take a spot no
    // curated pin wanted. Insertion order IS the style order here.
    const ids = [...layers.keys()];
    expect(ids.indexOf("uk-base-point")).toBeLessThan(ids.indexOf("pubs-point"));
  });

  it("collides like every other symbol rather than stacking", () => {
    expect(layout("uk-base-point")["icon-allow-overlap"]).toBe(false);
    expect(layout("uk-base-point")["icon-ignore-placement"]).toBe(false);
  });

  it("stays visibly smaller than a curated pin at every shared zoom", () => {
    // Both are ["interpolate", ["linear"], ["zoom"], z, out, …]. A curated stop
    // output is itself ["case", story?, storySize, standardSize] — take the
    // standard (fallback) size, the smallest a curated pin ever draws at.
    const standard = (output: unknown) =>
      Array.isArray(output) ? (output[output.length - 1] as number) : (output as number);
    const sizeAt = (expr: unknown, zoom: number) => {
      const stops = (expr as unknown[]).slice(3);
      let value = standard(stops[1]);
      for (let i = 0; i < stops.length; i += 2) {
        if ((stops[i] as number) <= zoom) value = standard(stops[i + 1]);
      }
      return value;
    };
    for (const zoom of [UK_BASE_MIN_ZOOM, 15, 17]) {
      expect(sizeAt(UK_BASE_ICON_SIZE_EXPR, zoom)).toBeLessThan(sizeAt(PIN_ICON_SIZE_EXPR, zoom));
    }
    // …and never fully opaque, so it reads as background even when isolated.
    expect(UK_BASE_ICON_OPACITY).toBeLessThan(1);
  });

  it("carries no price-driven paint at all", () => {
    const paint = (layers.get("uk-base-point")?.paint ?? {}) as Record<string, unknown>;
    expect(JSON.stringify(paint)).not.toContain("bucket");
    expect(layout("uk-base-point")["icon-image"]).toBe("base:pub");
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

    // The base layer keeps colliding even while a venue is selected —
    // icon-allow-overlap is data-constant, so the exemption cannot live here.
    const pins = (selectedLayers.get("pubs-point")?.layout ?? {}) as Record<string, unknown>;
    expect(pins["icon-allow-overlap"]).toBe(false);

    // The exemption is the dedicated selected-pin layer: one feature via the
    // selected-id filter, constant overlap, still visible to the collision
    // index so neighbours keep off it.
    const selected = selectedLayers.get("pubs-point-selected")!;
    const selectedLayout = (selected.layout ?? {}) as Record<string, unknown>;
    expect(selected.filter).toEqual(selectedPinFilter("venue-abc"));
    expect(selectedLayout["icon-allow-overlap"]).toBe(true);
    expect(selectedLayout["icon-ignore-placement"]).toBe(false);
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

// The provisional-report badge is the newest thing riding on a pin, so it is
// also the easiest way to break two contracts at once: the density rule (a
// marker that grows the pin's footprint changes which pins get placed) and the
// price-band colour system (a badge that borrows a band colour reads as a
// price). Both are asserted here rather than left to a screenshot.
describe("provisional-report badge (ungated visibility, zero authority)", () => {
  const { layers } = buildScenePieces();
  const badge = layers.get("pubs-provisional-badge")!;
  const paint = (badge.paint ?? {}) as Record<string, unknown>;

  it("only ever rides an unclustered pin, from the pin floor", () => {
    expect(badge.filter).toEqual([
      "all",
      ["!", ["has", "point_count"]],
      ["get", "provisional"],
    ]);
    expect((badge as { minzoom?: number }).minzoom).toBe(PIN_MIN_ZOOM);
  });

  it("stays inside the halo envelope the pin's icon-padding already clears", () => {
    // A circle layer is invisible to MapLibre's collision index, so the badge
    // can only be free of the density contract while it sits inside the
    // footprint `pubs-point` already reserves. Grow it past this and pins start
    // touching on a 390px phone.
    const [dx, dy] = PROVISIONAL_BADGE_OFFSET_PX;
    expect(Math.hypot(dx, dy) + PROVISIONAL_BADGE_RADIUS_MAX_PX).toBeLessThanOrEqual(
      PIN_HALO_ENVELOPE_PX,
    );
    expect(paint["circle-translate"]).toEqual(PROVISIONAL_BADGE_OFFSET_PX);
  });

  it("dims with its own pin instead of popping out of the spotlight", () => {
    const selected = buildScenePieces("venue-abc").layers.get("pubs-provisional-badge")!;
    const selectedPaint = (selected.paint ?? {}) as Record<string, unknown>;
    expect(selectedPaint["circle-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
    expect(selectedPaint["circle-stroke-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
  });

  it("draws over every per-pin layer, so no ring or selection can hide it", () => {
    const ids = [...layers.keys()];
    for (const under of [
      "pubs-point",
      "pubs-point-selected",
      "pubs-selected-glow",
      "pubs-selected",
    ]) {
      expect(ids.indexOf(under)).toBeLessThan(ids.indexOf("pubs-provisional-badge"));
    }
  });

  it("reads no price at all - not the bucket, not a band colour", () => {
    expect(JSON.stringify(paint)).not.toContain("bucket");
    expect(JSON.stringify(paint)).not.toContain("latestContributorPrice");
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
