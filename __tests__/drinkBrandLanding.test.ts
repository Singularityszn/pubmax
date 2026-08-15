import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DRINK_BRAND_LANDING_PUBLICATION_FLOOR,
  DRINK_BRAND_LANDING_ROW_LIMIT,
  type DrinkBrandLanding,
  type DrinkBrandLandingRow,
  buildDrinkBrandLanding,
  formatDrinkBrandLandingPublisherStatus,
  listDrinkBrandLandings,
} from "@/lib/drinkBrandLanding";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const DATASET_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "pint_prices_app_dataset.json",
);

function priceRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "Test Pub",
    pint_name: "Guinness",
    price_gbp: 4.5,
    price_text: "£4.50",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "Camden",
    boroughs_raw_embedded_non_anomaly: "Camden",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "1",
    estimated_average_price_text: "£5.00",
    pub_url: "https://www.pint-prices.com/pub/exact",
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
    source_datasets: "pint-prices",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: true,
    has_individual_pub_page_row: true,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

function venue(
  id: string,
  rows: VenuePrice[],
  overrides: Partial<Venue> = {},
): Venue {
  return {
    id,
    name: id,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: rows,
    cheapestPrice: null,
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
    sourceDatasets: ["pint-prices"],
    curation: {},
    ...overrides,
  } as Venue;
}

describe("governed drink brand landings", () => {
  it("refuses unknown brands and brands below the publication floor", () => {
    const belowFloor = Array.from(
      { length: DRINK_BRAND_LANDING_PUBLICATION_FLOOR - 1 },
      (_, index) =>
        venue(`below-${index}`, [
          priceRow({
            app_price_id: `below-price-${index}`,
            pub_name: `Below ${index}`,
          }),
        ]),
    );

    expect(buildDrinkBrandLanding("not-real", [])).toBeNull();
    expect(buildDrinkBrandLanding("guinness", belowFloor)).toBeNull();
  });

  it("keeps the fixed builder signature and non-empty landing row invariant", () => {
    expectTypeOf(buildDrinkBrandLanding).toEqualTypeOf<
      (slug: string, venues: readonly Venue[]) => DrinkBrandLanding | null
    >();
    expectTypeOf<DrinkBrandLanding["rows"]>().toEqualTypeOf<
      [DrinkBrandLandingRow, ...DrinkBrandLandingRow[]]
    >();
  });

  it("formats one exact publisher status for named and missing rows", () => {
    expect(
      formatDrinkBrandLandingPublisherStatus({
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/exact",
      }),
    ).toBe("Publisher: Pint Prices");
    expect(formatDrinkBrandLandingPublisherStatus(null)).toBe(
      "Publisher not recorded",
    );
  });

  it("keeps only valid pub rows and binds one cheapest exact row per Venue", () => {
    const model = buildDrinkBrandLanding("guinness", [
        venue("non-pub", [priceRow()], { kind: "bar" }),
        venue("invalid", [
          priceRow({ app_price_id: "invalid-null", price_gbp: null }),
          priceRow({ app_price_id: "invalid-zero", price_gbp: 0 }),
          priceRow({ app_price_id: "invalid-negative", price_gbp: -1 }),
          priceRow({ app_price_id: "invalid-nan", price_gbp: Number.NaN }),
        ]),
        venue("wrong-brand", [priceRow({ pint_name: "Amstel" })]),
        venue("alpha-a", [
          priceRow({
            app_price_id: "alpha-expensive",
            pint_name: "Guinness Extra",
            price_gbp: 6,
          }),
          priceRow({
            app_price_id: "alpha-cheap",
            pint_name: "Guinness Draught",
            price_gbp: 4,
          }),
        ]),
        venue("publisher-missing", [
          priceRow({ app_price_id: "missing-source", price_gbp: 4.25, pub_url: "" }),
        ]),
        ...Array.from({ length: 18 }, (_, index) =>
          venue(`filler-${index}`, [
            priceRow({
              app_price_id: `filler-price-${index}`,
              pub_name: `Filler ${index}`,
              price_gbp: 10 + index,
            }),
          ]),
        ),
      ]);

    expect(model?.rows.slice(0, 2).map((row) => row.venueId)).toEqual([
      "alpha-a",
      "publisher-missing",
    ]);
    expect(model?.rows[0]).toMatchObject({
      rank: 1,
      venueId: "alpha-a",
      venueName: "alpha-a",
      borough: "Camden",
      pintName: "Guinness Draught",
      priceGbp: 4,
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/exact",
      },
    });
    expect(model?.rows[1]?.publisher).toBeNull();
    expect(model?.totalPricedVenues).toBe(20);
    expect(model?.collectedAt).toBe(PINT_DATASET_OBSERVED_AT.toISOString());
  });

  it("breaks equal row prices by app price id and ranked Venue ties by name then id", () => {
    const model = buildDrinkBrandLanding("guinness", [
        venue("alpha-b", [
          priceRow({ app_price_id: "b", pub_name: "Alpha B", price_gbp: 4 }),
        ]),
        venue("alpha-a", [
          priceRow({ app_price_id: "a", pint_name: "Guinness Z", pub_name: "Alpha A", price_gbp: 4 }),
          priceRow({ app_price_id: "a", pint_name: "Guinness A", pub_name: "Alpha A", price_gbp: 4 }),
          priceRow({ app_price_id: "z", pub_name: "Alpha A", price_gbp: 4 }),
        ]),
        venue("cheap", [priceRow({ app_price_id: "cheap", price_gbp: 3 })]),
        ...Array.from({ length: 17 }, (_, index) =>
          venue(`filler-${index}`, [
            priceRow({
              app_price_id: `filler-price-${index}`,
              pub_name: `Filler ${index}`,
              price_gbp: 10 + index,
            }),
          ]),
        ),
      ]);

    expect(model?.rows.slice(0, 3).map((row) => row.venueId)).toEqual([
      "cheap",
      "alpha-a",
      "alpha-b",
    ]);
    expect(model?.rows[1]).toMatchObject({
      venueId: "alpha-a",
      pintName: "Guinness A",
      priceGbp: 4,
    });
  });

  it("caps displayed rows while keeping the full eligible Venue count", () => {
    const venues = Array.from({ length: DRINK_BRAND_LANDING_ROW_LIMIT + 1 }, (_, index) =>
      venue(`venue-${String(index).padStart(2, "0")}`, [
        priceRow({
          app_price_id: `price-${index}`,
          pub_name: `Venue ${String(index).padStart(2, "0")}`,
          price_gbp: 4 + index / 100,
        }),
      ]),
    );

    const model = buildDrinkBrandLanding("guinness", venues);

    expect(model?.totalPricedVenues).toBe(DRINK_BRAND_LANDING_ROW_LIMIT + 1);
    expect(model?.rows).toHaveLength(DRINK_BRAND_LANDING_ROW_LIMIT);
    expect(model?.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: DRINK_BRAND_LANDING_ROW_LIMIT }, (_, index) => index + 1),
    );
  });

  it("lists current eligible beer brands in catalogue order with real dataset counts", async () => {
    const raw = JSON.parse(await readFile(DATASET_FILE, "utf8")) as VenuePrice[];
    const landings = listDrinkBrandLandings(groupVenuePrices(raw));

    expect(landings.map((landing) => landing.slug)).toEqual(
      DRINK_BRANDS.beer.map((brand) => brand.id),
    );
    expect(landings.map((landing) => landing.totalPricedVenues)).toEqual([
      347,
      148,
      114,
      121,
      210,
      82,
      30,
      95,
    ]);
  });

  it("loads a non-empty grouped Pint Price dataset through the shared reader", async () => {
    const venues = await loadPintPriceLandingVenues();

    expect(venues.length).toBeGreaterThan(0);
    expect(venues.every((item) => item.prices.length > 0)).toBe(true);
  });
});
