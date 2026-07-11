import { describe, expect, it } from "vitest";

import { filterMapVenues, withForcedVenue } from "@/lib/filterMapVenues";
import { initialFilters } from "@/components/map/ControlRail";
import type { Venue } from "@/lib/venues";

function slimPin(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-scraped",
    name: "The Mayflower",
    address: "Rotherhithe",
    latitude: 51.5,
    longitude: -0.05,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: true,
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
    sourceDatasets: ["london_chain_gazetteer_seed"],
    curation: {},
    filterHints: {
      searchText: "the mayflower",
      amenities: {
        food: true,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        nonAlcoholic: false,
      },
      curation: { nearWater: true, hasStory: true },
      canonical: false,
      scraped: true,
      drinkCategories: ["gin"],
    },
    ...overrides,
  };
}

describe("filterMapVenues", () => {
  it("keeps slim scraped pubs visible even when canonicalOnly is on", () => {
    const filters = { ...initialFilters, canonicalOnly: true };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("venue-scraped");
  });

  it("still respects price query on slim pins", () => {
    const filters = { ...initialFilters, query: "zzzz-no-match" };
    const result = filterMapVenues([slimPin()], filters, () => false);
    expect(result).toHaveLength(0);
  });
});

describe("withForcedVenue", () => {
  it("appends a deep-linked venue missing from the filtered set", () => {
    const forced = slimPin({ id: "venue-force", name: "Forced" });
    const byId = new Map([[forced.id, forced]]);
    const out = withForcedVenue([], byId, "venue-force");
    expect(out.map((v) => v.id)).toEqual(["venue-force"]);
  });

  it("does not duplicate an already-visible venue", () => {
    const venue = slimPin();
    const byId = new Map([[venue.id, venue]]);
    const out = withForcedVenue([venue], byId, venue.id);
    expect(out).toHaveLength(1);
  });
});
