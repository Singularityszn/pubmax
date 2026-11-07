import { describe, expect, it } from "vitest";

import { buildCrawlRouteSummary, crawlPriceRange } from "@/app/crawls/routeSummary";
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

describe("crawl range endpoint custody", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const priced = (id: string, price: number, source: string, day: string): SlimVenue => ({
    ...venue(id, 51.5, -0.1), cheapestPrice: price, cheapestPint: `${id} ale`,
    measure: "pint", priceSource: source, priceObservedAt: day,
  });

  it("keeps first-in-route endpoint evidence when both extremes have ties", () => {
    const venues = new Map([
      ["low", priced("low", 3, "Low menu", "2025-10-02")],
      ["low-tie", priced("low-tie", 3, "Other low menu", "2025-10-03")],
      ["high", priced("high", 6, "High directory", "2025-09-01")],
      ["high-tie", priced("high-tie", 6, "Other high directory", "2025-09-02")],
    ]);
    const range = crawlPriceRange(["low", "low-tie", "high", "high-tie", "missing"], venues, now);
    expect(range?.min).toMatchObject({ venueId: "low", venueName: "low", priceGbp: 3, evidence: {
      priceGbp: 3, drinkLabel: "low ale", servingSize: "Pint", publisher: { label: "Low menu", url: null },
      sourceKind: "listed", observedOn: "2025-10-02" } });
    expect(range?.max).toMatchObject({ venueId: "high", venueName: "high", priceGbp: 6, evidence: {
      priceGbp: 6, drinkLabel: "high ale", servingSize: "Pint", publisher: { label: "High directory", url: null },
      sourceKind: "listed", observedOn: "2025-09-01" } });
    expect(range?.pricedStops).toBe(4);
    expect(range?.totalStops).toBe(5);
  });

  it("does not lend a neighbouring pub's evidence to an equal unqualified figure", () => {
    const unqualified = { ...priced("unknown", 3, "", "2025-10-02"), priceSource: undefined };
    const qualified = priced("listed", 3, "Listed menu", "2025-09-03");
    const range = crawlPriceRange(["unknown", "listed"], new Map([["unknown", unqualified], ["listed", qualified]]), now);
    expect(range?.min.venueId).toBe("listed");
    expect(range?.max.venueId).toBe("listed");
    expect(range?.min.evidence.publisher?.label).toBe("Listed menu");
    expect(range?.min.evidence.observedOn).toBe("2025-09-03");
    expect(range?.pricedStops).toBe(1);
  });
});
