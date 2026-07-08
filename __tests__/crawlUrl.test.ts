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
    requirePintDrops: true,
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
      requirePintDrops: true,
    });
    expect(decoded.builtIds).toEqual(["venue-abc", "venue-def"]);
    expect(decoded.selectedVenueId).toBe("venue-abc");
  });

  it("encodes requirePintDrops as drops=1 and omits it when off", () => {
    expect(encodeCrawl(sample)).toContain("drops=1");
    const off = encodeCrawl({ ...sample, filters: { ...sample.filters, requirePintDrops: false } });
    expect(off).not.toContain("drops");
  });

  it("only drops=1 turns the Pint Drops filter on; other values leave it off", () => {
    expect(decodeCrawl(new URLSearchParams("drops=1")).filters?.requirePintDrops).toBe(true);
    // absent, empty, or any non-"1" value must not enable it (default off)
    expect(decodeCrawl(new URLSearchParams("")).filters?.requirePintDrops).toBeUndefined();
    expect(decodeCrawl(new URLSearchParams("drops=0")).filters?.requirePintDrops).toBeUndefined();
    expect(decodeCrawl(new URLSearchParams("drops=yes")).filters?.requirePintDrops).toBeUndefined();
  });

  it("preserves hand-built stop order (a reversed route stays reversed)", () => {
    const reversed: CrawlUrlState = { ...sample, builtIds: ["venue-def", "venue-abc"] };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(reversed)));
    expect(decoded.builtIds).toEqual(["venue-def", "venue-abc"]);
    // and the reverse of that round-trips back to the original order
    const back = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(back.builtIds).toEqual(["venue-abc", "venue-def"]);
  });

  it("seedCrawlState reproduces the captured state atop defaults", () => {
    const seeded = seedCrawlState(`?${encodeCrawl(sample)}`);
    expect(seeded).toEqual({
      mode: sample.mode,
      filters: sample.filters,
      builtIds: sample.builtIds,
      selectedVenueId: sample.selectedVenueId,
      bandId: "", // additive story-band field, "" when no ?band= in the URL
      altStyle: "pint", // additive alt-style field, defaults to "pint" (issue #31)
    });
  });

  it("round-trips an active story band via ?band=", () => {
    const withBand = { ...sample, bandId: "river-history" };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(withBand)));
    expect(decoded.bandId).toBe("river-history");
    // No band = no param (kept short); seed resolves it to "".
    const bare = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(bare.bandId).toBeUndefined();
    expect(seedCrawlState(`?${encodeCrawl(withBand)}`).bandId).toBe("river-history");
  });

  it("round-trips an alt crawl style via ?alt= (issue #31)", () => {
    const coffee = { ...sample, altStyle: "coffee" as const };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(coffee)));
    expect(decoded.altStyle).toBe("coffee");
    // The default "pint" is omitted from the URL (kept short) and seeds back.
    const pint = { ...sample, altStyle: "pint" as const };
    expect(encodeCrawl(pint)).not.toContain("alt=");
    expect(decodeCrawl(new URLSearchParams(encodeCrawl(pint))).altStyle).toBeUndefined();
    expect(seedCrawlState(`?${encodeCrawl(coffee)}`).altStyle).toBe("coffee");
    // An unknown alt value is ignored (decodes to undefined -> seeds "pint").
    expect(decodeCrawl(new URLSearchParams("alt=wizard")).altStyle).toBeUndefined();
    expect(seedCrawlState("?alt=wizard").altStyle).toBe("pint");
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

  it("seeds drink chooser links into map filters", () => {
    const cocktail = seedCrawlState("?drink=cocktail");
    expect(cocktail.filters.requireCocktails).toBe(true);
    expect(cocktail.filters.query).toBe("");

    const lowNo = seedCrawlState("?drink=low-no&low=1");
    expect(lowNo.filters.requireNonAlcoholic).toBe(true);
    expect(lowNo.altStyle).toBe("mocktail");

    const gin = seedCrawlState("?drink=gin");
    expect(gin.filters.query).toBe("Gin");
  });

  it("round-trips explicit drink search filters", () => {
    const encoded = encodeCrawl({
      ...sample,
      filters: {
        ...sample.filters,
        query: "Lucky Saint",
        requireNonAlcoholic: true,
        requireCocktails: true,
      },
    });
    const decoded = seedCrawlState(`?${encoded}`);
    expect(decoded.filters.query).toBe("Lucky Saint");
    expect(decoded.filters.requireNonAlcoholic).toBe(true);
    expect(decoded.filters.requireCocktails).toBe(true);
  });
});
