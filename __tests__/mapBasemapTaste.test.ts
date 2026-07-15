import { describe, expect, it, vi } from "vitest";

import {
  applyBasemapTaste,
  applySelectionMute,
  buildingMassingColorExpr,
  buildPalette,
  clusterCircleColorExpr,
  isBasemapSelectionMuteLayer,
  mixHex,
  muteOpacityExpr,
  SELECTION_MUTE_OPACITY,
  withAlpha,
} from "@/lib/mapBasemapTaste";
import { applySelectionState, type SceneCtx } from "@/components/map/canvas/buildScene";

const tokens = {
  paper: "#f4efe4",
  panelRaised: "#ffffff",
  ink: "#1b2620",
  inkDeep: "#0f1c16",
  line: "#ddd5c4",
  muted: "#6b726a",
  pint: "#2f8f5b",
  amber: "#d99f45",
  brass: "#b0813a",
  river: "#2f6f8f",
  riverBright: "#4f9ec4",
  buildingEmissive: "#d99f45",
  parkTint: "#7ea052",
};

const darkTokens = {
  ...tokens,
  paper: "#14110f",
  panelRaised: "#241f1b",
  ink: "#fff4e8",
  inkDeep: "#090806",
  line: "#413a34",
  muted: "#9c9388",
  pint: "#39d98a",
  amber: "#ffc247",
  brass: "#ff6b7a",
  river: "#64b5ff",
  riverBright: "#7dd3fc",
  buildingEmissive: "#8f7d6b",
  parkTint: "#3f5c38",
};

describe("mapBasemapTaste (Wave J1 / dark streets)", () => {
  it("keeps dark land near-black — never cream ink", () => {
    const dark = buildPalette(darkTokens, true);
    const light = buildPalette(tokens, false);
    expect(dark.land).toBe(darkTokens.inkDeep);
    expect(dark.land).not.toBe(darkTokens.ink);
    expect(light.land).toBe(tokens.paper);
    // Streets remain legible without turning the whole basemap into white
    // linework; major roads retain the warmer transport hierarchy.
    expect(dark.road).toContain("255, 244, 232"); // cream ink rgb
    expect(dark.roadMajor).toContain("255, 244, 232"); // brighter neutral hierarchy
    // Buildings: M4 warmed emissive massing — readable on near-black land,
    // still desaturated (never a literal brass/coral wash).
    expect(dark.building).not.toBe(darkTokens.inkDeep);
    expect(dark.building).not.toBe(darkTokens.buildingEmissive);
    expect(dark.building).not.toBe(darkTokens.brass);
    expect(dark.building).not.toContain("255, 107, 122"); // old brass coral
  });

  it("M4 — park tint is never the pint UI semantic, in either theme", () => {
    const dark = buildPalette(darkTokens, true);
    const light = buildPalette(tokens, false);
    // Old formula was withAlpha(pint, …) — assert park no longer matches it.
    expect(dark.park).not.toBe(withAlpha(darkTokens.pint, 0.32));
    expect(light.park).not.toBe(withAlpha(tokens.pint, 0.26));
    // Sanity: park is actually derived from parkTint, not left unpainted.
    expect(dark.park).toContain("63, 92, 56"); // darkTokens.parkTint rgb
    expect(light.park).toContain("126, 160, 82"); // tokens.parkTint rgb
  });

  it("M4 — light water is a calmer translucent wash, not the loud opaque cyan", () => {
    const light = buildPalette(tokens, false);
    // Old behaviour painted the fully-opaque riverBright cyan directly.
    expect(light.water).not.toBe(tokens.riverBright);
    expect(light.water).toMatch(/^rgba\(/);
    expect(light.water).toContain("47, 111, 143"); // tokens.river rgb
  });

  it("M4 — light roads read brighter than land, with a major/minor tier", () => {
    const light = buildPalette(tokens, false);
    // Neither tier is the old flat brass/coral wash.
    expect(light.road).not.toContain("176, 129, 58"); // old brass rgb
    expect(light.roadMajor).not.toContain("176, 129, 58");
    // Major tier is a distinct, warmer step from the near-white minor tier.
    expect(light.road).not.toBe(light.roadMajor);
  });

  it("applies land/water/road/building paints when layers exist", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set([
      "background",
      "park",
      "water",
      "road_major",
      "highway_minor",
      "highway_major_inner",
      "building",
      "landuse_residential",
      "landuse_park",
      "mystery",
    ]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          { id: "background", type: "background" },
          { id: "park", type: "fill" },
          { id: "water", type: "fill" },
          { id: "road_major", type: "line" },
          { id: "highway_minor", type: "line" },
          { id: "highway_major_inner", type: "line" },
          { id: "building", type: "fill" },
          { id: "landuse_residential", type: "fill" },
          { id: "landuse_park", type: "fill" },
        ],
      }),
    };

    applyBasemapTaste(map, darkTokens, true);

    const bg = paints.find(([id, prop]) => id === "background" && prop === "background-color");
    expect(bg?.[2]).toBe(darkTokens.inkDeep);

    expect(paints.some(([id, prop]) => id === "park" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "water" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "road_major" && prop === "line-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "highway_minor" && prop === "line-color")).toBe(true);
    expect(
      paints.some(([id, prop]) => id === "highway_major_inner" && prop === "line-color"),
    ).toBe(true);
    expect(paints.some(([id, prop]) => id === "building" && prop === "fill-color")).toBe(true);
    expect(
      paints.find(([id, prop]) => id === "building" && prop === "fill-opacity")?.[2],
    ).toBe(0.92);
    expect(
      paints.find(([id, prop]) => id === "building" && prop === "fill-outline-color")?.[2],
    ).toBe("rgba(154,163,181,0.28)");
    expect(
      paints.some(([id, prop]) => id === "landuse_residential" && prop === "fill-color"),
    ).toBe(true);
  });

  it("skips missing layers without throwing", () => {
    const map = {
      getLayer: () => undefined,
      setPaintProperty: vi.fn(),
      getStyle: () => ({ layers: [] }),
    };
    expect(() => applyBasemapTaste(map, darkTokens, true)).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("does not force night-black casings in light mode", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set(["highway_major_casing", "road_minor"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          { id: "highway_major_casing", type: "line" },
          { id: "road_minor", type: "line" },
        ],
      }),
    };

    applyBasemapTaste(map, tokens, false);

    expect(
      paints.some(([id, prop]) => id === "highway_major_casing" && prop === "line-color"),
    ).toBe(false);
    expect(paints.some(([id, prop]) => id === "road_minor" && prop === "line-color")).toBe(true);
  });

  it("discovered pass does not repaint known layers (no double-paint)", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set(["road_major", "highway_major_casing", "custom_road_layer"]);
    const map = {
      getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
      setPaintProperty: (layerId: string, name: string, value: unknown) => {
        paints.push([layerId, name, value]);
      },
      getStyle: () => ({
        layers: [
          // Known layers — should only be painted once by paintKnownLayers
          { id: "road_major", type: "line" },
          { id: "highway_major_casing", type: "line" },
          // Unknown layer — should be painted by the discovered pass
          { id: "custom_road_layer", type: "line" },
        ],
      }),
    };

    applyBasemapTaste(map, darkTokens, true);

    // Known layers: each painted exactly once (by paintKnownLayers only)
    const roadMajorPaints = paints.filter(([id]) => id === "road_major");
    expect(roadMajorPaints.length).toBe(1);

    // Discovered-only layer must still be painted
    expect(paints.some(([id]) => id === "custom_road_layer")).toBe(true);
  });

  it("builds a step expression for cluster colors using pint/amber/brass", () => {
    const expr = clusterCircleColorExpr(tokens, false) as unknown[];
    expect(expr[0]).toBe("step");
    const serialized = JSON.stringify(expr);
    expect(serialized).toContain("47, 143, 91"); // pint rgb
    expect(serialized).toContain("217, 159, 69"); // amber
    expect(serialized).toContain("176, 129, 58"); // brass
  });
});

describe("mixHex (M4 token-derivation primitive)", () => {
  it("returns hexA unchanged at t=0 and hexB at t=1", () => {
    expect(mixHex("#ffffff", "#f2a71b", 0)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#f2a71b", 1)).toBe("#f2a71b");
  });

  it("blends channel-wise at a mid ratio", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("clamps out-of-range ratios instead of extrapolating", () => {
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", -1)).toBe("#000000");
  });

  it("falls back to hexA for malformed input rather than throwing", () => {
    expect(mixHex("not-a-color", "#ffffff", 0.5)).toBe("not-a-color");
  });
});

describe("buildingMassingColorExpr (M6 interim — two-stop height gradient)", () => {
  it("returns a height-keyed interpolate expression, low stop darker than base", () => {
    const expr = buildingMassingColorExpr(darkTokens.buildingEmissive, darkTokens.inkDeep) as [
      string,
      unknown,
      unknown,
      number,
      string,
      number,
      string,
    ];
    expect(expr[0]).toBe("interpolate");
    expect(expr[3]).toBe(0);
    expect(expr[5]).toBe(60);
    // Tall stop is the base tone, unchanged — "keep each theme's current
    // overall tone" holds at the top of the gradient.
    expect(expr[6]).toBe(darkTokens.buildingEmissive);
    // Low stop is a genuinely different (darkened) colour, not the flat base.
    expect(expr[4]).not.toBe(darkTokens.buildingEmissive);
    expect(expr[4]).toBe(mixHex(darkTokens.buildingEmissive, darkTokens.inkDeep, 0.55));
  });

  it("keys off the same render_height/height coalesce as fill-extrusion-height", () => {
    const expr = buildingMassingColorExpr(tokens.buildingEmissive, tokens.inkDeep) as unknown[];
    expect(expr[2]).toEqual(["coalesce", ["get", "render_height"], ["get", "height"], 14]);
  });

  it("both themes' low stop reads darker than their own base (never brighter)", () => {
    for (const t of [tokens, darkTokens]) {
      const expr = buildingMassingColorExpr(t.buildingEmissive, t.inkDeep) as [
        string,
        unknown,
        unknown,
        number,
        string,
      ];
      const lowStop = expr[4];
      // A crude luminance proxy: sum of RGB channels. Darkened toward inkDeep
      // (a near-black token in both themes) must never increase luminance.
      const lumOf = (hex: string) => {
        const n = parseInt(hex.slice(1), 16);
        return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
      };
      expect(lumOf(lowStop)).toBeLessThan(lumOf(t.buildingEmissive));
    }
  });
});

describe("M2 · POI-at-initiation selection mute", () => {
  describe("isBasemapSelectionMuteLayer (pure classifier)", () => {
    it("matches baked transit / POI / street-name symbol layers", () => {
      for (const id of [
        "poi_z16",
        "poi_transit",
        "poi_label",
        "road_label",
        "road_shield",
        "highway-name-path",
        "transit_stop_label",
        "railway_station_label",
        "airport-label",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(true);
      }
    });

    it("leaves place / water labels and road GEOMETRY untouched", () => {
      // Place + water labels are legit overview context — never muted.
      for (const id of [
        "place_city",
        "place_suburb",
        "place_country_1",
        "water_name",
        "waterway-name",
        "mountain_peak",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(false);
      }
      // Road/water GEOMETRY are line/fill layers, not symbols — out of scope.
      expect(isBasemapSelectionMuteLayer("road_major", "line")).toBe(false);
      expect(isBasemapSelectionMuteLayer("water", "fill")).toBe(false);
      expect(isBasemapSelectionMuteLayer("background", "background")).toBe(false);
    });

    it("skips our own app layers (they are muted by explicit id, not the classifier)", () => {
      for (const id of [
        "pois-label",
        "pois-transport-major",
        "pubs-point",
        "tube-lines-color",
        "landmarks-icon",
        "route-line",
        "tonight-point",
      ]) {
        expect(isBasemapSelectionMuteLayer(id, "symbol")).toBe(false);
      }
    });
  });

  // A minimal fake map: layers with per-prop paint values that getPaintProperty
  // reads back and setPaintProperty mutates, so we can assert snapshot/restore.
  function makeMuteMap() {
    const paint: Record<string, Record<string, unknown>> = {
      // Baked basemap symbol (should be muted).
      poi_label: { "text-opacity": 0.9 },
      road_label: { "text-opacity": 1 },
      // Baked place label (should be LEFT ALONE).
      place_city: { "text-opacity": 0.95 },
      // Our own app layers (muted by explicit id list).
      "pois-label": { "text-opacity": 0.88 },
      "tube-lines-color": { "line-opacity": ["interpolate"] },
      "landmarks-icon": { "icon-opacity": 1, "text-opacity": 1 },
    };
    const layerTypes: Record<string, string> = {
      poi_label: "symbol",
      road_label: "symbol",
      place_city: "symbol",
      "pois-label": "symbol",
      "tube-lines-color": "line",
      "landmarks-icon": "symbol",
    };
    return {
      paint,
      getLayer: (id: string) => (paint[id] ? { id } : undefined),
      getPaintProperty: (id: string, prop: string) => paint[id]?.[prop],
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        (paint[id] ??= {})[prop] = value;
      },
      getStyle: () => ({
        layers: Object.keys(layerTypes).map((id) => ({ id, type: layerTypes[id] })),
      }),
    };
  }

  it("mutes basemap + app label layers on selection, leaves place labels alone", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store);

    // Issue #222 — the muted value is min(original, 0.12), not a flat 0.12.
    expect(map.paint.poi_label["text-opacity"]).toEqual(["min", 0.9, SELECTION_MUTE_OPACITY]);
    expect(map.paint.road_label["text-opacity"]).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    expect(map.paint["pois-label"]["text-opacity"]).toEqual(["min", 0.88, SELECTION_MUTE_OPACITY]);
    expect(map.paint["tube-lines-color"]["line-opacity"]).toEqual([
      "min",
      ["interpolate"],
      SELECTION_MUTE_OPACITY,
    ]);
    expect(map.paint["landmarks-icon"]["icon-opacity"]).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    // Place labels are overview context — untouched.
    expect(map.paint.place_city["text-opacity"]).toBe(0.95);
  });

  it("restores EXACT originals on deselect (idempotent select/deselect cycles)", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    const before = JSON.stringify(map.paint);

    // Two select→deselect cycles must land back on the exact original paint.
    for (let i = 0; i < 2; i++) {
      applySelectionMute(map, true, store);
      applySelectionMute(map, false, store);
      expect(JSON.stringify(map.paint)).toBe(before);
      expect(store.size).toBe(0);
    }
  });

  it("re-muting while already muted does not clobber the stored original", () => {
    const map = makeMuteMap();
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store); // captures 0.9
    applySelectionMute(map, true, store); // must NOT capture the muted 0.12
    expect(store.get("poi_label::text-opacity")).toBe(0.9);
    applySelectionMute(map, false, store);
    expect(map.paint.poi_label["text-opacity"]).toBe(0.9);
  });

  it("restores an unset paint prop to style default via undefined", () => {
    const map = makeMuteMap();
    // road_label has text-opacity but no icon-opacity — snapshot must be undefined.
    const store = new Map<string, unknown>();
    applySelectionMute(map, true, store);
    expect(store.get("road_label::icon-opacity")).toBeUndefined();
    applySelectionMute(map, false, store);
    // Restored to undefined (style default), not left at the mute value.
    expect(map.paint.road_label["icon-opacity"]).toBeUndefined();
  });
});

describe("muteOpacityExpr (issue #222 — mute must only ever attenuate)", () => {
  it("wraps the original in a min() against the mute floor", () => {
    expect(muteOpacityExpr(0.9, SELECTION_MUTE_OPACITY)).toEqual(["min", 0.9, SELECTION_MUTE_OPACITY]);
  });

  it("defaults a missing (unset) original to the style spec's opacity default of 1", () => {
    expect(muteOpacityExpr(undefined, SELECTION_MUTE_OPACITY)).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
    expect(muteOpacityExpr(null, SELECTION_MUTE_OPACITY)).toEqual(["min", 1, SELECTION_MUTE_OPACITY]);
  });

  it("never raises a zoom-ramped original that dips below the mute floor", () => {
    // pois-transport-minor's real icon-opacity ramp (buildScene.ts): 0 at
    // zoom 12.4, 1 by zoom 13.1. At the low end it's already invisible (0) —
    // min(0, 0.12) must stay 0, not jump to 0.12 and pop the icon visible.
    const expr = muteOpacityExpr(0, SELECTION_MUTE_OPACITY) as [string, number, number];
    expect(expr).toEqual(["min", 0, SELECTION_MUTE_OPACITY]);
    expect(expr[1]).toBe(0); // the pre-mute original, verbatim — never rewritten upward
  });

  it("preserves a zoom-ramp original expression verbatim inside min()", () => {
    const original = ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.1, 1];

    expect(muteOpacityExpr(original, SELECTION_MUTE_OPACITY)).toEqual([
      "min",
      original,
      SELECTION_MUTE_OPACITY,
    ]);
  });

  it("still attenuates a plain original that sits above the mute floor", () => {
    const expr = muteOpacityExpr(0.98, SELECTION_MUTE_OPACITY) as [string, number, number];
    expect(expr[2]).toBe(SELECTION_MUTE_OPACITY);
  });
});

describe("style.load recapture path (applySelectionState, buildScene.ts)", () => {
  // A minimal SceneCtx-shaped fake: applySelectionState only reads
  // map/selectionMuteStore/selectedId off ctx, so the rest can stay absent.
  function makeCtx(map: unknown, store: Map<string, unknown>, selectedId: string): SceneCtx {
    return { map, selectionMuteStore: store, selectedId } as unknown as SceneCtx;
  }

  it("clears stale originals from the old style and re-snapshots fresh ones from the new style", () => {
    // Simulate the NEW style's freshly-rebuilt pois-transport-minor layer,
    // caught at the low end of its zoom ramp (icon-opacity 0 — invisible).
    const paint: Record<string, Record<string, unknown>> = {
      "pois-transport-minor": { "icon-opacity": 0 },
    };
    const map = {
      getLayer: (id: string) => (paint[id] ? { id } : undefined),
      getPaintProperty: (id: string, prop: string) => paint[id]?.[prop],
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        (paint[id] ??= {})[prop] = value;
      },
      getStyle: () => ({ layers: [{ id: "pois-transport-minor", type: "symbol" }] }),
    };

    // A STALE store entry left over from the OLD style — e.g. a moment where
    // the layer's icon-opacity happened to be 0.9 pre-mute. If this survived
    // the reload, muteOpacityExpr(0.9, 0.12) === min(0.9, 0.12) = 0.12 would
    // raise the fresh (0-opacity) layer visible, reintroducing #222.
    const store = new Map<string, unknown>([["pois-transport-minor::icon-opacity", 0.9]]);

    applySelectionState(makeCtx(map, store, "venue-1"));

    // The stale 0.9 must be gone — re-snapshotted from the NEW style's own
    // fresh paint value (0), not reused from before the reload.
    expect(store.get("pois-transport-minor::icon-opacity")).toBe(0);
    // The muted paint attenuates the FRESH original, never the stale one —
    // min(0, 0.12) stays 0, not min(0.9, 0.12) = 0.12 (a raise).
    expect(paint["pois-transport-minor"]["icon-opacity"]).toEqual(["min", 0, SELECTION_MUTE_OPACITY]);
  });

  it("with nothing selected, a reload is a pure clear — no mute is (re)applied", () => {
    const setPaintProperty = vi.fn();
    const map = {
      getLayer: () => ({ id: "pois-transport-minor" }),
      getPaintProperty: () => 0,
      setPaintProperty,
      getStyle: () => ({ layers: [] }),
    };
    const store = new Map<string, unknown>([["stale::key", 1]]);

    applySelectionState(makeCtx(map, store, ""));

    expect(store.size).toBe(0);
    expect(setPaintProperty).not.toHaveBeenCalled();
  });
});
