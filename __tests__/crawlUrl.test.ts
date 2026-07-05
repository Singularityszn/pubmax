import { describe, it, expect } from "vitest";

import { encodeCrawl, decodeCrawl, seedCrawlState, type CrawlUrlState } from "@/lib/crawlUrl";
import { initialFilters } from "@/components/map/ControlRail";

const sample: CrawlUrlState = {
  mode: "build",
  filters: {
    ...initialFilters,
    crawlStyle: "heritage",
    maxPrice: 6.5,
    stopCount: 5,
    routeWindow: 25,
  },
  builtIds: ["venue-abc", "venue-def"],
  selectedVenueId: "venue-abc",
};

describe("crawlUrl", () => {
  it("round-trips encode -> decode for a representative state", () => {
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(decoded.mode).toBe("build");
    expect(decoded.filters).toMatchObject({
      crawlStyle: "heritage",
      maxPrice: 6.5,
      stopCount: 5,
      routeWindow: 25,
    });
    expect(decoded.builtIds).toEqual(["venue-abc", "venue-def"]);
    expect(decoded.selectedVenueId).toBe("venue-abc");
  });

  it("seedCrawlState reproduces the captured state atop defaults", () => {
    const seeded = seedCrawlState(`?${encodeCrawl(sample)}`);
    expect(seeded).toEqual({
      mode: sample.mode,
      filters: sample.filters,
      builtIds: sample.builtIds,
      selectedVenueId: sample.selectedVenueId,
    });
  });

  it("decodes garbage without throwing and returns a safe partial", () => {
    const garbage = new URLSearchParams(
      "mode=teleport&style=wizard&max=NaN&stops=999&win=-40&pubs=,,&junk=1",
    );
    const decoded = decodeCrawl(garbage);
    // unknown mode/style dropped; empty pubs dropped
    expect(decoded.mode).toBeUndefined();
    expect(decoded.filters?.crawlStyle).toBeUndefined();
    expect(decoded.filters?.maxPrice).toBeUndefined();
    expect(decoded.builtIds).toBeUndefined();
    // out-of-range numbers clamp to slider bounds, never throw
    expect(decoded.filters?.stopCount).toBe(7); // clamped to max 7
    expect(decoded.filters?.routeWindow).toBe(15); // clamped to min 15
  });

  it("decodes an empty query to an empty partial", () => {
    expect(decodeCrawl(new URLSearchParams(""))).toEqual({});
  });

  it("seeds ?style=heritage from a bare landing-page link", () => {
    const seeded = seedCrawlState("?style=heritage");
    expect(seeded.filters.crawlStyle).toBe("heritage");
    expect(seeded.mode).toBe("suggest");
    expect(seeded.builtIds).toEqual([]);
  });
});
