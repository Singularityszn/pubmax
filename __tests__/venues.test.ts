import { describe, it, expect } from "vitest";
import {
  groupVenuePrices,
  filterVenues,
  scoreVenue,
  buildCrawlRoute,
  crawlSummary,
  mergeVenueDrops,
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
    requireLiveSports: false,
    requireFood: false,
    requireCocktails: false,
    requireWater: false,
    requirePintDrops: false,
    requireHeritage: false,
    canonicalOnly: false,
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
