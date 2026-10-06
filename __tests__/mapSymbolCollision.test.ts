import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type * as maplibregl from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  buildLandmarks,
  buildLondonRestaurants,
  buildPois,
  buildPubs,
  buildUkBase,
  CLUSTER_COLLISION_PADDING,
  CLUSTER_MAX_RADIUS_PX,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS_PX,
  LANDMARK_ICON_PRIORITY_ZOOM,
  LONDON_RESTAURANT_ICON,
  PIN_HALO_ENVELOPE_PX,
  PIN_MIN_ZOOM,
  PIN_PRICE_LABEL_PADDING,
  CONFIRMED_BADGE_STROKE_PX,
  PROVISIONAL_BADGE_OFFSET_PX,
  PROVISIONAL_BADGE_RADIUS_MAX_PX,
  UK_BASE_ICON_OPACITY,
  UK_BASE_ICON_SIZE_EXPR,
  UK_BASE_MIN_ZOOM,
  UK_BASE_UNNAMED_MIN_ZOOM,
  ukBaseUnnamedBadgeFilter,
  ukBaseUnnamedFilter,
  type SceneCtx,
} from "@/components/map/canvas/buildScene";
import {
  clusterEntranceProgress,
  pinSortKeyExpr,
  pinPriceLabelExpr,
  PIN_ICON_SIZE_EXPR,
  PIN_PRICE_LABEL_MIN_ZOOM,
  pubIconOpacityExpr,
  selectedPinFilter,
  SELECTED_PIN_PRICE_LABEL_EXPR,
} from "@/components/map/canvas/filters";
import { landmarksToGeoJSON } from "@/components/map/canvas/geojson";
import type { Landmark } from "@/lib/landmarks";
import {
  GLOW_BASE_STROKE_OPACITY,
  GLOW_BASE_STROKE_WIDTH,
  GLOW_SELECTED_STROKE_WIDTH,
  type Tokens,
} from "@/components/map/canvas/tokens";

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
    tokens: new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "priceStampTiltDeg" ? -1.5 : "#000000",
      },
    ) as unknown as Tokens,
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
    userLocationData: { type: "FeatureCollection", features: [] },
    ukBaseData: { type: "FeatureCollection", features: [] },
    tonightData: { type: "FeatureCollection", features: [] },
    tonightVisible: false,
    coffeePilotData: { type: "FeatureCollection", features: [] },
    londonRestaurantData: { type: "FeatureCollection", features: [] },
    selectedId,
    selectionMuteStore: new Map<string, unknown>(),
  } satisfies SceneCtx;

  buildLandmarks(ctx);
  buildPois(ctx);
  buildLondonRestaurants(ctx);
  buildUkBase(ctx);
  buildPubs(ctx);
  return { layers, sources };
}

function buildLateLandmarkLayers() {
  const beforeLayer = { id: "pubs-drops-halo" } as BuiltLayer;
  const calls: Array<{ id: string; before?: string }> = [];
  const map = {
    getSource: () => undefined,
    addSource: () => {},
    getLayer: (id: string) => (id === beforeLayer.id ? beforeLayer : undefined),
  } as unknown as maplibregl.Map;
  const ctx = {
    map,
    tokens: new Proxy({}, { get: () => "#000000" }) as unknown as Tokens,
    dark: false,
    textFont: ["Noto Sans Regular"],
    addLayerOnce: ((layer: BuiltLayer, before?: string) => calls.push({ id: layer.id, before })) as SceneCtx["addLayerOnce"],
    showLandmarks: true,
    landmarksGeoJSON: { type: "FeatureCollection", features: [] },
  } as unknown as SceneCtx;
  buildLandmarks(ctx);
  return calls;
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
    // `clusters` circle-radius tops out at the exported maximum (+ stroke) — a grouping radius
    // under that diameter would let neighbouring discs overlap.
    expect(CLUSTER_MAX_RADIUS_PX).toBe(20);
    expect(CLUSTER_RADIUS_PX).toBeGreaterThan(2 * CLUSTER_MAX_RADIUS_PX);
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
    // The glyph is the layer's own unpriced silhouette unless the Spoons value
    // lens has stamped a band on this pub. That band is a UNITS-per-tenner
    // reading (lib/spoonsValue.ts), never a price bucket: the expression reads
    // `spoonsBucket` and no price field at all, and its fallback is the plain
    // base glyph, which is every pub on this layer while the lens is off.
    const icon = layout("uk-base-point")["icon-image"] as unknown[];
    expect(icon[0]).toBe("case");
    expect(icon[1]).toEqual(["has", "spoonsBucket"]);
    expect(icon[3]).toBe("base:pub");
    expect(JSON.stringify(icon)).not.toContain('"bucket"');
    expect(JSON.stringify(icon)).not.toContain("price");
  });
});

// A pub OSM maps with no name (lib/ukBasePubs.ts `unnamed`): a bare "Pub" pin
// that waits for street zoom, so a city view carries only pins that say what
// they are. The selected one is the exception: its pin answers its sheet.
describe("unnamed base pubs (street zoom only)", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("draws on a layer of its own, from street zoom and not before", () => {
    expect(UK_BASE_UNNAMED_MIN_ZOOM).toBeGreaterThan(UK_BASE_MIN_ZOOM);
    expect(UK_BASE_UNNAMED_MIN_ZOOM).toBeGreaterThanOrEqual(16);
    expect((layers.get("uk-base-unnamed-point") as { source?: string }).source).toBe("uk-base");
    const bare = baseFeature("venue-uk-w2", { unnamed: true });
    expect(drawsAt(layers, "uk-base-unnamed-point", bare, UK_BASE_MIN_ZOOM)).toBe(false);
    expect(drawsAt(layers, "uk-base-unnamed-point", bare, 15.9)).toBe(false);
    expect(drawsAt(layers, "uk-base-unnamed-point", bare, UK_BASE_UNNAMED_MIN_ZOOM)).toBe(true);
    expect(drawsAt(layers, "uk-base-unnamed-point", bare, 18)).toBe(true);
    expect(
      drawsAt(layers, "uk-base-unnamed-point", baseFeature("venue-uk-n1"), UK_BASE_UNNAMED_MIN_ZOOM),
    ).toBe(false);
  });

  it("keeps the named layer's filter off every unnamed pub, so no pin draws at city zoom", () => {
    const bare = baseFeature("venue-uk-w2", { unnamed: true });
    for (const zoom of [UK_BASE_MIN_ZOOM, UK_BASE_UNNAMED_MIN_ZOOM]) {
      expect(drawsAt(layers, "uk-base-point", bare, zoom)).toBe(false);
      expect(drawsAt(layers, "uk-base-point", baseFeature("venue-uk-n1"), zoom)).toBe(true);
    }
  });

  it("labels the pin with its generic name and collides like every other symbol", () => {
    expect(layout("uk-base-unnamed-point")["text-field"]).toEqual(["get", "name"]);
    expect(layout("uk-base-unnamed-point")["icon-image"]).toBe("base:pub");
    expect(layout("uk-base-unnamed-point")["icon-allow-overlap"]).toBe(false);
    expect(layout("uk-base-unnamed-point")["text-optional"]).toBe(true);
  });

  it("draws under the named base pins and the curated pins, which is also how it loses collisions", () => {
    const ids = [...layers.keys()];
    // MapLibre places the topmost symbol layer first: a bare "Pub" may never
    // take the room a named pub wanted.
    expect(ids.indexOf("uk-base-unnamed-point")).toBeLessThan(ids.indexOf("uk-base-point"));
    expect(ids.indexOf("uk-base-unnamed-point")).toBeLessThan(ids.indexOf("pubs-point"));
    expect(ids.indexOf("uk-base-unnamed-point")).toBeLessThan(
      ids.indexOf("uk-base-unnamed-provisional-badge"),
    );
  });

  it("holds its provisional badge to the same street zoom as its pin", () => {
    const bare = baseFeature("venue-uk-w2", { unnamed: true, provisional: true });
    for (const zoom of [UK_BASE_MIN_ZOOM, 15, UK_BASE_UNNAMED_MIN_ZOOM, 18]) {
      expect(drawsAt(layers, "uk-base-unnamed-provisional-badge", bare, zoom)).toBe(
        drawsAt(layers, "uk-base-unnamed-point", bare, zoom),
      );
    }
    expect(drawsAt(layers, "uk-base-provisional-badge", bare, UK_BASE_UNNAMED_MIN_ZOOM)).toBe(
      false,
    );
  });

  it("draws a deep-linked unnamed pub's pin at the zoom the selection camera lands on", () => {
    // `/map?sel=venue-uk-w2&at=...` builds the scene with that id selected,
    // and the selection camera settles at zoom 14, under street zoom.
    const deepLinked = buildScenePieces("venue-uk-w2").layers;
    const selected = baseFeature("venue-uk-w2", { unnamed: true, provisional: true });
    const neighbour = baseFeature("venue-uk-w3", { unnamed: true, provisional: true });
    for (const zoom of [UK_BASE_MIN_ZOOM, 14]) {
      expect(drawsAt(deepLinked, "uk-base-unnamed-point", selected, zoom)).toBe(true);
      expect(drawsAt(deepLinked, "uk-base-unnamed-provisional-badge", selected, zoom)).toBe(true);
      expect(drawsAt(deepLinked, "uk-base-selected", selected, zoom)).toBe(true);
      expect(drawsAt(deepLinked, "uk-base-unnamed-point", neighbour, zoom)).toBe(false);
      expect(drawsAt(deepLinked, "uk-base-unnamed-provisional-badge", neighbour, zoom)).toBe(false);
    }
    // The pin is on one layer only, so it never draws twice.
    expect(drawsAt(deepLinked, "uk-base-point", selected, 14)).toBe(false);
  });

  it("tracks a later selection through the same filter the canvas sets", () => {
    const bare = baseFeature("venue-uk-w2", { unnamed: true, provisional: true });
    const evaluate = (filter: unknown, zoom: number) =>
      featureFilter(filter as maplibregl.FilterSpecification, "canvas.setFilter").filter(
        { zoom },
        { type: 1, properties: bare.properties },
      );
    expect(evaluate(ukBaseUnnamedFilter("venue-uk-w2"), 14)).toBe(true);
    expect(evaluate(ukBaseUnnamedBadgeFilter("venue-uk-w2"), 14)).toBe(true);
    expect(evaluate(ukBaseUnnamedFilter(""), 14)).toBe(false);
    expect(evaluate(ukBaseUnnamedBadgeFilter(""), 14)).toBe(false);
  });
});

function baseFeature(id: string, extra: Record<string, unknown> = {}) {
  return { properties: { id, name: extra.unnamed ? "Pub" : "The Anchor", ...extra } };
}

// Whether a built layer paints a feature at a zoom: the layer's own zoom range,
// then its filter run through MapLibre's own filter compiler.
function drawsAt(
  layers: Map<string, BuiltLayer>,
  id: string,
  feature: { properties: Record<string, unknown> },
  zoom: number,
): boolean {
  const layer = layers.get(id) as BuiltLayer & { minzoom?: number; maxzoom?: number };
  if (!layer) throw new Error(`no layer ${id}`);
  if (layer.minzoom !== undefined && zoom < layer.minzoom) return false;
  if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) return false;
  if (layer.filter === undefined) return true;
  return featureFilter(layer.filter as maplibregl.FilterSpecification, `${id}.filter`).filter(
    { zoom },
    { type: 1, properties: feature.properties },
  );
}

// The London restaurants (lib/londonRestaurants.ts): the curated restaurant's
// fork in the unpriced fill, at the base layer's size, under every pub.
describe("London restaurant layer (unpriced forks under every pub)", () => {
  const { layers, sources } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("is its own source and is NOT clustered", () => {
    expect(sources.get("london-restaurants")?.type).toBe("geojson");
    expect(sources.get("london-restaurants")?.cluster).toBeUndefined();
  });

  it("only appears from the pin floor", () => {
    expect((layers.get("london-restaurant-point") as { minzoom?: number }).minzoom).toBe(
      PIN_MIN_ZOOM,
    );
  });

  it("draws under the base pubs and the curated pins, so it loses every collision with a pub", () => {
    const ids = [...layers.keys()];
    expect(ids.indexOf("london-restaurant-point")).toBeLessThan(ids.indexOf("uk-base-point"));
    expect(ids.indexOf("london-restaurant-point")).toBeLessThan(ids.indexOf("pubs-point"));
  });

  it("collides like every other symbol rather than stacking", () => {
    expect(layout("london-restaurant-point")["icon-allow-overlap"]).toBe(false);
    expect(layout("london-restaurant-point")["icon-ignore-placement"]).toBe(false);
  });

  it("wears the curated restaurant fork in the unpriced fill, at the base pin's size", () => {
    expect(LONDON_RESTAURANT_ICON).toBe("drink:fork-3");
    expect(layout("london-restaurant-point")["icon-image"]).toBe(LONDON_RESTAURANT_ICON);
    expect(layout("london-restaurant-point")["icon-size"]).toEqual(UK_BASE_ICON_SIZE_EXPR);
    expect(layers.get("london-restaurant-point")?.paint?.["icon-opacity"]).toBe(
      UK_BASE_ICON_OPACITY,
    );
  });

  it("prints no text and reads no price", () => {
    expect(layout("london-restaurant-point")["text-field"]).toBeUndefined();
    expect(JSON.stringify(layers.get("london-restaurant-point"))).not.toContain("price");
    expect(JSON.stringify(layers.get("london-restaurant-point"))).not.toContain("bucket");
  });
});

describe("symbol collision policy", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;

  it("does not add removed pub halo layers to the scene", () => {
    expect(layers.has("pubs-hero-glow")).toBe(false);
    expect(layers.has("pubs-confidence-ring")).toBe(false);
  });

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
    expect(CLUSTER_COLLISION_PADDING).toBe(10);
  });

  it("drops crowded landmark names rather than overprinting them", () => {
    const label = layout("landmarks-label");
    expect(label["text-allow-overlap"]).toBe(false);
    expect(label["text-ignore-placement"]).toBe(false);
    expect(label["text-variable-anchor"]).toEqual([
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
  });

  it("inserts hydrated landmark layers before the first pub layer", () => {
    expect(buildLateLandmarkLayers()).toEqual([
      { id: "landmarks-label", before: "pubs-drops-halo" },
      { id: "landmarks-icon", before: "pubs-drops-halo" },
    ]);
  });

  it("places landmark names independently when a pub cluster owns the pictogram coordinate", () => {
    const label = layout("landmarks-label");
    const icon = layout("landmarks-icon");

    expect(label["text-field"]).toEqual(["get", "name"]);
    expect(icon["text-field"]).toBeUndefined();
    expect(label["symbol-sort-key"]).toEqual([
      "coalesce",
      ["get", "priority"],
      999,
    ]);
    expect(icon["symbol-sort-key"]).toEqual([
      "coalesce",
      ["get", "priority"],
      999,
    ]);
  });

  it("keeps both landmark candidates below priced pubs in collision priority", () => {
    const ids = [...layers.keys()];
    expect(ids.indexOf("landmarks-label")).toBeLessThan(ids.indexOf("pubs-point"));
    expect(ids.indexOf("landmarks-icon")).toBeLessThan(ids.indexOf("pubs-point"));
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

// The confirmed badge is the provisional dot HOLLOWED OUT: same berth, same
// river tone, same envelope. Captain's law (5 Sept 2026): colour on a pin
// encodes the price band alone, so a trust state is a shape and never a
// traffic-light colour.
describe("confirmed badge (a shape, never a colour)", () => {
  const { layers } = buildScenePieces();
  const badge = layers.get("pubs-confirmed-badge")!;
  const dot = layers.get("pubs-provisional-badge")!;
  const paint = (badge.paint ?? {}) as Record<string, unknown>;
  const dotPaint = (dot.paint ?? {}) as Record<string, unknown>;

  it("rides only an unclustered pin whose standing is confirmed", () => {
    expect(badge.filter).toEqual([
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "standing"], "confirmed"],
    ]);
    expect((badge as { minzoom?: number }).minzoom).toBe(PIN_MIN_ZOOM);
  });

  it("keeps the dot's berth and radius, so the envelope is unchanged", () => {
    expect(paint["circle-translate"]).toEqual(dotPaint["circle-translate"]);
    expect(paint["circle-radius"]).toEqual(dotPaint["circle-radius"]);
  });

  it("is hollow: the dot's rim becomes the fill and the dot's fill becomes the ring", () => {
    expect(paint["circle-color"]).toEqual(dotPaint["circle-stroke-color"]);
    expect(paint["circle-stroke-color"]).toEqual(dotPaint["circle-color"]);
    expect(paint["circle-stroke-width"]).toBe(CONFIRMED_BADGE_STROKE_PX);
  });

  it("never borrows a price-band colour", () => {
    expect(JSON.stringify(badge)).not.toContain("bucket");
    expect(JSON.stringify(badge)).not.toContain("price");
  });

  it("draws over every per-pin layer and dims with its pin", () => {
    const ids = [...layers.keys()];
    for (const under of ["pubs-point", "pubs-point-selected", "pubs-selected-glow", "pubs-selected"]) {
      expect(ids.indexOf(under)).toBeLessThan(ids.indexOf("pubs-confirmed-badge"));
    }
    const selected = buildScenePieces("venue-abc").layers.get("pubs-confirmed-badge")!;
    const selectedPaint = (selected.paint ?? {}) as Record<string, unknown>;
    expect(selectedPaint["circle-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
    expect(selectedPaint["circle-stroke-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
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

  it("uses the same mark on base pubs without joining their price lane", () => {
    const baseBadge = layers.get("uk-base-provisional-badge")!;
    const basePaint = (baseBadge.paint ?? {}) as Record<string, unknown>;
    expect((baseBadge as { source?: string }).source).toBe("uk-base");
    // Named pins only: an unnamed pub's badge rides its own street-zoom layer.
    expect(baseBadge.filter).toEqual([
      "all",
      ["get", "provisional"],
      ["!=", ["get", "unnamed"], true],
    ]);
    expect((baseBadge as { minzoom?: number }).minzoom).toBe(
      UK_BASE_MIN_ZOOM,
    );
    for (const property of [
      "circle-color",
      "circle-radius",
      "circle-translate",
      "circle-stroke-color",
      "circle-stroke-width",
    ]) {
      expect(basePaint[property], property).toEqual(paint[property]);
    }
    expect(JSON.stringify(baseBadge)).not.toContain("bucket");
    expect(JSON.stringify(baseBadge)).not.toContain("price");

    const ids = [...layers.keys()];
    expect(ids.indexOf("uk-base-point")).toBeLessThan(
      ids.indexOf("uk-base-provisional-badge"),
    );
    expect(ids.indexOf("uk-base-provisional-badge")).toBeLessThan(
      ids.indexOf("pubs-point"),
    );
  });

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

// The price tag is the first thing this map draws OUTSIDE a pin's icon padding,
// so it is the first thing that can break the density contract by growing what
// a pin occupies. The badge above bought its exemption by hiding inside that
// padding; the tag cannot, so it takes the ordinary deal instead - and these
// assert it actually took it.
describe("priced-pin price tag (collides, and yields before the pin does)", () => {
  const { layers } = buildScenePieces();
  const layout = (id: string) => (layers.get(id)?.layout ?? {}) as Record<string, unknown>;
  const paint = (id: string) => (layers.get(id)?.paint ?? {}) as Record<string, unknown>;

  it("rides the priced-pin layer itself, not a second symbol layer", () => {
    // A separate label layer would place independently of its own pin: a price
    // could survive where its glyph was dropped, or drift onto a neighbour.
    expect(layout("pubs-point")["text-field"]).toEqual(pinPriceLabelExpr(""));
    expect(layers.get("pubs-point-price-label")).toBeUndefined();
  });

  it("participates in the same collision index the pins do", () => {
    const pins = layout("pubs-point");
    expect(pins["text-allow-overlap"]).toBe(false);
    expect(pins["text-ignore-placement"]).toBe(false);
    expect(pins["text-padding"]).toBe(PIN_PRICE_LABEL_PADDING);
    // A labelled pin must still reserve its halo envelope, unchanged.
    expect(pins["icon-padding"]).toBe(6);
  });

  it("yields before the icon does - the label goes, the pin stays", () => {
    expect(layout("pubs-point")["text-optional"]).toBe(true);
    // The mirror of that: icon-optional is never set, so a pin is never
    // dropped merely to keep its own price on screen.
    expect(layout("pubs-point")["icon-optional"]).toBeUndefined();
  });

  it("is zoom-gated above the pin floor and the cluster band", () => {
    // Below the gate the text-field evaluates to "" - no glyphs, no collision
    // box - so the overview is byte-identical to the map before labels.
    expect(PIN_PRICE_LABEL_MIN_ZOOM).toBeGreaterThan(PIN_MIN_ZOOM);
    expect(PIN_PRICE_LABEL_MIN_ZOOM).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    const field = layout("pubs-point")["text-field"] as unknown[];
    expect(field.slice(0, 4)).toEqual(["step", ["zoom"], "", PIN_PRICE_LABEL_MIN_ZOOM]);
  });

  it("prints nothing for a pub with no sayable price", () => {
    // `priceLabel` is absent on unpriced/demo-only/provisional-only pubs
    // (see canvas-geojson.test.ts), and the coalesce turns that into "".
    const field = layout("pubs-point")["text-field"] as unknown[];
    expect(field[4]).toEqual(["coalesce", ["get", "priceLabel"], ""]);
  });

  it("reads exactly one property, so no view can widen what a figure means", () => {
    // `priceLabel` is the pint claim, gated to pub kinds and to a sourced
    // price. A second coalesce arm is how a soft drink or a dish price gets to
    // print bare over an unchanged pint glyph, which is the same masquerade
    // the anchor-price rule already forbids.
    for (const id of ["pubs-point", "pubs-point-selected"]) {
      const field = JSON.stringify(layout(id)["text-field"]);
      expect(field).toContain("priceLabel");
      expect(field).not.toContain("lensPrice");
      expect(field.match(/"get"/g)?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("never borrows a band colour for the figure", () => {
    // The number IS the price; tinting it would say the same thing twice and
    // invite reading it as a fourth signal alongside the three bands.
    //
    // The failable form of that rule: the tag's two colours must be CONSTANTS.
    // A band tint can only arrive as a data expression - ["match", ["get",
    // "bucket"], …] or a case/step over the same - which lands here as an
    // array, never a string. (Reading `text-color` off the LAYOUT object, as
    // an earlier version of this test did, asserts nothing: it is a paint
    // property, so that lookup is undefined no matter what the layer does.)
    const pins = paint("pubs-point");
    expect(typeof pins["text-color"]).toBe("string");
    expect(typeof pins["text-halo-color"]).toBe("string");
    expect(JSON.stringify(pins)).not.toContain("bucket");
    // And a trust state never reaches the ink either: captain's law, colour on
    // a pin is the price band alone (the confirmed state is a badge SHAPE).
    expect(JSON.stringify(pins)).not.toContain("standing");
  });

  it("dims with its own pin instead of shouting past the spotlight", () => {
    const selected = buildScenePieces("venue-abc").layers.get("pubs-point")!;
    const selectedPaint = (selected.paint ?? {}) as Record<string, unknown>;
    expect(selectedPaint["text-opacity"]).toEqual(pubIconOpacityExpr("venue-abc"));
  });

  it("draws the selected pub's figure once, on the selected-pin layer", () => {
    const selectedLayers = buildScenePieces("venue-abc").layers;
    const base = (selectedLayers.get("pubs-point")?.layout ?? {}) as Record<string, unknown>;
    // The base layer leaves a hole for the selected feature…
    expect(base["text-field"]).toEqual(pinPriceLabelExpr("venue-abc"));
    expect((base["text-field"] as unknown[])[4]).toEqual([
      "case",
      ["==", ["get", "id"], "venue-abc"],
      "",
      ["coalesce", ["get", "priceLabel"], ""],
    ]);
    // …which the enlarged pin fills at its own offset.
    const selected = (selectedLayers.get("pubs-point-selected")?.layout ??
      {}) as Record<string, unknown>;
    expect(selected["text-field"]).toEqual(SELECTED_PIN_PRICE_LABEL_EXPR);
    expect(selected["text-offset"]).not.toEqual(base["text-offset"]);
  });

  it("does not extend the selected pin's overlap exemption to its figure", () => {
    // The icon may stamp over a neighbour (it is the one thing the user is
    // looking at); a NUMBER doing so would be printing a price on the wrong pub.
    const selected = (buildScenePieces("venue-abc").layers.get("pubs-point-selected")
      ?.layout ?? {}) as Record<string, unknown>;
    expect(selected["icon-allow-overlap"]).toBe(true);
    expect(selected["text-allow-overlap"]).toBe(false);
    expect(selected["text-ignore-placement"]).toBe(false);
    expect(selected["text-optional"]).toBe(true);
  });

  it("leaves the unpriced UK base pubs with no text of any kind", () => {
    // ~38k pubs we know nothing about. Never a placeholder, never a "£?".
    //
    // The one pub that gets a tag is one the Spoons value lens holds a real,
    // dated, credited figure for, and the expression is EMPTY for every other
    // pub and for every pub while the lens is off. So the promise is unchanged:
    // a pub we know nothing about still says nothing.
    const text = layout("uk-base-point")["text-field"] as unknown[];
    expect(text[0]).toBe("step");
    expect(text[2]).toBe("");
    expect(text[4]).toEqual(["coalesce", ["get", "spoonsLabel"], ""]);
    expect(JSON.stringify(text)).not.toContain("£");
  });

  it("yields the base tag before the base pin, exactly as a priced pin does", () => {
    // A tag outside the glyph is a real symbol in the collision index or a
    // dense town turns to smear. Where it will not fit, the TAG goes.
    const base = layout("uk-base-point");
    expect(base["text-allow-overlap"]).toBe(false);
    expect(base["text-ignore-placement"]).toBe(false);
    expect(base["text-optional"]).toBe(true);
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

// A theme swap rebuilds the scene while the RAF loop rests, so the rebuilt
// selected ring must already be the static frame the loop rests on.
describe("pubs-selected-glow is built on its rest frame", () => {
  const glowPaint = (selectedId: string) =>
    buildScenePieces(selectedId).layers.get("pubs-selected-glow")!.paint ?? {};

  it("is the fatter selected ring when a pub is selected", () => {
    expect(glowPaint("venue-abc")["circle-stroke-width"]).toBe(GLOW_SELECTED_STROKE_WIDTH);
    expect(glowPaint("venue-abc")["circle-stroke-opacity"]).toBe(GLOW_BASE_STROKE_OPACITY);
  });

  it("is the base ring when nothing is selected", () => {
    expect(glowPaint("")["circle-stroke-width"]).toBe(GLOW_BASE_STROKE_WIDTH);
  });
});
