import { describe, expect, it } from "vitest";

import { observationToCommunityPrice } from "@/lib/communityPriceObservation";
import {
  mergedCommunityPricesForVenue,
  resetCommunityPriceObservationCacheForTests,
} from "@/lib/communityPriceObservationLoader.server";

describe("community price observation loader", () => {
  it("merges seeded reddit rows over live reads", () => {
    resetCommunityPriceObservationCacheForTests();
    const row = observationToCommunityPrice({
      venueId: "venue-1t2rx3d",
      drinkCategory: "beer",
      drinkName: "Guinness",
      priceGbp: 5.5,
      observedAt: "2024-09-16T18:00:00.000Z",
      source: "reddit",
      sourceUrl: "https://www.reddit.com/r/london/comments/abc/fix1/",
      confidence: 0.78,
    });
    const merged = mergedCommunityPricesForVenue([], "venue-1t2rx3d");
    expect(merged.some((p) => p.evidence?.source === "reddit")).toBe(true);
    expect(merged.find((p) => p.drinkCategory === "beer")?.priceGbp).toBe(row.priceGbp);
  });
});
