import { describe, expect, it } from "vitest";

import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { compactDealAnchor, nearestCompactNightArea, nightAreaBoundaryContains } from "@/lib/nightAreaGeometry";
import { tonightNightAreas } from "@/lib/tonightNightAreas.server";

describe("Tonight coarse night areas", () => {
  it("checks polygon interiors, every edge and outside direction in either winding order", () => {
    const boundary = [[0, 0], [2, 0], [2, 2], [0, 2]] as const;
    for (const ring of [boundary, [...boundary].reverse()]) {
      for (const point of [[1, 1], [0, 1], [1, 0], [2, 1], [1, 2], ...boundary] as const) {
        expect(nightAreaBoundaryContains(ring, point)).toBe(true);
      }
      for (const point of [[-1, 1], [3, 1], [1, -1], [1, 3], [NaN, 1]] as const) {
        expect(nightAreaBoundaryContains(ring, point)).toBe(false);
      }
    }
    expect(nightAreaBoundaryContains(undefined, [1, 1])).toBe(true);
  });

  it("keeps the canonical London selection for representative coordinates", () => {
    const areas = tonightNightAreas();
    for (const point of [[-0.134, 51.513], [-0.141, 51.463], [-0.075, 51.505]] as [number, number][]) {
      const actual = nearestCompactNightArea(areas, point);
      const expected = nearestNightAreaForViewport("london", point);
      expect(actual).toEqual(expected && { slug: expected.slug, centre: expected.centre });
    }
  });

  it("keeps incoming order for an equal-distance tie and handles an empty catalogue", () => {
    const areas = [
      { slug: "first", centre: { lat: 0, lng: -1 } },
      { slug: "second", centre: { lat: 0, lng: 1 } },
    ];
    expect(nearestCompactNightArea(areas, [0, 0])?.slug).toBe("first");
    expect(nearestCompactNightArea([], [0, 0])).toBeNull();
  });

  it("uses the existing London distance weights and selects the known Soho centre", () => {
    const areas = [
      { slug: "north", centre: { lat: 0.01, lng: 0 } },
      { slug: "east", centre: { lat: 0, lng: 0.01 } },
    ];
    // North is 1.11 km away and east is 0.70 km by the existing rule.
    expect(nearestCompactNightArea(areas, [0, 0])?.slug).toBe("east");
    expect(compactDealAnchor(areas, { lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0.01 });
    expect(compactDealAnchor(areas, { lat: Number.NaN, lng: 0 })).toBeNull();
    expect(compactDealAnchor(areas, null)).toBeNull();
    expect(nearestCompactNightArea(tonightNightAreas(), [-0.134, 51.511])?.slug)
      .toBe("piccadilly-soho");
  });
});
