import { describe, expect, it } from "vitest";

import {
  drinkAccentForVenue,
  drinkShelfForVenue,
  normaliseScrapedSource,
  SCRAPED_SOURCE_LABELS,
} from "@/lib/scrapedPubs";
import { DRINK_CATEGORIES } from "@/lib/drinks";

describe("scrapedPubs helpers", () => {
  it("maps scrape hosts to display sources", () => {
    expect(normaliseScrapedSource("greene-king.co.uk")).toBe("greene-king.co.uk");
    expect(normaliseScrapedSource("nicholsonspubs.co.uk")).toBe("nicholsonspubs.co.uk");
    expect(normaliseScrapedSource("youngs.co.uk")).toBe("youngs.co.uk");
    expect(SCRAPED_SOURCE_LABELS["youngs.co.uk"]).toBe("Young's");
  });

  it("assigns a stable drink accent per venue id", () => {
    const a = drinkAccentForVenue("venue-eltcmh");
    const b = drinkAccentForVenue("venue-eltcmh");
    expect(a).toBe(b);
    expect(DRINK_CATEGORIES).toContain(a);
  });

  it("builds a shelf of companion drinks that excludes the primary", () => {
    const primary = drinkAccentForVenue("venue-1lf3cw");
    const shelf = drinkShelfForVenue("venue-1lf3cw", primary);
    expect(shelf).toHaveLength(2);
    expect(shelf.includes(primary)).toBe(false);
    expect(new Set(shelf).size).toBe(2);
  });

  it("spreads accents across different venue ids", () => {
    const accents = new Set(
      [
        "venue-eltcmh",
        "venue-1lf3cw",
        "venue-xiesdn",
        "venue-1ha28jc",
        "venue-ru7vbr",
        "venue-dbukrn",
        "venue-1c2pk99",
        "venue-fejqqd",
      ].map(drinkAccentForVenue),
    );
    expect(accents.size).toBeGreaterThanOrEqual(4);
  });
});

describe("listScrapedPubs", () => {
  it("loads enrichment pubs with drink accents and source labels", async () => {
    const { listScrapedPubs } = await import("@/lib/scrapedPubs.server");
    const pubs = await listScrapedPubs();
    expect(pubs.length).toBeGreaterThanOrEqual(90);
    expect(pubs.every((pub) => pub.name.trim().length > 0)).toBe(true);
    expect(pubs.every((pub) => pub.drinkAccent)).toBe(true);
    expect(pubs.some((pub) => pub.source === "nicholsonspubs.co.uk")).toBe(true);
    expect(pubs.some((pub) => pub.source === "youngs.co.uk")).toBe(true);
  });
});
