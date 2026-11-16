import { describe, expect, it } from "vitest";

import { resetMapRefinements } from "@/lib/mapFilterReset";
import { initialFilters } from "@/lib/venues";

describe("clearing map refinements", () => {
  it("keeps the search and planned walk while clearing venue requirements", () => {
    const current = {
      ...initialFilters,
      query: "Camden",
      crawlStyle: "heritage" as const,
      stopCount: 2,
      routeWindow: 90,
      maxPrice: 5,
      zone: "2",
      requireBeerGarden: true,
      requireStepFree: true,
      drinkCategory: "wine",
      drinkBrand: "malbec",
    };

    expect(resetMapRefinements(current, initialFilters)).toEqual({
      ...initialFilters,
      query: "Camden",
      crawlStyle: "heritage",
      stopCount: 2,
      routeWindow: 90,
    });
    expect(current.requireStepFree).toBe(true);
  });
});
