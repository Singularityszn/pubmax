import { describe, expect, it } from "vitest";

import {
  isBoroughBrowseArrival,
  isCuratedCrawlArrival,
  isDrinkShapeArrival,
  resolveArrivalQueryRestore,
  resolveQueryRestoreFit,
  shouldFitQueryVenuesOnArrival,
  shouldOpenPlanningInitially,
} from "@/lib/mapArrival";

describe("isDrinkShapeArrival", () => {
  it("detects drink= and cocktails=1 deep-links", () => {
    expect(isDrinkShapeArrival("?drink=beer")).toBe(true);
    expect(isDrinkShapeArrival("?cocktails=1")).toBe(true);
    expect(isDrinkShapeArrival("?cocktails=10")).toBe(false);
    expect(isDrinkShapeArrival("?q=Barnet")).toBe(false);
  });
});

describe("unrefined Beer completed-share arrival", () => {
  it("keeps ordered completed Beer stops on the mapped crawl path", () => {
    expect(isDrinkShapeArrival("?mode=build&pubs=venue-a,venue-b&drink=beer")).toBe(false);
  });

  it.each([
    "?drink=beer",
    "?drink=beer&mode=build&pubs=venue-a",
    "?drink=beer&mode=build&pubs=venue-a,venue-a",
    "?drink=beer&mode=build&pubs=,",
    "?drink=beer&pubs=venue-a,venue-b",
    "?drink=wine&mode=build&pubs=venue-a,venue-b",
    "?drink=beer&brand=guinness&mode=build&pubs=venue-a,venue-b",
    "?drink=beer&sub=beer-cider&mode=build&pubs=venue-a,venue-b",
    "?drink=beer&topshelf=1&mode=build&pubs=venue-a,venue-b",
    "?drink=beer&cocktails=1&mode=build&pubs=venue-a,venue-b",
  ])("retains the clean drink arrival for %s", (search) => {
    expect(isDrinkShapeArrival(search)).toBe(true);
  });

  it("does not confuse parameter prefixes with the completed Beer contract", () => {
    expect(isDrinkShapeArrival("?drink=beers&mode=build&pubs=venue-a,venue-b")).toBe(true);
    expect(isDrinkShapeArrival("?drink=beer&mode=builder&pubs=venue-a,venue-b")).toBe(true);
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

describe("isBoroughBrowseArrival", () => {
  it("detects ?q= without drink/crawl/pubs intent", () => {
    expect(isBoroughBrowseArrival("?q=Barnet")).toBe(true);
    expect(isBoroughBrowseArrival("?q=Barnet&mode=suggest")).toBe(true);
    expect(isBoroughBrowseArrival("?q=Croydon&style=heritage")).toBe(true);
    expect(isBoroughBrowseArrival("")).toBe(false);
    expect(isBoroughBrowseArrival("?band=subcrawl")).toBe(false);
  });

  it("excludes drink / crawl / pubs arrivals that also carry q=", () => {
    expect(isBoroughBrowseArrival("?drink=beer&q=Soho")).toBe(false);
    expect(isBoroughBrowseArrival("?cocktails=1&q=Barnet")).toBe(false);
    expect(isBoroughBrowseArrival("?crawl=victorian-soho&q=Soho")).toBe(false);
    expect(isBoroughBrowseArrival("?mode=build&pubs=a,b&q=Soho")).toBe(false);
    expect(isBoroughBrowseArrival("?pubs=a,b&q=Barnet")).toBe(false);
  });
});

describe("shouldFitQueryVenuesOnArrival", () => {
  it("fits query venues for borough browse only", () => {
    expect(shouldFitQueryVenuesOnArrival("?q=Barnet")).toBe(true);
    expect(shouldFitQueryVenuesOnArrival("?q=Barnet&mode=suggest")).toBe(true);
    expect(shouldFitQueryVenuesOnArrival("")).toBe(false);
    expect(shouldFitQueryVenuesOnArrival("?drink=beer&q=Soho")).toBe(false);
    expect(shouldFitQueryVenuesOnArrival("?band=subcrawl")).toBe(false);
  });
});

describe("resolveQueryRestoreFit", () => {
  it("mirrors typed search: one match selects, several fit, zero stays put", () => {
    expect(resolveQueryRestoreFit(1)).toBe("select-single");
    expect(resolveQueryRestoreFit(8)).toBe("fit-many");
    expect(resolveQueryRestoreFit(2)).toBe("fit-many");
  });

  it("never moves the camera or claims pins for a zero-result restore", () => {
    expect(resolveQueryRestoreFit(0)).toBe("none");
    expect(resolveQueryRestoreFit(-1)).toBe("none");
  });
});

describe("resolveArrivalQueryRestore", () => {
  const base = {
    arrivalSearch: "?q=The+Ice+Wharf",
    currentQuery: "The Ice Wharf",
    mapReady: true,
    selectedVenueId: "",
    didRestore: false,
  };

  it("waits for the map and matching pins while the arrival query still owns search", () => {
    expect(resolveArrivalQueryRestore({ ...base, mapReady: false, matchCount: 1 })).toBe("wait");
    expect(resolveArrivalQueryRestore({ ...base, matchCount: 0 })).toBe("wait");
  });

  it("selects one match and fits several matches while the arrival query still owns search", () => {
    expect(resolveArrivalQueryRestore({ ...base, matchCount: 1 })).toBe("select-single");
    expect(resolveArrivalQueryRestore({ ...base, matchCount: 4 })).toBe("fit-many");
  });

  it("retires restoration when the reader clears or changes the arrival query", () => {
    expect(resolveArrivalQueryRestore({ ...base, currentQuery: "", matchCount: 953 })).toBe(
      "retire",
    );
    expect(resolveArrivalQueryRestore({ ...base, currentQuery: "Camden", matchCount: 38 })).toBe(
      "retire",
    );
  });

  it("retires a q parameter that belongs to another arrival intent", () => {
    expect(
      resolveArrivalQueryRestore({
        ...base,
        arrivalSearch: "?drink=beer&q=The+Ice+Wharf",
        matchCount: 1,
      }),
    ).toBe("retire");
  });

  it("retires restoration when a Venue selection already owns the camera", () => {
    expect(
      resolveArrivalQueryRestore({
        ...base,
        selectedVenueId: "venue-17u2i1w",
        matchCount: 1,
      }),
    ).toBe("retire");
  });

  it("does not replay a completed restoration", () => {
    expect(resolveArrivalQueryRestore({ ...base, didRestore: true, matchCount: 1 })).toBe(
      "retire",
    );
  });
});

describe("shouldOpenPlanningInitially", () => {
  it("opens for the explicit primary planning intent", () => {
    expect(shouldOpenPlanningInitially([], "suggest", "?plan=1")).toBe(true);
    expect(shouldOpenPlanningInitially([], "suggest", "?drink=beer&plan=1")).toBe(true);
  });

  it("keeps borough browse (?q=) on the clean map without opening the planner", () => {
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Barnet")).toBe(false);
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Croydon")).toBe(false);
    // mode=/style= still map-first for borough browse
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Barnet&mode=suggest")).toBe(false);
    expect(shouldOpenPlanningInitially([], "suggest", "?q=Barnet&style=heritage")).toBe(false);
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

  it("borough browse with mode=suggest: planner closed and query fit true", () => {
    const search = "?q=Barnet&mode=suggest";
    expect(shouldOpenPlanningInitially([], "suggest", search)).toBe(false);
    expect(shouldFitQueryVenuesOnArrival(search)).toBe(true);
  });

  it("drink+q is still drink arrival (not borough browse)", () => {
    const search = "?drink=beer&q=Soho";
    expect(isDrinkShapeArrival(search)).toBe(true);
    expect(isBoroughBrowseArrival(search)).toBe(false);
    expect(shouldOpenPlanningInitially([], "suggest", search)).toBe(false);
    expect(shouldFitQueryVenuesOnArrival(search)).toBe(false);
  });
});
