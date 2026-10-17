// A figure outside the pint band is not read as a price.
//
// The Pint Prices lane carried eleven £1.99 rows, all at Wetherspoons and most
// of them Bud Light, and they led every cheapest-pint list: the map's priced
// list, the home page's "cheapest near you" and the plan generator's stops. The
// harvest lanes already drop a pint under £2 before it is written, so the older
// lane now answers to the same band. The rows stay in the dataset as what the
// source said; no reader treats one as a price.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeAboutStats } from "@/lib/aboutStats";
import { CHAIN_PINT_MAX_GBP, CHAIN_PINT_MIN_GBP } from "@/lib/harvest/chainMenuPrices";
import { CATEGORY_PRICE_BANDS } from "@/lib/harvest/ukPriceCrawl";
import {
  PINT_PRICE_BAND_GBP,
  isCurrentVenueRow,
  isLivePriceRow,
  isOutOfBandPriceRow,
} from "@/lib/priceRowEligibility.mjs";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

function datasetRows(): VenuePrice[] {
  return JSON.parse(
    readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"),
  ) as VenuePrice[];
}

function row(over: Partial<VenuePrice>): VenuePrice {
  return {
    app_price_id: "app_price_test",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 5,
    price_text: "£5.00",
    address: "1 Test Street, London SE1 1AA",
    latitude: 51.5,
    longitude: -0.1,
    primary_borough: "Southwark",
    boroughs_visible: "Southwark",
    source_datasets: "",
    data_quality_notes: "",
    comment: "",
    description: "",
    website: "",
    booking_link: "",
    image_url: "",
    pub_url: "",
    ...over,
  } as VenuePrice;
}

describe("one pint band for every price lane", () => {
  it("is the band the harvest and chain lanes already drop figures outside", () => {
    expect(CATEGORY_PRICE_BANDS.beer).toEqual(PINT_PRICE_BAND_GBP);
    expect(CHAIN_PINT_MIN_GBP).toBe(PINT_PRICE_BAND_GBP.minGbp);
    expect(CHAIN_PINT_MAX_GBP).toBe(PINT_PRICE_BAND_GBP.maxGbp);
  });

  it("reads the edges of the band as prices and anything past them as not", () => {
    expect(isLivePriceRow(row({ price_gbp: 2 }))).toBe(true);
    expect(isLivePriceRow(row({ price_gbp: 12 }))).toBe(true);
    expect(isLivePriceRow(row({ price_gbp: 1.99 }))).toBe(false);
    expect(isLivePriceRow(row({ price_gbp: 13 }))).toBe(false);
  });

  it("treats a row with no figure as unpriced, not implausible", () => {
    expect(isOutOfBandPriceRow(row({ price_gbp: null }))).toBe(false);
    expect(isLivePriceRow(row({ price_gbp: null }))).toBe(true);
  });

  it("keeps an out-of-band row as part of the pub's story", () => {
    expect(isCurrentVenueRow(row({ price_gbp: 1.99 }))).toBe(true);
  });
});

describe("no reader treats an out-of-band figure as a price", () => {
  it("prices a pub from its in-band rows alone", () => {
    const [venue] = groupVenuePrices([
      row({ app_price_id: "deal", pint_name: "Bud Light", price_gbp: 1.99 }),
      row({ app_price_id: "pint", pint_name: "Carling", price_gbp: 2.63 }),
    ]);
    expect(defined(venue).cheapestPrice).toBe(2.63);
    expect(defined(venue).cheapestPint).toBe("Carling");
    expect(defined(venue).prices.map((price) => price.app_price_id)).toEqual(["pint"]);
  });

  it("keeps the website, photo and amenities an out-of-band row carries", () => {
    const [venue] = groupVenuePrices([
      row({
        price_gbp: 1.99,
        website: "https://example.com/the-test-arms",
        image_url: "https://example.com/arms.jpg",
        beer_garden: "yes",
      }),
    ]);
    expect(defined(venue).cheapestPrice).toBeNull();
    expect(defined(venue).website).toBe("https://example.com/the-test-arms");
    expect(defined(venue).imageUrl).toBe("https://example.com/arms.jpg");
    expect(defined(venue).amenities.beerGarden).toBe(true);
  });

  it("leaves an out-of-band figure out of /about's numbers", () => {
    const stats = computeAboutStats(
      [
        row({ pub_name: "The Deal House", price_gbp: 1.99 }),
        row({ pub_name: "The Free House", address: "2 Test Street", price_gbp: 4.1 }),
      ],
      { historicPubsCited: 0, citiesCovered: 0 },
    );
    expect(stats.pintPricesObserved).toBe(1);
    expect(stats.cheapestPint).toBe(4.1);
  });
});

describe("the published data answers to the band", () => {
  it("keeps every out-of-band row as what the source said", () => {
    const outOfBand = datasetRows().filter(isOutOfBandPriceRow);
    // Eleven £1.99 rows and one £13 cocktail filed as a pint, measured on
    // 17 October 2026. A new one is a source problem to look at, not to absorb.
    expect(outOfBand.map((entry) => entry.price_gbp).sort()).toEqual([
      ...Array.from({ length: 11 }, () => 1.99),
      13,
    ]);
  });

  it("gives no venue a cheapest price outside the band", () => {
    for (const venue of groupVenuePrices(datasetRows())) {
      if (venue.cheapestPrice === null) continue;
      expect(venue.cheapestPrice).toBeGreaterThanOrEqual(PINT_PRICE_BAND_GBP.minGbp);
      expect(venue.cheapestPrice).toBeLessThanOrEqual(PINT_PRICE_BAND_GBP.maxGbp);
    }
  });

  it("gives no pub pin a price outside the band", () => {
    const slim = JSON.parse(
      readFileSync(join(ROOT, "public", "data", "venues_slim.json"), "utf8"),
    ) as { rows: { name: string; kind?: string; cheapestPrice: number | null }[] };
    // A bar, restaurant or food pin anchors on a cocktail or a dish, not a pint.
    const outside = slim.rows.filter(
      (pin) =>
        (pin.kind === undefined || pin.kind === "pub") &&
        typeof pin.cheapestPrice === "number" &&
        (pin.cheapestPrice < PINT_PRICE_BAND_GBP.minGbp ||
          pin.cheapestPrice > PINT_PRICE_BAND_GBP.maxGbp),
    );
    expect(outside).toEqual([]);
  });
});
