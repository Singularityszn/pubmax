import { describe, expect, it } from "vitest";

import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import type { Venue } from "@/lib/venues";

function venue(id: string, name = id): Venue {
  return {
    id,
    name,
    address: "",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [],
    cheapestPrice: 5.5,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
  };
}

describe("mergeLazyDetailPins", () => {
  it("replaces slim pins with loaded venue detail", () => {
    const slim = venue("venue-a", "Slim A");
    const detail = venue("venue-a", "Detail A");

    expect(mergeLazyDetailPins([slim], new Map([["venue-a", detail]]))).toEqual([detail]);
  });

  it("keeps the pin's fare zone when the detail record carries none", () => {
    const slim: Venue = { ...venue("venue-a", "Slim A"), zone: 4 };
    const detail = venue("venue-a", "Detail A");

    expect(mergeLazyDetailPins([slim], new Map([["venue-a", detail]]))).toEqual([
      { ...detail, zone: 4 },
    ]);
  });

  it("keeps selected deep-link detail resolvable when the slim index cache is stale", () => {
    const slim = venue("venue-a", "Slim A");
    const detail = venue("venue-b", "Detail B");

    expect(mergeLazyDetailPins([slim], new Map([["venue-b", detail]])).map((item) => item.id))
      .toEqual(["venue-a", "venue-b"]);
  });

  it("never pins a retired pub a shared crawl link hydrated", () => {
    const slim = venue("venue-a", "Slim A");
    const retired: Venue = { ...venue("venue-bhm-17j3xm7", "The Duck"), retired: true };

    expect(
      mergeLazyDetailPins([slim], new Map([["venue-bhm-17j3xm7", retired]])).map((item) => item.id),
    ).toEqual(["venue-a"]);
  });
});
