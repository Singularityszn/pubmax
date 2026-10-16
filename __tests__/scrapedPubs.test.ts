import { afterEach, describe, expect, it, vi } from "vitest";

import { normaliseScrapedSource, SCRAPED_SOURCE_LABELS } from "@/lib/scrapedPubs";

describe("scrapedPubs helpers", () => {
  it("maps scrape hosts to display sources", () => {
    expect(normaliseScrapedSource("greene-king.co.uk")).toBe("greene-king.co.uk");
    expect(normaliseScrapedSource("nicholsonspubs.co.uk")).toBe("nicholsonspubs.co.uk");
    expect(normaliseScrapedSource("youngs.co.uk")).toBe("youngs.co.uk");
    expect(SCRAPED_SOURCE_LABELS["youngs.co.uk"]).toBe("Young's");
  });
});

describe("readScrapedPubsForPage", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/venueMenuEnrichment");
    vi.doUnmock("@/lib/venuePriceIndex");
    vi.resetModules();
  });

  // A card used to print a drink word ("Shots", "Whisky") picked by hashing the
  // venue id: decoration that read as a fact about the pub. The row carries no
  // such field now, so no card can print one.
  it("loads enrichment pubs with source labels and no made-up drink category", async () => {
    const { readScrapedPubsForPage } = await import("@/lib/scrapedPubs.server");
    const { pubs, complete } = await readScrapedPubsForPage();
    expect(complete).toBe(true);
    expect(pubs.length).toBeGreaterThanOrEqual(90);
    expect(pubs.every((pub) => pub.name.trim().length > 0)).toBe(true);
    expect(pubs.every((pub) => !("drinkAccent" in pub) && !("drinkShelf" in pub))).toBe(true);
    expect(pubs.some((pub) => pub.source === "nicholsonspubs.co.uk")).toBe(true);
    expect(pubs.some((pub) => pub.source === "youngs.co.uk")).toBe(true);
  });

  // The loader reads bundled files that cannot change between two requests to
  // the same instance, and one of them is a 6.7 MB JSON.parse, so it is read
  // once and the rows are handed back. Identity is the proof: a second call
  // that re-derived the list would return a different array.
  it("reads the bundled datasets once per instance", async () => {
    const { readScrapedPubsForPage } = await import("@/lib/scrapedPubs.server");
    const first = await readScrapedPubsForPage();
    expect(await readScrapedPubsForPage()).toBe(first);
  });

  it("deduplicates a degraded read but retries it on the next request", async () => {
    vi.resetModules();
    vi.doMock("@/lib/venueMenuEnrichment", () => {
      let attempt = 0;
      return {
        loadVenueMenuEnrichmentIndex: async () => {
          attempt += 1;
          return attempt === 1
            ? new Map()
            : new Map([
                [
                  "venue-recovered",
                  { source: "youngs.co.uk", menuUrl: "https://example.com/menu" },
                ],
              ]);
        },
      };
    });
    vi.doMock("@/lib/venuePriceIndex", () => ({
      getPricedVenues: async () => [
        {
          id: "venue-recovered",
          name: "Recovered Arms",
          primaryBorough: "Camden",
          imageUrl: "",
          cheapestPrice: 5.5,
        },
      ],
    }));

    const { readScrapedPubsForPage } = await import("@/lib/scrapedPubs.server");
    const first = readScrapedPubsForPage();
    const concurrent = readScrapedPubsForPage();

    expect(concurrent).toBe(first);
    expect((await first).pubs).toEqual([]);

    const recovered = await readScrapedPubsForPage();
    expect(recovered.pubs).toHaveLength(1);
    expect(recovered.pubs[0]?.name).toBe("Recovered Arms");
  });

  it("reports incomplete reads without a trustworthy count", async () => {
    vi.resetModules();
    vi.doMock("@/lib/venueMenuEnrichment", () => ({
      loadVenueMenuEnrichmentIndex: async () => new Map(),
    }));
    vi.doMock("@/lib/venuePriceIndex", () => ({
      getPricedVenues: async () => [],
    }));

    const { readScrapedPubsForPage } = await import("@/lib/scrapedPubs.server");
    const read = await readScrapedPubsForPage();
    expect(read.pubs).toEqual([]);
    expect(read.complete).toBe(false);
  });
});
