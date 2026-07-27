import { describe, expect, it } from "vitest";

import {
  experienceLensSummary,
  filtersForExperienceLens,
  filterVenuesForExperienceLens,
  lensPriceForVenue,
  trustedNoAlcoholLensPrices,
} from "@/lib/mapExperienceLens";
import type { CommunityPrice } from "@/lib/communityPrice";
import { CATEGORY_META } from "@/lib/drinks";
import type { Venue } from "@/lib/venues";
import type { Filters } from "@/lib/venues";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "pub-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: 6.2,
    cheapestPint: "Lager",
    averagePrice: 6.2,
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
    kind: "pub",
    ...overrides,
  } as Venue;
}

function price(
  drinkCategory: CommunityPrice["drinkCategory"],
  priceGbp: number,
  overrides: Partial<CommunityPrice> = {},
): CommunityPrice {
  return {
    venueId: "pub-1",
    drinkCategory,
    priceGbp,
    submittedAt: 2_000,
    source: "community",
    corroborations: 2,
    mapCandidate: { priceGbp, submittedAt: 2_000, corroborations: 2 },
    ...overrides,
  };
}

describe("no-alcohol lens price policy", () => {
  it("accepts only current corroborated soft-drink and alcohol-free candidates", () => {
    const rows = new Map<string, CommunityPrice[]>([
      ["pub-1", [
        price("beer", 6.2),
        price("soft-drink", 3.2),
        price("alcohol-free", 5, {
          corroborations: 1,
          mapCandidate: { priceGbp: 5, submittedAt: 2_000, corroborations: 1 },
        }),
      ]],
    ]);

    expect(trustedNoAlcoholLensPrices(rows, 3_000).get("pub-1")).toMatchObject({
      venueId: "pub-1",
      category: "soft-drink",
      priceGbp: 3.2,
      submittedAt: 2_000,
    });
  });

  it("chooses the cheapest trusted no-alcohol option, then the fresher tie", () => {
    const rows = new Map<string, CommunityPrice[]>([
      ["pub-1", [
        price("soft-drink", 3.2, {
          submittedAt: 1_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 1_000, corroborations: 2 },
        }),
        price("alcohol-free", 4.8),
      ]],
      ["pub-2", [
        price("soft-drink", 3.2, {
          venueId: "pub-2",
          submittedAt: 1_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 1_000, corroborations: 2 },
        }),
        price("alcohol-free", 3.2, {
          venueId: "pub-2",
          submittedAt: 2_000,
          mapCandidate: { priceGbp: 3.2, submittedAt: 2_000, corroborations: 2 },
        }),
      ]],
    ]);

    const result = trustedNoAlcoholLensPrices(rows, 3_000);
    expect(result.get("pub-1")?.category).toBe("soft-drink");
    expect(result.get("pub-2")?.category).toBe("alcohol-free");
  });
});

describe("experience lens venue membership and presentation", () => {
  const pub = venue();
  const knownNoAlcohol = venue({
    id: "known",
    amenities: { ...venue().amenities, nonAlcoholic: true },
  });
  const food = venue({
    id: "food",
    kind: "food",
    cheapestPrice: 9.5,
    anchorLabel: "Halloumi wrap",
    anchorObservedAt: "2026-07-20",
    anchorSourceUrl: "https://example.com/menu",
  });
  const restaurantUnknown = venue({
    id: "restaurant",
    kind: "restaurant",
    cheapestPrice: 14,
    anchorLabel: undefined,
    anchorObservedAt: undefined,
    anchorSourceUrl: undefined,
  });
  const lensPrices = new Map([
    ["pub-1", {
      venueId: "pub-1",
      category: "soft-drink" as const,
      categoryLabel: "Soft drinks",
      priceGbp: 3.2,
      submittedAt: 2_000,
      source: "community" as const,
    }],
  ]);

  it("shows known no-alcohol pubs plus food places, and food view only food kinds", () => {
    const all = [pub, knownNoAlcohol, food, restaurantUnknown];
    expect(
      filterVenuesForExperienceLens(all, "no-alcohol", lensPrices).map((row) => row.id),
    ).toEqual(["pub-1", "known", "food", "restaurant"]);
    expect(
      filterVenuesForExperienceLens(all, "food", lensPrices).map((row) => row.id),
    ).toEqual(["food", "restaurant"]);
  });

  it("shows no-alcohol community prices and only complete sourced food anchors", () => {
    expect(lensPriceForVenue(pub, "no-alcohol", lensPrices)).toMatchObject({
      priceGbp: 3.2,
      categoryLabel: "Soft drinks",
      source: "community",
    });
    expect(lensPriceForVenue(food, "food", lensPrices)).toMatchObject({
      priceGbp: 9.5,
      categoryLabel: "Halloumi wrap",
      source: "sourced-anchor",
    });
    expect(lensPriceForVenue(restaurantUnknown, "food", lensPrices)).toBeNull();
  });

  it("names the community category exactly as the submit chips do", () => {
    // Logging under "Soft drinks" and reading back "Soft drink" is the same
    // category wearing two names on surfaces a user sees side by side.
    expect(CATEGORY_META["soft-drink"].label).toBe("Soft drinks");
    expect(
      lensPriceForVenue(pub, "no-alcohol", lensPrices)?.categoryLabel,
    ).toBe(CATEGORY_META["soft-drink"].label);
  });

  it("states honest empty and degraded results", () => {
    expect(experienceLensSummary("no-alcohol", 0, 1, "ready")).toBe(
      "No soft-drink or alcohol-free prices logged here yet. Food venues still show sourced menu prices.",
    );
    expect(experienceLensSummary("no-alcohol", 0, 1, "degraded")).toBe(
      "Could not check no-alcohol prices right now. Food venues still show sourced menu prices.",
    );
    expect(experienceLensSummary("food", 0, 0, "ready")).toBe(
      "Food venues shown. No sourced menu prices in this view yet.",
    );
  });

  it("never calls a partial read a failed one", () => {
    // A truncated scan ANSWERED, and its rows are already painted. Borrowing
    // the "could not check" sentence would call those figures unchecked.
    const partial = experienceLensSummary("no-alcohol", 4, 1, "partial");
    expect(partial).toContain("4 no-alcohol prices shown");
    expect(partial).toContain("part of the list");
    expect(partial).not.toContain("Could not check");
    expect(experienceLensSummary("no-alcohol", 0, 1, "partial")).not.toBe(
      experienceLensSummary("no-alcohol", 0, 1, "degraded"),
    );
    expect(experienceLensSummary("no-alcohol", 0, 1, "partial")).not.toBe(
      experienceLensSummary("no-alcohol", 0, 1, "ready"),
    );
  });
});

describe("experience lens filter isolation", () => {
  const filters = {
    query: "King's Cross",
    maxPrice: 5,
    zone: "1",
    drinkCategory: "beer",
    drinkBrand: "guinness",
    drinkSubtype: "beer-stout",
    topShelfOnly: true,
    requireCocktails: true,
    requirePintDrops: true,
  } as Filters;

  it("leaves ordinary map filters untouched in the all view", () => {
    expect(filtersForExperienceLens(filters, "all")).toBe(filters);
  });

  it("keeps place search but removes hidden pint and drink constraints", () => {
    expect(filtersForExperienceLens(filters, "no-alcohol")).toMatchObject({
      query: "King's Cross",
      maxPrice: Number.POSITIVE_INFINITY,
      zone: "",
      drinkCategory: "",
      drinkBrand: "",
      drinkSubtype: "",
      topShelfOnly: false,
      requireCocktails: false,
      requirePintDrops: false,
    });
  });
});
