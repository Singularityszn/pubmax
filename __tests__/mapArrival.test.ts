import { describe, expect, it } from "vitest";

import {
  isCuratedCrawlArrival,
  isDrinkShapeArrival,
  shouldOpenPlanningInitially,
} from "@/lib/mapArrival";

describe("isDrinkShapeArrival", () => {
  it("detects drink= and cocktails=1 deep-links", () => {
    expect(isDrinkShapeArrival("?drink=beer")).toBe(true);
    expect(isDrinkShapeArrival("?cocktails=1")).toBe(true);
    expect(isDrinkShapeArrival("?q=Barnet")).toBe(false);
  });
});

describe("isCuratedCrawlArrival", () => {
  it("detects crawl= or pubs= with mode=build", () => {
    expect(isCuratedCrawlArrival("?crawl=victorian-soho")).toBe(true);
    expect(isCuratedCrawlArrival("?mode=build&pubs=a,b&crawl=victorian-soho")).toBe(true);
    expect(isCuratedCrawlArrival("?mode=build&pubs=venue-1,venue-2")).toBe(true);
    expect(isCuratedCrawlArrival("?mode=build")).toBe(false);
    expect(isCuratedCrawlArrival("?pubs=a,b")).toBe(false);
    expect(isCuratedCrawlArrival("?q=Barnet")).toBe(false);
  });
});

describe("shouldOpenPlanningInitially", () => {
  it("keeps borough browse (?q=) on the clean map without opening the planner", () => {
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Barnet")).toBe(false);
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Croydon")).toBe(false);
  });

  it("keeps drink-shape arrivals on the clean map even with style=/q=", () => {
    expect(shouldOpenPlanningInitially([], "suggest", "?drink=wine&style=heritage")).toBe(false);
    expect(shouldOpenPlanningInitially([], "suggest", "?drink=beer&q=Soho")).toBe(false);
  });

  it("keeps curated crawl arrivals map-first (planner closed)", () => {
    expect(
      shouldOpenPlanningInitially(
        ["a", "b"],
        "build",
        "?mode=build&pubs=a,b&crawl=victorian-soho",
      ),
    ).toBe(false);
    expect(shouldOpenPlanningInitially(["a", "b"], "build", "?mode=build&pubs=a,b")).toBe(false);
    expect(shouldOpenPlanningInitially([], "build", "?crawl=victorian-soho")).toBe(false);
  });

  it("opens the planner for shared crawl / style / build arrivals", () => {
    expect(shouldOpenPlanningInitially(["a", "b"], "suggest", "")).toBe(true);
    expect(shouldOpenPlanningInitially([], "build", "")).toBe(true);
    expect(shouldOpenPlanningInitially([], "suggest", "?style=heritage")).toBe(true);
    // Bare mode=build without pubs still opens (rare; not a curated arrival).
    expect(shouldOpenPlanningInitially([], "suggest", "?mode=build")).toBe(true);
  });
});
