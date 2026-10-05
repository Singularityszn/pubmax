import { describe, expect, it } from "vitest";

import {
  buildMapSeedWithCuratedCrawl,
  curatedCrawlHydrationFromSeed,
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

  it("keeps a completed Beer share on resting filters through deferred curated hydration", async () => {
    const crawl = await resolveSeededCuratedCrawl("manchester", "northern-quarter-first-night", []);
    expect(crawl).not.toBeNull();
    const params = new URLSearchParams({ mode: "build", drink: "beer", crawl: "northern-quarter-first-night", pubs: crawl!.venueIds.join(",") });
    const search = `?${params}`;
    const seed = await buildMapSeedWithCuratedCrawl(search, "manchester");
    expect(seed.activeCrawl?.id).toBe("northern-quarter-first-night");
    expect(seed.routeMapped).toBe(true);
    expect(seed.filters.drinkCategory).toBe("");
    const hydration = await curatedCrawlHydrationFromSeed(search, "manchester");
    expect(hydration?.crawlId).toBe("northern-quarter-first-night");
    expect(hydration?.filters.drinkCategory).toBe("");
    expect(hydration?.routeMapped).toBe(true);
  });

  it("retains clean refined Beer arrivals without deferred hydration", async () => {
    const search = "?mode=build&drink=beer&brand=guinness&pubs=venue-a,venue-b";
    expect((await buildMapSeedWithCuratedCrawl(search)).routeMapped).toBe(false);
    expect(await curatedCrawlHydrationFromSeed(search, "london")).toBeNull();
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
