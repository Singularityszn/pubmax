import { describe, expect, it } from "vitest";

import { mapSeedNeedsCuratedCrawlLookup } from "@/lib/mapSeedCrawlPolicy";

import {
  buildMapSeedWithCuratedCrawl,
  resolveSeededCuratedCrawl,
  sameCuratedCrawlHydrationSnapshot,
} from "@/lib/mapSeedCrawl";

describe("mapSeedCrawl", () => {
  it("resolves a Manchester crawl id from the city's lazy catalog", async () => {
    const crawl = await resolveSeededCuratedCrawl(
      "manchester",
      "northern-quarter-first-night",
      [],
    );
    expect(crawl?.id).toBe("northern-quarter-first-night");
    expect(crawl?.placeStoryBandId).toBe("northern-quarter");
  });

  it("hydrates a Manchester crawl-shaped arrival", async () => {
    const seed = await buildMapSeedWithCuratedCrawl(
      "?mode=build&crawl=northern-quarter-first-night",
      "manchester",
    );
    expect(seed.activeCrawl?.id).toBe("northern-quarter-first-night");
    expect(seed.routeMapped).toBe(true);
  });

  it("rejects stale hydration after plan or filter edits", async () => {
    const seed = await buildMapSeedWithCuratedCrawl(
      "?mode=build&crawl=northern-quarter-first-night",
      "manchester",
    );
    const current = { ...seed };

    expect(sameCuratedCrawlHydrationSnapshot(seed, current)).toBe(true);
    expect(
      sameCuratedCrawlHydrationSnapshot(seed, { ...current, builtIds: ["different-stop"] }),
    ).toBe(false);
    expect(
      sameCuratedCrawlHydrationSnapshot(seed, {
        ...current,
        filters: { ...current.filters, query: "Ancoats" },
      }),
    ).toBe(false);
    expect(
      sameCuratedCrawlHydrationSnapshot(seed, { ...current, routeMapped: false }),
    ).toBe(false);
  });
});


describe("map arrival catalog eligibility", () => {
  const orderedPubs = "venue-1ufn31x,venue-1t8siin,venue-xiesdn,venue-phqazo,venue-15i2wst";

  it.each(["routeDrink=vodka", "routeLow=1", "routeDrink=vodka&routeLow=1"])(
    "keeps explicit public route intent independent of a matching curated catalog: %s",
    (intent) => {
      expect(mapSeedNeedsCuratedCrawlLookup(`?mode=build&pubs=${orderedPubs}&${intent}`)).toBe(false);
    },
  );

  it.each([
    "",
    "routeDrink=beer",
    "routeDrink=unknown",
    "routeLow=false",
    "routeLow=0",
  ])("preserves ordinary catalog lookup without valid route intent: %s", (intent) => {
    expect(mapSeedNeedsCuratedCrawlLookup(`?mode=build&pubs=${orderedPubs}&${intent}`)).toBe(true);
  });

  it.each([
    "?crawl=victorian-soho",
    "?crawl=victorian-soho&routeDrink=vodka",
    "?crawl=victorian-soho&pubs=%2C,%20&routeDrink=vodka",
  ])("still resolves crawl arrivals without actual ordered public stops: %s", (search) => {
    expect(mapSeedNeedsCuratedCrawlLookup(search)).toBe(true);
  });

  it.each(["drink=wine", "drink=cocktail", "cocktails=1"])(
    "preserves independent drink-lens arrival policy: %s",
    (lens) => {
      expect(mapSeedNeedsCuratedCrawlLookup(`?pubs=${orderedPubs}&${lens}`)).toBe(false);
    },
  );

  it("does not request a curated catalog after route intent and stops are cleared", () => {
    expect(mapSeedNeedsCuratedCrawlLookup("")).toBe(false);
  });
});
