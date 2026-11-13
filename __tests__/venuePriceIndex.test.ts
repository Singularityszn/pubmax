import { promises as fs } from "fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import type { VenuePrice } from "@/lib/venues";

function priceRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "The Retry Arms",
    pint_name: "House Lager",
    price_gbp: 4.5,
    price_text: "£4.50",
    address: "1 Retry Street",
    latitude: 51.5,
    longitude: -0.12,
    boroughs_visible: "Camden",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "Camden",
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
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  resetVenuePriceIndexForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetVenuePriceIndexForTests();
});

// Fails every read of the bundled price dataset while `failing()` holds and
// passes every other file, and the dataset once it stops, to the real read.
function failPriceReadsWhile(failing: () => boolean) {
  const realReadFile = fs.readFile.bind(fs) as (...args: unknown[]) => Promise<unknown>;
  return vi.spyOn(fs, "readFile").mockImplementation(((file: unknown, ...rest: unknown[]) =>
    failing() && String(file).endsWith("pint_prices_app_dataset.json")
      ? Promise.reject(new Error("EIO: price read failed"))
      : realReadFile(file, ...rest)) as never);
}

describe("getPricedVenues", () => {
  it("rejects a failed read and reads again on the next call", async () => {
    const readFile = vi.spyOn(fs, "readFile");
    readFile
      .mockRejectedValueOnce(new Error("missing prices"))
      .mockResolvedValueOnce(JSON.stringify([priceRow()]));

    await expect(getPricedVenues()).rejects.toThrow("missing prices");
    const retried = await getPricedVenues();

    expect(retried).toHaveLength(1);
    expect(retried[0]?.name).toBe("The Retry Arms");
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});

describe("a page cache over the price read", () => {
  it("gives the landing real figures on the request after a failed read", async () => {
    let failing = true;
    failPriceReadsWhile(() => failing);
    const { loadLandingHeroData } = await import("@/lib/landingPubCard.server");

    const failed = await loadLandingHeroData();
    expect(failed.averages).toBeNull();
    expect(failed.card).toBeNull();

    failing = false;
    const retried = await loadLandingHeroData();
    expect(retried.averages?.sampleSize).toBeGreaterThan(0);
    expect(retried.card).not.toBeNull();
  });

  it("gives /about real figures on the request after a failed read", async () => {
    let failing = true;
    failPriceReadsWhile(() => failing);
    const { loadAboutStats, resetAboutStatsForTests } = await import("@/lib/aboutStats");
    resetAboutStatsForTests();

    await expect(loadAboutStats()).rejects.toThrow();

    failing = false;
    const retried = await loadAboutStats();
    expect(retried.pintPricesObserved).toBeGreaterThan(0);
    expect(retried.pubsTracked).toBeGreaterThan(0);
    expect(retried.averagePint).not.toBeNull();
    resetAboutStatsForTests();
  });
});
