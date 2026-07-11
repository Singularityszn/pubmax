import { describe, expect, it } from "vitest";

import {
  narrateCrawl,
  rankConciergeVenues,
  type ConciergeVenue,
} from "@/lib/concierge/rank";

function venue(
  id: string,
  overrides: Partial<ConciergeVenue> = {},
): ConciergeVenue {
  return {
    id,
    name: `Venue ${id}`,
    area: "City of London",
    lat: 51.51,
    lng: -0.09,
    cheapestPrice: 6.5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...overrides,
  };
}

describe("rankConciergeVenues", () => {
  it("deterministically chooses a quiet, inexpensive Bank option", () => {
    const candidates = [
      venue("lively", {
        name: "The Loud One",
        area: "Bank",
        cheapestPrice: 7.8,
        amenities: { beerGarden: false, cocktails: true, food: false, liveSports: true, liveMusic: true },
      }),
      venue("quiet", {
        name: "The Snug",
        area: "Bank",
        cheapestPrice: 5.2,
        hasStory: true,
        amenities: { beerGarden: false, cocktails: false, food: true, liveSports: false, liveMusic: false },
      }),
      venue("cheap-far", { area: "Camden", cheapestPrice: 4.9 }),
    ];

    const input = {
      mood: ["quiet" as const],
      groupSize: 4,
      area: "Bank",
      maxPintPrice: 6,
    };
    const first = rankConciergeVenues(candidates, input, { limit: 3 });
    const second = rankConciergeVenues([...candidates].reverse(), input, { limit: 3 });

    expect(first.map((result) => result.venue.id)).toEqual(["quiet", "lively"]);
    expect(second).toEqual(first);
    expect(first[0]?.reasons).toContain("In Bank");
    expect(first[0]?.reasons).toContain("£5.20 is within budget");
  });

  it("returns no venues rather than silently moving the crew to another area", () => {
    const results = rankConciergeVenues(
      [venue("camden", { area: "Camden", searchText: "camden town" })],
      { mood: ["balanced"], groupSize: 4, area: "Bank" },
    );
    expect(results).toEqual([]);
  });

  it("uses explicit weather context to prefer gardens on a warm, dry evening", () => {
    const results = rankConciergeVenues(
      [
        venue("inside", { cheapestPrice: 5.5, hasStory: true }),
        venue("garden", {
          cheapestPrice: 5.5,
          amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false },
        }),
      ],
      { mood: [], groupSize: 3 },
      { context: { weather: "warm-dry", dayType: "weekday", timeOfDay: "evening" } },
    );

    expect(results[0]?.venue.id).toBe("garden");
    expect(results[0]?.reasons).toContain("Garden weather");
  });

  it("never includes promoted venues in the honest concierge ranking", () => {
    const results = rankConciergeVenues(
      [
        venue("organic", { cheapestPrice: 6 }),
        venue("ad", { cheapestPrice: 1, promoted: true, amenities: { beerGarden: true, cocktails: true, food: true, liveSports: true, liveMusic: true } }),
      ],
      { mood: ["garden"], groupSize: 2 },
    );

    expect(results.map((result) => result.venue.id)).toEqual(["organic"]);
  });

  it("narrates a two-stop crawl without an empty middle stop", () => {
    const results = rankConciergeVenues(
      [venue("first", { name: "The First" }), venue("last", { name: "The Last" })],
      { mood: [], groupSize: 2 },
      { limit: 2 },
    );

    expect(narrateCrawl(results)).toBe("Start at The First, then finish at The Last.");
  });
});
