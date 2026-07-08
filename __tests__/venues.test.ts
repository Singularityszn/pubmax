import { describe, it, expect } from "vitest";
import {
  groupVenuePrices,
  filterVenues,
  scoreVenue,
  buildCrawlRoute,
  crawlSummary,
  mergeVenueDrops,
  formatFreshness,
  stableVenueIdFromKey,
  venueGroupingKey,
  type SummaryDrop,
  type VenuePrice,
  type Filters,
} from "@/lib/venues";

function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

function makeFilters(overrides: Partial<Filters> = {}): Filters {
  return {
    query: "",
    maxPrice: 100,
    crawlStyle: "balanced",
    stopCount: 4,
    routeWindow: 25,
    requireBeerGarden: false,
    requireNonAlcoholic: false,
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requirePintDrops: false,
    requireHeritage: false,
    requireStepFree: false,
    requireAccessibleToilet: false,
    requireSeatedService: false,
    canonicalOnly: false,
    drinkCategory: "",
    drinkBrand: "",
    ...overrides,
  };
}

describe("groupVenuePrices", () => {
  it("collapses rows with same pub_name+address+lat+lng into one venue", () => {
    const venues = groupVenuePrices([
      makeRow({ pint_name: "Lager", price_gbp: 6 }),
      makeRow({ pint_name: "Ale", price_gbp: 5 }),
    ]);
    expect(venues).toHaveLength(1);
    expect(venues[0].prices).toHaveLength(2);
  });

  it("cheapestPrice is the min numeric price and a null never wins", () => {
    const venues = groupVenuePrices([
      makeRow({ price_gbp: 7 }),
      makeRow({ price_gbp: null }),
      makeRow({ price_gbp: 4.5 }),
    ]);
    expect(venues[0].cheapestPrice).toBe(4.5);
  });

  it("all-null prices yield null cheapestPrice", () => {
    const venues = groupVenuePrices([makeRow({ price_gbp: null })]);
    expect(venues[0].cheapestPrice).toBeNull();
  });

  it("OR's amenities across the group's rows", () => {
    const venues = groupVenuePrices([
      makeRow({ beer_garden: "" }),
      makeRow({ beer_garden: "yes" }),
    ]);
    expect(venues[0].amenities.beerGarden).toBe(true);
  });

  it("attaches curation", () => {
    const venues = groupVenuePrices([makeRow()]);
    expect(venues[0].curation).toBeDefined();
  });

  it("uses stable venue ids from the grouping key instead of array order", () => {
    const left = makeRow({ pub_name: "The Crown", address: "1 High Street", latitude: 51.5 });
    const right = makeRow({ pub_name: "The Anchor", address: "2 River Road", latitude: 51.6 });

    const original = groupVenuePrices([left, right]);
    const reversed = groupVenuePrices([right, left]);

    expect(original.find((venue) => venue.name === "The Crown")?.id).toBe(
      reversed.find((venue) => venue.name === "The Crown")?.id,
    );
    expect(original.find((venue) => venue.name === "The Crown")?.id).toBe(
      stableVenueIdFromKey(venueGroupingKey(left)),
    );
  });
});

describe("filterVenues", () => {
  it("query matches name", () => {
    const venues = groupVenuePrices([makeRow({ pub_name: "The Grapes" })]);
    expect(filterVenues(venues, makeFilters({ query: "grapes" }))).toHaveLength(1);
    expect(filterVenues(venues, makeFilters({ query: "nomatch" }))).toHaveLength(0);
  });

  it("query matches borough", () => {
    const venues = groupVenuePrices([makeRow({ primary_borough: "Hackney" })]);
    expect(filterVenues(venues, makeFilters({ query: "hackney" }))).toHaveLength(1);
  });

  it("maxPrice excludes pricier venues but a null-price venue passes", () => {
    const pricey = groupVenuePrices([makeRow({ address: "A", price_gbp: 9 })]);
    const nullPrice = groupVenuePrices([makeRow({ address: "B", price_gbp: null })]);
    expect(filterVenues(pricey, makeFilters({ maxPrice: 6 }))).toHaveLength(0);
    expect(filterVenues(nullPrice, makeFilters({ maxPrice: 6 }))).toHaveLength(1);
  });

  it("requireWater gates on curation", () => {
    const water = groupVenuePrices([makeRow({ address: "Wapping Wall" })]);
    const dry = groupVenuePrices([makeRow({ address: "Somewhere Dry" })]);
    expect(filterVenues(water, makeFilters({ requireWater: true }))).toHaveLength(1);
    expect(filterVenues(dry, makeFilters({ requireWater: true }))).toHaveLength(0);
  });

  it("requireHeritage gates on curation", () => {
    const heritage = groupVenuePrices([makeRow({ pub_name: "The Lamb" })]);
    const plain = groupVenuePrices([makeRow({ pub_name: "The Nothing" })]);
    expect(filterVenues(heritage, makeFilters({ requireHeritage: true }))).toHaveLength(1);
    expect(filterVenues(plain, makeFilters({ requireHeritage: true }))).toHaveLength(0);
  });

  it("canonicalOnly requires a canonical row", () => {
    const canonical = groupVenuePrices([makeRow({ is_clean_canonical_app_row: true })]);
    const nonCanonical = groupVenuePrices([makeRow({ is_clean_canonical_app_row: false })]);
    expect(filterVenues(canonical, makeFilters({ canonicalOnly: true }))).toHaveLength(1);
    expect(filterVenues(nonCanonical, makeFilters({ canonicalOnly: true }))).toHaveLength(0);
  });

  it("uses slim filter hints before venue detail rows hydrate", () => {
    const [venue] = groupVenuePrices([makeRow({ pub_name: "The Anchor", price_gbp: 5 })]);
    const slim = {
      ...venue,
      prices: [],
      cheapestPint: "",
      amenities: {
        ...venue.amenities,
        cocktails: false,
        nonAlcoholic: false,
      },
      curation: {},
      hasStory: false,
      filterHints: {
        searchText: "the anchor bankside wine cocktails low no",
        amenities: {
          food: false,
          cocktails: true,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: true,
        },
        curation: {
          nearWater: true,
          hasStory: true,
        },
        canonical: true,
      },
    };

    expect(filterVenues([slim], makeFilters({ query: "wine" }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireCocktails: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireNonAlcoholic: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireWater: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ requireHeritage: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ canonicalOnly: true }))).toHaveLength(1);
    expect(filterVenues([slim], makeFilters({ query: "vodka" }))).toHaveLength(0);
  });

  it("matches drinkCategory / drinkBrand via hints and search text", () => {
    const [base] = groupVenuePrices([makeRow({ pub_name: "The Spirit Arms", price_gbp: 5 })]);
    const ginVenue = {
      ...base,
      prices: [],
      cheapestPint: "",
      amenities: { ...base.amenities, cocktails: false },
      filterHints: {
        searchText: "the spirit arms sipsmith gin",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["gin"],
        drinkBrands: ["sipsmith"],
      },
    };
    const beerOnly = {
      ...base,
      id: "venue-beer-only",
      prices: [],
      cheapestPint: "",
      amenities: { ...base.amenities, cocktails: false },
      filterHints: {
        searchText: "lager pint guinness",
        amenities: {
          food: false,
          cocktails: false,
          beerGarden: false,
          liveSports: false,
          nonAlcoholic: false,
        },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        drinkCategories: ["beer"],
        drinkBrands: ["guinness"],
      },
    };

    expect(filterVenues([ginVenue], makeFilters({ drinkCategory: "gin" }))).toHaveLength(1);
    expect(filterVenues([beerOnly], makeFilters({ drinkCategory: "gin" }))).toHaveLength(0);
    expect(
      filterVenues([ginVenue], makeFilters({ drinkCategory: "gin", drinkBrand: "sipsmith" })),
    ).toHaveLength(1);
    expect(
      filterVenues([ginVenue], makeFilters({ drinkCategory: "gin", drinkBrand: "tanqueray" })),
    ).toHaveLength(0);
    expect(filterVenues([beerOnly], makeFilters({ drinkBrand: "guinness" }))).toHaveLength(1);
  });

  it("treats cocktail amenity as a drinkCategory=cocktail match", () => {
    const [venue] = groupVenuePrices([
      makeRow({ pub_name: "Cocktail Corner", cocktails: "yes", price_gbp: 6 }),
    ]);
    expect(filterVenues([venue], makeFilters({ drinkCategory: "cocktail" }))).toHaveLength(1);
    expect(filterVenues([venue], makeFilters({ drinkCategory: "vodka" }))).toHaveLength(0);
  });
});

describe("scoreVenue", () => {
  it("writer pick scores higher under writerTrail than balanced", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Grapes" })])[0];
    expect(scoreVenue(venue, "writerTrail")).toBeGreaterThan(scoreVenue(venue, "balanced"));
  });

  it("cheap venue outscores expensive under cheapest", () => {
    const cheap = groupVenuePrices([makeRow({ address: "A", price_gbp: 4 })])[0];
    const expensive = groupVenuePrices([makeRow({ address: "B", price_gbp: 9 })])[0];
    expect(scoreVenue(cheap, "cheapest")).toBeGreaterThan(scoreVenue(expensive, "cheapest"));
  });

  it("heritage-note venue outscores a plain one under heritage", () => {
    const heritage = groupVenuePrices([makeRow({ pub_name: "The Lamb" })])[0];
    const plain = groupVenuePrices([makeRow({ pub_name: "The Nothing" })])[0];
    expect(scoreVenue(heritage, "heritage")).toBeGreaterThan(scoreVenue(plain, "heritage"));
  });
});

describe("buildCrawlRoute", () => {
  it("returns [] for empty input", () => {
    expect(buildCrawlRoute([], makeFilters())).toEqual([]);
  });

  it("returns at most stopCount stops with no duplicate ids", () => {
    const venues = groupVenuePrices([
      makeRow({ address: "A", latitude: 51.5, longitude: -0.1 }),
      makeRow({ address: "B", latitude: 51.501, longitude: -0.1 }),
      makeRow({ address: "C", latitude: 51.502, longitude: -0.1 }),
      makeRow({ address: "D", latitude: 51.503, longitude: -0.1 }),
      makeRow({ address: "E", latitude: 51.504, longitude: -0.1 }),
    ]);
    const route = buildCrawlRoute(venues, makeFilters({ stopCount: 3 }));
    expect(route.length).toBeLessThanOrEqual(3);
    const ids = route.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mergeVenueDrops", () => {
  function makeSummaryDrop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
    return {
      drink: "Lager",
      priceGbp: null,
      passedDownNote: "",
      provenance: "contributor",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  // A venue with no editorial heritage note → hasStory starts false.
  function plainVenue() {
    return groupVenuePrices([makeRow({ pub_name: "The Nothing", price_gbp: 6 })])[0];
  }

  it("a price-only drop does NOT flip hasStory (a bare price is not a story)", () => {
    const venue = plainVenue();
    expect(venue.hasStory).toBe(false);
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ priceGbp: 4.5 })]]]),
    );
    expect(merged.hasStory).toBe(false);
    // ...and therefore no heritage-score boost either.
    expect(scoreVenue(merged, "heritage")).toBe(scoreVenue(venue, "heritage"));
    // The price signal itself still merges.
    expect(merged.cheapestPrice).toBe(4.5);
  });

  it("a drop WITH a passed-down note lights hasStory", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [venue.id, [makeSummaryDrop({ passedDownNote: "My grandad's corner table.", provenance: "anecdote" })]],
      ]),
    );
    expect(merged.hasStory).toBe(true);
  });

  it("a whitespace-only note is not a story", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ passedDownNote: "   ", priceGbp: 5 })]]]),
    );
    expect(merged.hasStory).toBe(false);
  });

  it("demo seeds are display-only: they never move prices or hasStory", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            makeSummaryDrop({
              provenance: "demo",
              priceGbp: 1.0,
              passedDownNote: "A seeded story that must not count.",
            }),
          ],
        ],
      ]),
    );
    expect(merged.hasStory).toBe(false);
    expect(merged.cheapestPrice).toBe(venue.cheapestPrice);
    expect(merged).toEqual(venue);
  });

  it("a demo drop ahead of an organic one never wins the latest-price or story slot", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [
          venue.id,
          [
            // Newest-first list: the demo seed sits ahead of the organic drop.
            makeSummaryDrop({
              provenance: "demo",
              drink: "Seeded Stout",
              priceGbp: 1.0,
              passedDownNote: "A seeded story that must not count.",
            }),
            makeSummaryDrop({ drink: "Organic Ale", priceGbp: 4.5 }),
          ],
        ],
      ]),
    );
    // The organic drop's signals win; the demo drop is invisible to them.
    expect(merged.cheapestPrice).toBe(4.5);
    expect(merged.cheapestPint).toBe("Organic Ale");
    expect(merged.hasStory).toBe(false);
  });

  it("an editorial heritage note keeps hasStory true regardless of drops", () => {
    const venue = groupVenuePrices([makeRow({ pub_name: "The Lamb" })])[0];
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ priceGbp: 5 })]]]),
    );
    expect(merged.hasStory).toBe(true);
  });

  it("carries the organic price drop's createdAt through as latestContributorAt", () => {
    const venue = plainVenue();
    expect(venue.latestContributorPrice).toBeNull();
    expect(venue.latestContributorAt).toBeNull();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([
        [venue.id, [makeSummaryDrop({ priceGbp: 4.5, createdAt: "2026-06-01T10:00:00.000Z" })]],
      ]),
    );
    expect(merged.latestContributorPrice).toBe(4.5);
    expect(merged.latestContributorAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("a note-only drop leaves the contributor price layer null (no live price)", () => {
    const venue = plainVenue();
    const [merged] = mergeVenueDrops(
      [venue],
      new Map([[venue.id, [makeSummaryDrop({ passedDownNote: "Grandad's local.", provenance: "anecdote" })]]]),
    );
    expect(merged.latestContributorPrice).toBeNull();
    expect(merged.latestContributorAt).toBeNull();
  });
});

describe("formatFreshness", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");

  it("returns empty string for missing/invalid input", () => {
    expect(formatFreshness(null, now)).toBe("");
    expect(formatFreshness(undefined, now)).toBe("");
    expect(formatFreshness("", now)).toBe("");
    expect(formatFreshness("not-a-date", now)).toBe("");
  });

  it("collapses sub-minute and future ages to 'just now'", () => {
    expect(formatFreshness("2026-07-06T11:59:30.000Z", now)).toBe("logged just now");
    // Future timestamp (clock skew) never claims a negative age.
    expect(formatFreshness("2026-07-06T13:00:00.000Z", now)).toBe("logged just now");
  });

  it("formats minutes, hours and days at the boundaries", () => {
    expect(formatFreshness("2026-07-06T11:58:00.000Z", now)).toBe("logged 2m ago");
    // 59 minutes stays minutes; 60 rolls to hours.
    expect(formatFreshness("2026-07-06T11:01:00.000Z", now)).toBe("logged 59m ago");
    expect(formatFreshness("2026-07-06T11:00:00.000Z", now)).toBe("logged 1h ago");
    expect(formatFreshness("2026-07-06T10:00:00.000Z", now)).toBe("logged 2h ago");
    // 23h stays hours; 24h rolls to a singular day.
    expect(formatFreshness("2026-07-05T13:00:00.000Z", now)).toBe("logged 23h ago");
    expect(formatFreshness("2026-07-05T12:00:00.000Z", now)).toBe("logged 1 day ago");
    expect(formatFreshness("2026-07-03T12:00:00.000Z", now)).toBe("logged 3 days ago");
  });
});

describe("crawlSummary", () => {
  it("total sums cheapest prices", () => {
    const venues = groupVenuePrices([
      makeRow({ address: "A", latitude: 51.5, longitude: -0.1, price_gbp: 5 }),
      makeRow({ address: "B", latitude: 51.6, longitude: -0.2, price_gbp: 6 }),
    ]);
    expect(crawlSummary(venues).total).toBe(11);
  });

  it("distance is 0 for a single-stop route", () => {
    const venues = groupVenuePrices([makeRow()]);
    expect(crawlSummary(venues).distance).toBe(0);
  });
});
