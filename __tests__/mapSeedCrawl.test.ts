import { describe, expect, it } from "vitest";

import { buildMapSeedWithCuratedCrawl, resolveSeededCuratedCrawl } from "@/lib/mapSeedCrawl";

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
});
