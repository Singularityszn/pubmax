import { describe, it, expect } from "vitest";

import {
  pintFactStats,
  hasFactData,
  factBlockSentences,
  faqItems,
  faqPageJsonLd,
  type PricedPubLike,
} from "@/lib/pintFacts";

const evidence = { priceSource: "Pub menu", priceObservedAt: "2026-01-01" };

const HACKNEY: PricedPubLike[] = [
  { ...evidence, name: "The Cheap One", cheapestPrice: 5.0 },
  { ...evidence, name: "The Middle", cheapestPrice: 6.0 },
  { ...evidence, name: "The Dear One", cheapestPrice: 7.0 },
  { ...evidence, name: "No Price Yet", cheapestPrice: null },
];

describe("pintFactStats", () => {
  it("computes average/min/max/count over per-pub cheapest pints", () => {
    const stats = pintFactStats(HACKNEY, "Hackney", "hackney");
    expect(stats.pubCount).toBe(3); // three priced pubs
    expect(stats.totalPubCount).toBe(4); // incl. the price-less one
    expect(stats.averageGbp).toBe(6.0); // (5 + 6 + 7) / 3
    expect(stats.minGbp).toBe(5.0);
    expect(stats.minPubName).toBe("The Cheap One");
    expect(stats.maxGbp).toBe(7.0);
    expect(stats.maxPubName).toBe("The Dear One");
  });

  it("rounds the average to pence", () => {
    const stats = pintFactStats(
      [
        { ...evidence, name: "A", cheapestPrice: 5.0 },
        { ...evidence, name: "B", cheapestPrice: 5.0 },
        { ...evidence, name: "C", cheapestPrice: 6.0 },
      ],
      "Test",
      "test",
    );
    // (5 + 5 + 6) / 3 = 5.3333… → 5.33
    expect(stats.averageGbp).toBe(5.33);
  });

  it("breaks min/max ties on pub name (A–Z), deterministically", () => {
    const stats = pintFactStats(
      [
        { ...evidence, name: "Zebra", cheapestPrice: 5.0 },
        { ...evidence, name: "Apple", cheapestPrice: 5.0 },
      ],
      "Ties",
      "ties",
    );
    expect(stats.minGbp).toBe(5.0);
    expect(stats.minPubName).toBe("Apple"); // name tiebreak
    expect(stats.maxPubName).toBe("Apple");
  });

  it("returns null figures when no pub carries a price", () => {
    const stats = pintFactStats(
      [{ ...evidence, name: "Unpriced", cheapestPrice: null }],
      "Empty",
      "empty",
    );
    expect(stats.pubCount).toBe(0);
    expect(stats.totalPubCount).toBe(1);
    expect(stats.averageGbp).toBeNull();
    expect(stats.minGbp).toBeNull();
    expect(stats.minPubName).toBeNull();
    expect(hasFactData(stats)).toBe(false);
  });

  it("handles a single priced pub (min === max)", () => {
    const stats = pintFactStats(
      [{ ...evidence, name: "Solo", cheapestPrice: 4.5 }],
      "One",
      "one",
    );
    expect(stats.averageGbp).toBe(4.5);
    expect(stats.minGbp).toBe(4.5);
    expect(stats.maxGbp).toBe(4.5);
    expect(stats.minPubName).toBe("Solo");
    expect(hasFactData(stats)).toBe(true);
  });

  it("keeps the worked average's unknown row and each alphabetical extreme's own evidence", () => {
    const row = (name: string, price: number, day: string): PricedPubLike => ({
      name, cheapestPrice: price, prices: [{ price_gbp: price,
        pint_name: `${name} lager`, measure: "pint", pub_url: `https://${name}.example/menu`, scraped_at_values: day }],
    });
    const pubs: PricedPubLike[] = [row("ZebraLow", 4, "2026-10-02"), row("AppleLow", 4, "2026-07-03"),
      row("ZebraHigh", 7, "2026-07-03"), row("AppleHigh", 7, "2026-10-02"),
      { name: "Unknown", cheapestPrice: 9 },
      { name: "Half", cheapestPrice: 1, measure: "half-pint" },
      { name: "Bottle", cheapestPrice: 20, cheapestPint: "BOTTLED BEER" },
      { name: "Unpriced", cheapestPrice: null }];
    const stats = pintFactStats(pubs, "Test", "test");
    expect(stats).toMatchObject({ averageGbp: 6.2, pubCount: 5, totalPubCount: 8,
      publisherCount: 4, undatedCount: 1, minPubName: "AppleLow", maxPubName: "AppleHigh",
      minEvidence: { priceGbp: 4, publisher: { url: "https://AppleLow.example/menu" }, observedOn: "2026-07-03" },
      maxEvidence: { priceGbp: 7, publisher: { url: "https://AppleHigh.example/menu" }, observedOn: "2026-10-02" } });
    expect(pintFactStats([...pubs].reverse(), "Test", "test")).toEqual(stats);
  });
});

describe("factBlockSentences", () => {
  const opts = { monthYear: "July 2026", observedDate: "16 July 2026" };

  it("produces the PRD-shaped extractable prose", () => {
    const stats = pintFactStats(HACKNEY, "Hackney", "hackney");
    const sentences = factBlockSentences(stats, opts);
    // Flat fixtures carry their own source day, just as the slim DTO does.
    expect(sentences[0]).toBe(
      "From prices read on 1 January 2026, the average pint in Hackney costs £6.00 across 3 tracked pubs. 3 of 3 prices name a publisher. 3 of 3 record a full read day.",
    );
    expect(sentences[1]).toBe(
      "The cheapest tracked pint is £5.00 at The Cheap One. Pint name unavailable (Serving size not recorded). Listed by Pub menu, collected on 1 January 2026.",
    );
    // Range sentence present because min !== max.
    expect(sentences.some((s) => s.includes("range from £5.00 to £7.00"))).toBe(
      true,
    );
    // Provenance stamp, never presented as live.
    const last = sentences[sentences.length - 1];
    expect(last).toContain("Prices last collected 16 July 2026");
    expect(last).toContain("Never a live feed");
    const joined = sentences.join(" ");
    expect(joined).not.toMatch(/\bprices are live\b|\blive prices\b/i);
  });

  it("omits the range sentence when min === max", () => {
    const stats = pintFactStats(
      [{ ...evidence, name: "Solo", cheapestPrice: 4.5 }],
      "One",
      "one",
    );
    const sentences = factBlockSentences(stats, opts);
    expect(sentences.some((s) => s.includes("range from"))).toBe(false);
  });

  it("returns nothing when there's no priced data", () => {
    const stats = pintFactStats([{ ...evidence, name: "x", cheapestPrice: null }], "E", "e");
    expect(factBlockSentences(stats, opts)).toEqual([]);
  });

  it("uses singular 'pub' for a single tracked pub", () => {
    const stats = pintFactStats([{ ...evidence, name: "Solo", cheapestPrice: 5 }], "One", "one");
    expect(factBlockSentences(stats, opts)[0]).toContain("across 1 tracked pub.");
  });
});

describe("faqItems", () => {
  const opts = {
    monthYear: "July 2026",
    year: "2026",
    observedDate: "16 July 2026",
  };

  it("answers the three core questions from data", () => {
    const stats = pintFactStats(HACKNEY, "Hackney", "hackney");
    const items = faqItems(stats, opts);
    const questions = items.map((i) => i.question);
    expect(questions).toContain("What is the cheapest pint in Hackney?");
    expect(questions).toContain("How much is a pint in Hackney in 2026?");
    expect(questions).toContain("How many pubs does Hackney have on PUBMAXX?");
    // Cheapest answer cites the pub + price.
    const cheapest = items.find((i) => i.question.startsWith("What is the cheapest"));
    expect(cheapest?.answer).toContain("£5.00 at The Cheap One");
  });

  it("skips every question when no answer data exists", () => {
    const stats = pintFactStats([{ ...evidence, name: "x", cheapestPrice: null }], "E", "e");
    expect(faqItems(stats, opts)).toEqual([]);
  });
});

describe("faqPageJsonLd", () => {
  it("builds a FAQPage graph from items", () => {
    const stats = pintFactStats(HACKNEY, "Hackney", "hackney");
    const ld = faqPageJsonLd(faqItems(stats, {
      monthYear: "July 2026",
      year: "2026",
    }));
    expect(ld).not.toBeNull();
    expect(ld!["@type"]).toBe("FAQPage");
    expect(Array.isArray(ld!.mainEntity)).toBe(true);
  });

  it("returns null with no items so the caller omits the block", () => {
    expect(faqPageJsonLd([])).toBeNull();
  });
});
