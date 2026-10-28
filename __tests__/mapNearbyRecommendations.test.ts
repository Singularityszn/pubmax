import { describe, expect, it } from "vitest";
import { rankMapNearbyRecommendations, resolveMapNearbyFilters, type NearbyPrice } from "@/lib/mapNearbyRecommendations";
import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { initialFilters, type Venue } from "@/lib/venues";

function pub(id: string, latitude: number, price: number | null, overrides: Partial<Venue> = {}): Venue {
  return {
    id, name: `The ${id}`, address: "London", latitude, longitude: -0.1,
    primaryBorough: "Camden", visibleBoroughs: [], prices: [], cheapestPrice: price,
    cheapestPint: "Lager", averagePrice: price, hasStory: false,
    latestContributorPrice: null, latestContributorAt: null,
    amenities: { food: false, cocktails: false, beerGarden: false, liveSports: false, liveMusic: false, pubQuiz: false, darts: false, pool: false, happyHour: false, karaoke: false, nonAlcoholic: false },
    website: "", bookingLink: "", imageUrl: "", description: "", dataQualityNotes: [], sourceDatasets: [], curation: {},
    ...overrides,
  };
}
const location = { lat: 51.5, lng: -0.1 };
const priceForVenue = (venue: Venue): NearbyPrice | null => venue.cheapestPrice === null ? null : {
  priceGbp: venue.cheapestPrice, drinkLabel: venue.cheapestPint, measureLabel: "pint", category: "beer",
};
const rank = (venues: Venue[], extra: Partial<Parameters<typeof rankMapNearbyRecommendations>[0]> = {}) =>
  rankMapNearbyRecommendations({ location, venues, filters: initialFilters, priceForVenue, ...extra });

function profile(context: Partial<typeof DEFAULT_NIGHT_PROFILE_INPUT.context>) {
  return { ...DEFAULT_NIGHT_PROFILE_INPUT, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, ...context } };
}

describe("map nearby recommendations", () => {
  it("returns the cheapest pub and nearest equally matching pub with their exact prices", () => {
    const result = rank([pub("Cheap", 51.506, 3), pub("Near", 51.501, 5), pub("Unknown", 51.5001, null)]);
    expect(result.scope).toBe("walkable");
    expect(result.cards.map((card) => [card.venue.id, card.price.priceGbp, card.roles])).toEqual([
      ["Cheap", 3, ["cheapest"]], ["Near", 5, ["best-match"]],
    ]);
    expect(result.cards[0]!.price).toMatchObject({ drinkLabel: "Lager", measureLabel: "pint" });
  });

  it("merges the two roles when the cheapest pub is also the closest match", () => {
    const result = rank([pub("Both", 51.501, 3), pub("Other", 51.506, 5)]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.roles).toEqual(["cheapest", "best-match"]);
  });

  it("uses recorded preference matches before distance without claiming inferred quietness", () => {
    const historical = pub("Historic", 51.507, 5, { hasStory: true });
    const result = rank([pub("Near", 51.501, 3), historical], { savedProfile: profile({ atmosphere: ["historic", "quiet"] }) });
    expect(result.cards[1]!.venue.id).toBe("Historic");
    expect(result.cards[1]!.reasons).toEqual(["Heritage on record"]);
  });

  it("never returns an unknown, negative or non-public price candidate", () => {
    const result = rank([pub("Unknown", 51.501, null), pub("Invalid", 51.502, -1), pub("Private", 51.503, 1, { name: "Members Club" })]);
    expect(result.cards).toEqual([]);
  });

  it("keeps missing access evidence out and preserves an explicit false override", () => {
    const savedProfile = profile({ accessibility: ["step-free"] });
    expect(rank([pub("Unchecked", 51.501, 3)], { savedProfile }).cards).toEqual([]);
    const result = rank([pub("Unchecked", 51.501, 3)], { savedProfile, currentFilterKeys: ["requireStepFree"] });
    expect(result.cards[0]!.venue.id).toBe("Unchecked");
    expect(result.filters.requireStepFree).toBe(false);
  });

  it("does not convert a whole-night budget to a pint cap or ignore a dietary restriction", () => {
    const resolved = resolveMapNearbyFilters(initialFilters, profile({ budgetLimitPence: 300, foodNeeds: ["vegan"] }));
    expect(resolved.filters.maxPrice).toBe(initialFilters.maxPrice);
    expect(resolved.blockedConstraints).toEqual(["vegan"]);
    expect(resolved.unassessedPreferences).toContain("whole-night budget");
    expect(rank([pub("Unchecked", 51.501, 3)], { savedProfile: profile({ foodNeeds: ["vegan"] }) }).cards).toEqual([]);
  });

  it("does not search beyond 2.5 km without an explicit farther radius", () => {
    const far = pub("Far", 51.53, 2);
    expect(rank([far]).cards).toEqual([]);
    const explicit = rank([far], { fartherRadiusKm: 4 });
    expect(explicit.scope).toBe("farther");
    expect(explicit.cards[0]!.venue.id).toBe("Far");
  });

  it("labels widened results and does not substitute an unrelated drink price", () => {
    const venue = pub("Further", 51.515, 3);
    expect(rank([venue]).scope).toBe("widened");
    expect(rank([venue], { filters: { ...initialFilters, drinkCategory: "gin" } }).cards).toEqual([]);
  });

  it("uses the chosen price rather than an unrelated pint when applying the cap", () => {
    const venue = pub("Gin", 51.501, 12, { description: "Gin" });
    const selected: NearbyPrice = { category: "gin", drinkLabel: "House gin", measureLabel: "25 ml", priceGbp: 4 };
    const result = rank([venue], { filters: { ...initialFilters, drinkCategory: "gin" }, priceForVenue: () => selected });
    expect(result.cards[0]!.price).toEqual(selected);
  });

  it("rejects invalid coordinates and keeps an explicit beer price cap", () => {
    expect(rank([pub("Pub", 51.501, 5)], { location: { lat: NaN, lng: -0.1 } }).cards).toEqual([]);
    expect(rank([pub("Pub", 51.501, 5)], { filters: { ...initialFilters, maxPrice: 4 } }).cards).toEqual([]);
  });
});

describe("current drink choices", () => {
  it("lets a current brand or explicit reset override a saved drink category", () => {
    const savedProfile = profile({ drinkCategory: "gin", zeroProof: true });
    const brand = resolveMapNearbyFilters({ ...initialFilters, drinkBrand: "guinness" }, savedProfile);
    expect(brand.filters.drinkCategory).toBe("");
    expect(brand.filters.requireNonAlcoholic).toBe(false);
    const reset = resolveMapNearbyFilters(initialFilters, savedProfile, ["drinkCategory"]);
    expect(reset.filters.drinkCategory).toBe("");
    expect(reset.filters.requireNonAlcoholic).toBe(false);
  });
});


describe("nearby evidence and local scope", () => {
  it("accepts an exact trusted drink price when the old venue menu lacks its selectors", () => {
    const venue = pub("Local", 51.501, 3);
    const selected: NearbyPrice = {
      category: "gin", drinkLabel: "Community gin", measureLabel: "", priceGbp: 4,
      sourceLabel: "Community report", sourceUrl: "https://example.com/report",
      observedAt: "2026-10-28", servingKnown: false,
    };
    const result = rank([venue], {
      filters: { ...initialFilters, drinkCategory: "gin", drinkBrand: "hendricks", drinkSubtype: "gin-london-dry" },
      priceForVenue: () => selected,
    });
    expect(result.cards[0]!.price).toEqual(selected);
    expect(result.cards[0]!.price.servingKnown).toBe(false);
  });

  it("keeps a local match when a cheaper pub exists outside the walking radius", () => {
    const result = rank([pub("Local", 51.501, 6), pub("Further", 51.515, 2)]);
    expect(result.scope).toBe("walkable");
    expect(result.radiusKm).toBe(1);
    expect(result.cards.map((card) => card.venue.id)).toEqual(["Local"]);
    expect(result.cards[0]!.roles).toEqual(["cheapest", "best-match"]);
  });

  it("retains amenity constraints when a trusted selected drink price exists", () => {
    const result = rank([pub("Unchecked", 51.501, 3)], {
      filters: { ...initialFilters, requireFood: true },
    });
    expect(result.cards).toEqual([]);
  });
});

describe("trusted no-alcohol price evidence", () => {
  it("does not require a legacy amenity hint when the exact selected price proves the drink", () => {
    const result = rank([pub("Soft", 51.501, 3)], {
      filters: { ...initialFilters, requireNonAlcoholic: true },
      priceForVenue: () => ({ priceGbp: 4, drinkLabel: "Soft drinks", measureLabel: "", servingKnown: false, category: "soft-drink" }),
    });
    expect(result.cards[0]!.price.category).toBe("soft-drink");
  });
});
