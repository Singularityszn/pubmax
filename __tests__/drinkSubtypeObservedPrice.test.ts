import { describe, expect, it } from "vitest";

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import {
  drinkLabelMatchesSubtype,
  selectObservedSubtypePriceForVenue,
} from "@/lib/drinkSubtypeObservedPrice";
import { drinkSubtypeFromText } from "@/lib/drinkSubtypes";
import type { Venue, VenuePrice } from "@/lib/venues";

function makePrice(pint_name: string, price_gbp: number): VenuePrice {
  return {
    app_price_id: `id-${pint_name}`,
    pub_name: "Test Pub",
    pint_name,
    price_gbp,
    price_text: `£${price_gbp.toFixed(2)}`,
    address: "1 Test St",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "Camden",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "1",
    estimated_average_price_text: "",
    pub_url: "https://example.com/menu",
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
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
  };
}

function makeVenue(prices: VenuePrice[]): Venue {
  return {
    id: "venue-test-1",
    name: "Test Pub",
    address: "1 Test St",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices,
    cheapestPrice: prices[0]?.price_gbp ?? null,
    cheapestPint: prices[0]?.pint_name ?? "",
    averagePrice: null,
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: { provenance: "seed", sourceLabel: "", sourceUrl: "", licence: "n/a" },
    kind: "pub",
  };
}

describe("soft-drink subtype classifiers", () => {
  it("maps Coke Zero, Diet Coke and still water labels", () => {
    expect(drinkSubtypeFromText("Coke Zero", "soft-drink")?.id).toBe("soft-drink-coke-zero");
    expect(drinkSubtypeFromText("Diet Coke", "soft-drink")?.id).toBe("soft-drink-diet-coke");
    expect(drinkSubtypeFromText("Still water", "soft-drink")?.id).toBe("soft-drink-still-water");
  });

  it("does not treat tap water as a priced still-water product", () => {
    expect(drinkSubtypeFromText("Tap water", "soft-drink")).toBeNull();
  });

  it("does not treat regular Coke as Coke Zero", () => {
    expect(drinkLabelMatchesSubtype("Coca-Cola", { id: "soft-drink-coke-zero", category: "soft-drink", label: "", longLabel: "", tokens: [] })).toBe(false);
    expect(drinkSubtypeFromText("Coca-Cola", "soft-drink")).not.toBe(
      drinkSubtypeFromText("Coke Zero", "soft-drink"),
    );
  });
});

describe("selectObservedSubtypePriceForVenue", () => {
  it("returns null when no matching label exists", () => {
    const venue = makeVenue([makePrice("Guinness", 5.2)]);
    expect(selectObservedSubtypePriceForVenue(venue, "soft-drink-coke-zero")).toBeNull();
  });

  it("picks the cheapest matching row and keeps its observation date from updates", () => {
    const venue = makeVenue([
      makePrice("Coke Zero", 3.2),
      makePrice("Diet Coke", 2.9),
    ]);
    const zero = selectObservedSubtypePriceForVenue(venue, "soft-drink-coke-zero");
    expect(zero?.priceGbp).toBe(3.2);
    expect(zero?.observedAt).toBeTruthy();

    const update: DrinkPriceUpdate = {
      venueKey: "test pub|1 test st|51.50000|-0.10000",
      drinkName: "Coke Zero",
      category: "soft-drink",
      priceGbp: 2.5,
      source: { label: "menu", url: "https://example.com/drinks", licence: "test" },
      observedAt: "2024-06-01T12:00:00.000Z",
      lane: "publisher",
    };
    const cheaper = selectObservedSubtypePriceForVenue(venue, "soft-drink-coke-zero", [update]);
    expect(cheaper?.priceGbp).toBe(2.5);
    expect(cheaper?.observedAt).toBe("2024-06-01T12:00:00.000Z");
  });

  it("never uses a Diet Coke price for Coke Zero", () => {
    const venue = makeVenue([makePrice("Diet Coke", 2.1)]);
    expect(selectObservedSubtypePriceForVenue(venue, "soft-drink-coke-zero")).toBeNull();
  });
});
