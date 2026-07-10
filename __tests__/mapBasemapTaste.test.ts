import { describe, expect, it, vi } from "vitest";

import {
  applyBasemapTaste,
  buildPalette,
  clusterCircleColorExpr,
} from "@/lib/mapBasemapTaste";

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
};

describe("mapBasemapTaste (Wave J1 / dark streets)", () => {
  it("keeps dark land near-black — never cream ink", () => {
    const dark = buildPalette(darkTokens, true);
    const light = buildPalette(tokens, false);
    expect(dark.land).toBe(darkTokens.inkDeep);
    expect(dark.land).not.toBe(darkTokens.ink);
    expect(light.land).toBe(tokens.paper);
    // Streets must stay luminous against night land.
    expect(dark.road).toContain("255, 244, 232"); // cream ink rgb
    expect(dark.roadMajor).toContain("255, 194, 71"); // amber
    // Buildings: cool mid-gray massing — readable on near-black land (not brass).
    expect(dark.building).toBe("#4a5160");
    expect(dark.building).not.toContain("255, 107, 122"); // brass coral
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
    ).toBe(0.88);
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

  it("builds a step expression for cluster colors using pint/amber/brass", () => {
    const expr = clusterCircleColorExpr(tokens, false) as unknown[];
    expect(expr[0]).toBe("step");
    const serialized = JSON.stringify(expr);
    expect(serialized).toContain("47, 143, 91"); // pint rgb
    expect(serialized).toContain("217, 159, 69"); // amber
    expect(serialized).toContain("176, 129, 58"); // brass
  });
});
