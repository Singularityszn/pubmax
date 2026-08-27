import { describe, expect, it } from "vitest";

import { UK_BASE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { summarizeCityPubCoverage } from "@/lib/cityMapCoverage";
import { getCity } from "@/lib/cities";

describe("summarizeCityPubCoverage", () => {
  it("uses only pub rows for mapped count and pint range", () => {
    expect(
      summarizeCityPubCoverage([
        { cheapestPrice: 4.5 },
        { kind: "pub", cheapestPrice: 7 },
        { kind: "bar", cheapestPrice: 18 },
        { kind: "food", cheapestPrice: 28 },
      ]),
    ).toEqual({ count: 2, min: 4.5, max: 7 });
  });

  it("returns empty coverage for malformed input", () => {
    expect(summarizeCityPubCoverage(null)).toEqual({
      count: 0,
      min: null,
      max: null,
    });
  });

  it("starts London at the UK Base stream gate", () => {
    expect(getCity("london").mapView.zoom).toBeGreaterThanOrEqual(UK_BASE_MIN_ZOOM);
  });
});
