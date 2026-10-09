import { describe, expect, it } from "vitest";

import { easeInOutCubic, partialRouteLine } from "@/lib/routeDraw";

const LINE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { source: "ors" },
    geometry: { type: "LineString", coordinates: [[0, 51], [0, 51.01], [0, 51.02]] },
  }],
};

const coordinates = (collection: GeoJSON.FeatureCollection) =>
  (collection.features[0]?.geometry as GeoJSON.LineString | undefined)?.coordinates ?? [];

describe("the route draws itself", () => {
  it("shows nothing at the start and the whole untouched line at the end", () => {
    expect(partialRouteLine(LINE, 0).features).toHaveLength(0);
    expect(partialRouteLine(LINE, 1)).toBe(LINE);
  });

  it("cuts the line at a fraction of its own length and keeps its source", () => {
    const half = partialRouteLine(LINE, 0.5);
    const points = coordinates(half);
    expect(points[points.length - 1]?.[1]).toBeCloseTo(51.01, 5);
    expect(half.features[0]?.properties).toEqual({ source: "ors" });
    const quarter = coordinates(partialRouteLine(LINE, 0.25));
    expect(quarter[quarter.length - 1]?.[1]).toBeCloseTo(51.005, 5);
  });

  it("leaves a collection with no line alone", () => {
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    expect(partialRouteLine(empty, 0.5)).toBe(empty);
  });

  it("eases in and out and stays inside 0 to 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
  });
});
