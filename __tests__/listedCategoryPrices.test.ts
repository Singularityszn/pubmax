import { describe, expect, it } from "vitest";

import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const NOW = Date.parse("2026-09-29T12:00:00Z");

function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return {
    venueId: "venue-one",
    name: "The One",
    category: "wine",
    priceGbp: 5.5,
    lane: "site-harvest",
    standing: "listed",
    sourceUrl: "https://pub.example/menu",
    publisher: "The One",
    observedAt: "2026-09-20T10:00:00Z",
    basis: null,
    sampleSize: null,
    drinkLabel: "Chardonnay",
    ...overrides,
  };
}

describe("listed category price projection", () => {
  it("keeps source, day and only stated serving for eligible non-beer quotes", () => {
    const rows = [
      { ...row(), servingSize: "125ml" },
      row({ priceGbp: 31.5, drinkLabel: "Chardonnay bottle" }),
      row({ category: "beer", priceGbp: 4.5 }),
      row({ standing: "estimate", sourceUrl: null, basis: "model", sampleSize: 4 }),
      row({ sourceUrl: "https://pub.example/menu", observedAt: "2025-01-01T00:00:00Z" }),
      row({ sourceUrl: "https://user:pass@pub.example/menu" }),
    ];

    expect(listedCategoryPrices(rows, NOW)).toEqual([
      {
        source: "listed",
        category: "wine",
        drinkLabel: "Chardonnay",
        priceGbp: 5.5,
        servingSize: "125ml",
        sourceUrl: "https://pub.example/menu",
        observedAt: "2026-09-20T10:00:00Z",
      },
      {
        source: "listed",
        category: "wine",
        drinkLabel: "Chardonnay bottle",
        priceGbp: 31.5,
        servingSize: null,
        sourceUrl: "https://pub.example/menu",
        observedAt: "2026-09-20T10:00:00Z",
      },
    ]);
  });

  it("bounds each category without sorting unknown serves by price", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      row({ drinkLabel: `Wine ${index}`, priceGbp: 30 - index }),
    );
    const projected = listedCategoryPrices(rows, NOW);
    expect(projected.length).toBeLessThanOrEqual(8);
    expect(projected.map((quote) => quote.drinkLabel)).toEqual(
      rows.slice(0, projected.length).map((quote) => quote.drinkLabel),
    );
  });
});
