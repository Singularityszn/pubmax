import { describe, expect, it } from "vitest";
import { paintedPinIds, PUB_PIN_LAYERS, sameIds, sunDotFeatures } from "@/components/map/sunChaser/sunDots";
import type { SunEstimate, SunState } from "@/lib/sunChaser";

const FROM = new Date("2026-06-20T15:30:00Z");
const TO = new Date("2026-06-20T21:30:00Z");

function steady(state: SunState): SunEstimate {
  return { kind: "estimate", timeline: { from: FROM, to: TO, segments: [{ state, start: FROM, end: TO }] } };
}

const POINTS: Record<string, [number, number]> = {
  shown: [-0.1, 51.5],
  hidden: [-0.11, 51.51],
  shady: [-0.12, 51.52],
};
const pointOf = (id: string) => POINTS[id] ?? null;

describe("sun dots follow their pins", () => {
  const estimates = new Map<string, SunEstimate>([
    ["shown", steady("sun")],
    ["hidden", steady("sun")],
    ["shady", steady("shade")],
    ["unknown-place", steady("sun")],
  ]);

  it("draws a dot only beside a pin the map is drawing", () => {
    const dots = sunDotFeatures(estimates, FROM, pointOf, new Set(["shown", "shady"]));
    expect(dots.map((dot) => dot.properties?.id)).toEqual(["shown"]);
    expect(dots[0]?.geometry.coordinates).toEqual(POINTS.shown);
  });

  it("draws nothing when no pin is drawn, as when the pubs sit in clusters", () => {
    expect(sunDotFeatures(estimates, FROM, pointOf, new Set())).toEqual([]);
  });

  it("draws nothing before the first estimate", () => {
    expect(sunDotFeatures(estimates, null, pointOf, new Set(["shown"]))).toEqual([]);
  });

  it("asks the map only for the pub pin layers it has, and reads the placed pins' ids", () => {
    const asked: string[][] = [];
    const map = {
      getLayer: (id: string) => (id === "pubs-point" || id === "pubs-price-pill" ? ({} as never) : undefined),
      queryRenderedFeatures: (options: { layers: string[] }) => {
        asked.push(options.layers);
        return [{ properties: { id: "shown" } }, { properties: { id: 7 } }, { properties: {} }] as never;
      },
    };
    expect([...paintedPinIds(map as never)]).toEqual(["shown"]);
    expect(asked).toEqual([
      PUB_PIN_LAYERS.filter((id) => id === "pubs-point" || id === "pubs-price-pill"),
    ]);
    // The selected pub's own layers are pin layers too: a selected pill or a
    // selected glass keeps its sun dot.
    expect(PUB_PIN_LAYERS).toContain("pubs-price-pill-selected");
    expect(PUB_PIN_LAYERS).toContain("pubs-point-selected");
  });

  it("reads no pins before the pin layers exist", () => {
    const map = { getLayer: () => undefined, queryRenderedFeatures: () => { throw new Error("not asked"); } };
    expect(paintedPinIds(map as never).size).toBe(0);
  });

  it("treats the same pins as no change", () => {
    expect(sameIds(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameIds(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameIds(new Set(["a", "c"]), new Set(["a", "b"]))).toBe(false);
  });
});
