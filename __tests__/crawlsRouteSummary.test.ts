import { describe, expect, it } from "vitest";

import { buildCrawlRouteSummary } from "@/app/crawls/routeSummary";
import type { SlimVenue } from "@/lib/venuesSlim";

function venue(id: string, lat: number, lng: number): SlimVenue {
  return { id, name: id, lat, lng, borough: "Camden", cheapestPrice: null };
}

const stops = new Map([
  ["a", venue("a", 0, 0)],
  ["b", venue("b", 0, 0.01)],
  ["c", venue("c", 0, 0.02)],
]);

describe("crawl directory route estimates", () => {
  it("estimates the complete ordered route from its resolved stop coordinates", () => {
    const summary = buildCrawlRouteSummary(["a", "b", "c"], stops);
    // Two 0.01-degree equatorial legs cover about 2.224km. At 4.8km/h,
    // the estimate rounds up to 28 minutes. This is not a pavement route.
    expect(summary?.totalKm).toBeCloseTo(2.224, 2);
    expect(summary?.totalMinutes).toBe(28);
    expect(summary?.points).toEqual([[0, 0], [0.01, 0], [0.02, 0]]);
  });

  it.each([
    ["missing", "a", "c"],
    ["a", "missing", "c"],
    ["a", "c", "missing"],
  ])("withholds the total when a stop is missing: %j", (...ids) => {
    expect(buildCrawlRouteSummary(ids, stops)).toBeUndefined();
  });

  it("withholds a route estimate with fewer than two stops", () => {
    expect(buildCrawlRouteSummary([], stops)).toBeUndefined();
    expect(buildCrawlRouteSummary(["a"], stops)).toBeUndefined();
  });
});
