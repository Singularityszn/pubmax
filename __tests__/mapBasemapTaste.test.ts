import { describe, expect, it, vi } from "vitest";

import { applyBasemapTaste, clusterCircleColorExpr } from "@/lib/mapBasemapTaste";

const tokens = {
  paper: "#f4efe4",
  panelRaised: "#ffffff",
  ink: "#1b2620",
  line: "#ddd5c4",
  muted: "#6b726a",
  pint: "#2f8f5b",
  amber: "#d99f45",
  brass: "#b0813a",
  river: "#2f6f8f",
  riverBright: "#4f9ec4",
};

describe("mapBasemapTaste (Wave J1)", () => {
  it("applies land/water/road paints when layers exist", () => {
    const paints: Array<[string, string, unknown]> = [];
    const layers = new Set(["background", "park", "water", "road_major", "mystery"]);
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
        ],
      }),
    };

    applyBasemapTaste(map, tokens, false);

    expect(paints.some(([id, prop]) => id === "background" && prop === "background-color")).toBe(
      true,
    );
    expect(paints.some(([id, prop]) => id === "park" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "water" && prop === "fill-color")).toBe(true);
    expect(paints.some(([id, prop]) => id === "road_major" && prop === "line-color")).toBe(true);
  });

  it("skips missing layers without throwing", () => {
    const map = {
      getLayer: () => undefined,
      setPaintProperty: vi.fn(),
      getStyle: () => ({ layers: [] }),
    };
    expect(() => applyBasemapTaste(map, tokens, true)).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
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
