import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

import { observationToCommunityPrice } from "@/lib/communityPriceObservation";
import {
  mergedCommunityPricesForVenue,
  resetCommunityPriceObservationCacheForTests,
} from "@/lib/communityPriceObservationLoader.server";

describe("community price observation loader", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
    resetCommunityPriceObservationCacheForTests();
  });
  it("merges seeded reddit rows over live reads", () => {
    const seed = {
      venueId: "venue-1t2rx3d",
      drinkCategory: "beer" as const,
      drinkName: "Guinness",
      priceGbp: 5.5,
      observedAt: "2024-09-16T18:00:00.000Z",
      source: "reddit" as const,
      sourceUrl: "https://www.reddit.com/r/london/comments/1abc234/pints/mabc234/",
      confidence: 0.78,
    };
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ observations: [seed] }));
    const row = observationToCommunityPrice(seed);
    const merged = mergedCommunityPricesForVenue([], "venue-1t2rx3d");
    expect(merged.some((p) => p.evidence?.source === "reddit")).toBe(true);
    expect(merged.find((p) => p.drinkCategory === "beer")?.priceGbp).toBe(row.priceGbp);
  });
  it("does not require a production fixture row", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ observations: [] }));
    expect(mergedCommunityPricesForVenue([], "venue-1t2rx3d")).toEqual([]);
  });
});
