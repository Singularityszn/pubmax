import { promises as fs } from "fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPricedVenues, getVenuePriceDataset, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import { loadGroupedVenues } from "@/lib/venueDataset";
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
  it("shares the cold dataset read across concurrent callers", async () => {
    let finish!: (value: string) => void;
    const readFile = vi.spyOn(fs, "readFile").mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }) as never);
    const reads = [getPricedVenues(), getPricedVenues(), loadGroupedVenues()];
    await Promise.resolve();
    expect(readFile).toHaveBeenCalledTimes(1);
    finish(JSON.stringify([priceRow()]));
    const results = await Promise.all(reads);
    expect(results.map((venues) => venues[0]?.name)).toEqual(["The Retry Arms", "The Retry Arms", "The Retry Arms"]);
    const dataset = await getVenuePriceDataset();
    expect(dataset.rows).toHaveLength(1);
    for (const result of results) expect(result).toBe(dataset.venues);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it("shares the dataset with concurrent About and Plan reads", async () => {
    const { loadAboutStats, resetAboutStatsForTests } = await import("@/lib/aboutStats");
    const { planPriceEvidenceForVenues } = await import("@/lib/planRouteEvidence.server");
    resetAboutStatsForTests();
    const realRead = fs.readFile.bind(fs);
    let priceReads = 0;
    vi.spyOn(fs, "readFile").mockImplementation(((file: unknown, ...args: unknown[]) => {
      if (String(file).endsWith("pint_prices_app_dataset.json")) priceReads++;
      return (realRead as (...values: unknown[]) => Promise<unknown>)(file, ...args);
    }) as never);
    try {
      const [venues, stats] = await Promise.all([getPricedVenues(), loadAboutStats(), planPriceEvidenceForVenues([], Date.now())]);
      expect(venues.length).toBeGreaterThan(0);
      expect(stats.pintPricesObserved).toBeGreaterThan(0);
      expect(priceReads).toBe(1);
    } finally { resetAboutStatsForTests(); }
  });
  it("reconsiders cached closures after their evidence expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
      expect((await getPricedVenues()).some((venue) => venue.id === "venue-1fabngq")).toBe(false);
      vi.setSystemTime(new Date("2027-09-16T00:00:00Z"));
      expect((await getPricedVenues()).some((venue) => venue.id === "venue-1fabngq")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
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
