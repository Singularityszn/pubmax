import { describe, expect, it } from "vitest";

import { curatedCrawls } from "@/lib/curatedCrawls";
import { groupVenuePrices, type CrawlStyle, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

// Recompute venue ids from the dataset exactly as the app does, so a re-export
// that moves a venue is caught here instead of 404-ing a curated crawl.
const venues = groupVenuePrices(dataset as VenuePrice[]);
const venueById = new Map(venues.map((venue) => [venue.id, venue]));

const validStyles: CrawlStyle[] = [
  "balanced",
  "cheapest",
  "heritage",
  "writerTrail",
  "beerGarden",
  "sports",
  "dateNight",
];

describe("curated crawls", () => {
  it("has 3-4 crawls with unique ids", () => {
    expect(curatedCrawls.length).toBeGreaterThanOrEqual(3);
    expect(curatedCrawls.length).toBeLessThanOrEqual(4);
    expect(new Set(curatedCrawls.map((c) => c.id)).size).toBe(curatedCrawls.length);
  });

  it("every crawl has a name, blurb, >=4 stops, and a valid crawlStyle", () => {
    for (const crawl of curatedCrawls) {
      expect(crawl.name.trim().length, `${crawl.id} name`).toBeGreaterThan(0);
      expect(crawl.blurb.trim().length, `${crawl.id} blurb`).toBeGreaterThan(0);
      expect(crawl.venueIds.length, `${crawl.id} stop count`).toBeGreaterThanOrEqual(4);
      expect(validStyles, `${crawl.id} crawlStyle`).toContain(crawl.crawlStyle);
    }
  });

  it("every venueId resolves to a real venue in the dataset", () => {
    for (const crawl of curatedCrawls) {
      for (const venueId of crawl.venueIds) {
        expect(
          venueById.get(venueId),
          `crawl ${crawl.id} points at missing venue ${venueId}`,
        ).toBeDefined();
      }
      // No repeated stops within a crawl.
      expect(new Set(crawl.venueIds).size, `${crawl.id} has duplicate stops`).toBe(
        crawl.venueIds.length,
      );
    }
  });
});
