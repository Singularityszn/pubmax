import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DRINK_BRAND_AREA_PUBLICATION_FLOOR,
  DRINK_BRAND_AREA_ROW_LIMIT,
  buildDrinkBrandAreaLanding,
  listDrinkBrandAreaLandings,
  type DrinkBrandAreaLanding,
} from "@/lib/drinkBrandAreaLanding";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { haversineKm } from "@/lib/haversine";
import {
  assignVenueToNightArea,
} from "@/lib/nightAreaLanding";
import { NIGHT_AREAS, getNightArea, type NightArea } from "@/lib/nightAreas";
import {
  selectDrinkBrandPriceForVenue,
  type DrinkBrandLandingRow,
} from "@/lib/drinkBrandLanding";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const NOW = new Date("2026-08-15T12:00:00.000Z");

async function realVenues(): Promise<Venue[]> {
  const raw = await readFile(
    path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json"),
    "utf8",
  );
  return groupVenuePrices(JSON.parse(raw) as VenuePrice[]);
}

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
    pub_url: "https://www.pint-prices.com/pub/test-pub",
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

function venueAt(
  id: string,
  lat: number,
  lng: number,
  rows: VenuePrice[] = [],
  overrides: Partial<Venue> = {},
): Venue {
  return {
    id,
    name: id,
    address: "1 Test Street",
    latitude: lat,
    longitude: lng,
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

function pricedVenue(
  id: string,
  area: NightArea,
  price = 4.5,
  overrides: Partial<VenuePrice> = {},
): Venue {
  return venueAt(
    id,
    area.centre.lat,
    area.centre.lng,
    [
      priceRow({
        app_price_id: `price-${id}`,
        pub_name: id,
        price_gbp: price,
        ...overrides,
      }),
    ],
  );
}

function enoughVenues(
  area: NightArea,
  count: number,
  price = 4.5,
): Venue[] {
  return Array.from({ length: count }, (_, index) =>
    pricedVenue(`${area.slug}-${String(index).padStart(2, "0")}`, area, price + index / 100),
  );
}

describe("governed drink brand by Night Area landings", () => {
  it("keeps pair model signatures, tuple rows, and publication constants fixed", () => {
    expect(DRINK_BRAND_AREA_PUBLICATION_FLOOR).toBe(10);
    expect(DRINK_BRAND_AREA_ROW_LIMIT).toBe(20);
    expectTypeOf(buildDrinkBrandAreaLanding).toEqualTypeOf<
      (
        areaSlug: string,
        brandSlug: string,
        venues: readonly Venue[],
        areas?: readonly NightArea[],
        now?: Date,
      ) => DrinkBrandAreaLanding | null
    >();
    expectTypeOf(listDrinkBrandAreaLandings).toEqualTypeOf<
      (
        venues: readonly Venue[],
        areas?: readonly NightArea[],
        now?: Date,
      ) => DrinkBrandAreaLanding[]
    >();
    expectTypeOf<DrinkBrandAreaLanding["rows"]>().toEqualTypeOf<
      [DrinkBrandLandingRow, ...DrinkBrandLandingRow[]]
    >();
  });

  it("refuses unknown pairs, not-ready areas, and pairs below the floor", () => {
    const readyArea = getNightArea("clapham");
    const notReadyArea = getNightArea("barnes");

    expect(buildDrinkBrandAreaLanding("unknown", "guinness", [])).toBeNull();
    expect(buildDrinkBrandAreaLanding("clapham", "unknown", [])).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(
        readyArea.slug,
        "guinness",
        enoughVenues(readyArea, DRINK_BRAND_AREA_PUBLICATION_FLOOR - 1),
        [readyArea],
        NOW,
      ),
    ).toBeNull();
    expect(
      buildDrinkBrandAreaLanding(
        notReadyArea.slug,
        "guinness",
        enoughVenues(notReadyArea, DRINK_BRAND_AREA_PUBLICATION_FLOOR),
        [notReadyArea],
        NOW,
      ),
    ).toBeNull();
  });

  it("assigns an overlapping Venue to one nearest Night Area", () => {
    const clapham = getNightArea("clapham");
    const brixton = getNightArea("brixton");
    const venue = venueAt(
      "overlap",
      (clapham.centre.lat + brixton.centre.lat) / 2,
      (clapham.centre.lng + brixton.centre.lng) / 2,
    );
    const expected = [clapham, brixton]
      .map((area) => ({
        area,
        distance: haversineKm(
          [venue.longitude, venue.latitude],
          [area.centre.lng, area.centre.lat],
        ),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance || left.area.slug.localeCompare(right.area.slug),
      )[0]!.area;

    expect(assignVenueToNightArea(venue, [clapham, brixton])?.slug).toBe(expected.slug);
  });

  it("selects one exact cheapest matching brand row without mutating Venue prices", () => {
    const rows = [
      priceRow({ app_price_id: "expensive", pint_name: "Guinness Extra", price_gbp: 6 }),
      priceRow({ app_price_id: "cheap", pint_name: "Guinness Draught", price_gbp: 4 }),
      priceRow({ app_price_id: "other", pint_name: "Amstel", price_gbp: 3 }),
      priceRow({ app_price_id: "invalid", pint_name: "Guinness", price_gbp: Number.NaN }),
    ];
    const venue = venueAt("exact", 51.46, -0.138, rows);
    const originalRows = [...venue.prices];

    expect(selectDrinkBrandPriceForVenue(venue, DRINK_BRANDS.beer[0]!)).toBe(rows[1]);
    expect(venue.prices).toEqual(originalRows);
  });

  it("excludes non-pub Venues and invalid brand prices from pair coverage", () => {
    const area = getNightArea("clapham");
    const valid = enoughVenues(area, DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    const ignored = [
      pricedVenue("bar", area, 1, { pint_name: "Guinness", app_price_id: "bar-price" }),
      pricedVenue("invalid", area, 1, { pint_name: "Guinness", price_gbp: 0, app_price_id: "invalid-price" }),
    ].map((venue, index) => ({ ...venue, kind: index === 0 ? "bar" : undefined } as Venue));

    const landing = buildDrinkBrandAreaLanding(
      area.slug,
      "guinness",
      [...valid, ...ignored],
      [area],
      NOW,
    );

    expect(landing?.totalPricedVenues).toBe(DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    expect(landing?.rows.some((row) => row.venueId === "bar")).toBe(false);
    expect(landing?.rows.some((row) => row.venueId === "invalid")).toBe(false);
    expect(isPubVenueKind("bar")).toBe(false);
  });

  it("ranks deterministic ties by price, Venue name, then Venue id", () => {
    const area = getNightArea("clapham");
    const venues = [
      pricedVenue("z-id", area, 4, { pub_name: "Same Name", app_price_id: "z-price" }),
      pricedVenue("a-id", area, 4, { pub_name: "Same Name", app_price_id: "a-price" }),
      pricedVenue("cheap", area, 3, { pub_name: "Cheap Name", app_price_id: "cheap-price" }),
      ...enoughVenues(area, 7, 5),
    ];
    venues[0]!.prices.push(
      priceRow({ app_price_id: "a-row", pint_name: "Guinness A", price_gbp: 4, pub_name: "Same Name" }),
    );

    const landing = buildDrinkBrandAreaLanding(area.slug, "guinness", venues, [area], NOW);

    expect(landing?.rows.slice(0, 3).map((row) => row.venueId)).toEqual([
      "cheap",
      "a-id",
      "z-id",
    ]);
    expect(selectDrinkBrandPriceForVenue(venues[0]!, DRINK_BRANDS.beer[0]!)?.app_price_id).toBe(
      "a-row",
    );
  });

  it("caps rendered rows at 20 while retaining full eligible count", () => {
    const area = getNightArea("clapham");
    const landing = buildDrinkBrandAreaLanding(
      area.slug,
      "guinness",
      enoughVenues(area, DRINK_BRAND_AREA_ROW_LIMIT + 1),
      [area],
      NOW,
    );

    expect(landing?.totalPricedVenues).toBe(DRINK_BRAND_AREA_ROW_LIMIT + 1);
    expect(landing?.rows).toHaveLength(DRINK_BRAND_AREA_ROW_LIMIT);
    expect(landing?.rows.map((row) => row.rank)).toEqual(
      Array.from({ length: DRINK_BRAND_AREA_ROW_LIMIT }, (_, index) => index + 1),
    );
  });

  it("uses one shared collection date and the exact displayed-row publisher", () => {
    const area = getNightArea("clapham");
    const venues = enoughVenues(area, DRINK_BRAND_AREA_PUBLICATION_FLOOR);
    venues[0]!.prices[0] = priceRow({
      app_price_id: "named-source",
      pub_name: "Named Source",
      pint_name: "Guinness Draught",
      price_gbp: 3,
      pub_url: "https://www.pint-prices.com/pub/named-source",
    });
    venues[1]!.prices[0] = priceRow({
      app_price_id: "missing-source",
      pub_name: "Missing Source",
      pint_name: "Guinness Draught",
      price_gbp: 3.1,
      pub_url: "",
    });

    const landing = buildDrinkBrandAreaLanding(area.slug, "guinness", venues, [area], NOW);

    expect(landing).toMatchObject({
      areaSlug: "clapham",
      areaName: "Clapham",
      brandSlug: "guinness",
      brandLabel: "Guinness",
      collectedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
      totalPricedVenues: 10,
    });
    expect(landing?.rows[0]).toMatchObject({
      venueId: venues[0]!.id,
      priceGbp: 3,
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/named-source",
      },
    });
    expect(landing?.rows[1]?.publisher).toBeNull();
  });

  it("lists the ordered eligible pair ids and counts from the 2026-08-15 dataset", async () => {
    const landings = listDrinkBrandAreaLandings(await realVenues(), NIGHT_AREAS, NOW);

    expect(landings.map((landing) => `${landing.areaSlug}/${landing.brandSlug}`)).toEqual([
      "clapham/guinness",
      "clapham/amstel",
      "victoria/guinness",
      "victoria/neck-oil",
      "victoria/estrella",
      "victoria/peroni",
      "victoria/amstel",
      "victoria/birra-moretti",
      "piccadilly-soho/guinness",
      "piccadilly-soho/neck-oil",
      "piccadilly-soho/estrella",
      "piccadilly-soho/peroni",
      "piccadilly-soho/amstel",
      "piccadilly-soho/birra-moretti",
    ]);
    expect(landings.map((landing) => landing.totalPricedVenues)).toEqual([
      21,
      11,
      17,
      14,
      11,
      12,
      15,
      10,
      34,
      25,
      25,
      29,
      26,
      22,
    ]);
    expect(landings.every((landing) => landing.collectedAt === PINT_DATASET_OBSERVED_AT.toISOString())).toBe(
      true,
    );
  });
});
