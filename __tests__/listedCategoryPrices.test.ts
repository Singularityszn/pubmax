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
  it("recovers only the retained Brownswood gin's printed serving and preserves provenance", () => {
    const gin = row({ category: "gin", priceGbp: 4.2,
      sourceUrl: "https://thebrownswood.co.uk/drinks-menu/", drinkLabel: "Gin ~ 25 ml Sacred –" });
    expect(listedCategoryPrices([gin], NOW)).toEqual([
      { source: "listed", category: "gin", priceGbp: 4.2, servingSize: "25ml",
        sourceUrl: gin.sourceUrl, observedAt: gin.observedAt, drinkLabel: gin.drinkLabel },
    ]);
    expect(gin).not.toHaveProperty("servingSize");
    expect(listedCategoryPrices([{ ...gin, servingSize: "50ml" }], NOW)[0].servingSize).toBe("50ml");
    for (const unknown of [
      { ...gin, drinkLabel: "Sacred" },
      { ...gin, sourceUrl: "https://another-pub.example/menu" },
      { ...gin, category: "vodka" },
      { ...gin, lane: "drink-price-update" as const },
    ]) {
      expect(listedCategoryPrices([unknown], NOW)[0].servingSize).toBeNull();
    }
  });

  it("keeps source, day and only stated serving for eligible non-beer quotes", () => {
    const rows = [
      { ...row(), servingSize: "125ml" },
      row({ priceGbp: 31.5, drinkLabel: "Chardonnay bottle" }),
      row({ category: "beer", priceGbp: 4.5 }),
      row({
        standing: "estimate",
        sourceUrl: null,
        basis: "model",
        sampleSize: 4,
      }),
      row({
        sourceUrl: "https://pub.example/menu",
        observedAt: "2025-01-01T00:00:00Z",
      }),
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

  it("keeps the lowest eligible quote in each stated serving group when same-day rows exceed the cap", () => {
    const rows = [
      {
        ...row({ drinkLabel: "Chenin glass", priceGbp: 5.75 }),
        servingSize: "125ml",
      },
      {
        ...row({ drinkLabel: "Chenin large", priceGbp: 11.5 }),
        servingSize: "250ml",
      },
      {
        ...row({ drinkLabel: "Malbec glass", priceGbp: 6.75 }),
        servingSize: "125ml",
      },
      {
        ...row({ drinkLabel: "Malbec large", priceGbp: 13.5 }),
        servingSize: "250ml",
      },
      {
        ...row({ drinkLabel: "Rioja glass", priceGbp: 5.25 }),
        servingSize: "125ml",
      },
      {
        ...row({ drinkLabel: "Rioja large", priceGbp: 10.5 }),
        servingSize: "250ml",
      },
      {
        ...row({ drinkLabel: "Chenin bottle", priceGbp: 31.5 }),
        servingSize: "Btl",
      },
    ];

    const projected = listedCategoryPrices(rows, NOW);
    expect(projected.length).toBeLessThanOrEqual(4);
    expect(projected.filter((quote) => quote.servingSize === "125ml")).toEqual([
      expect.objectContaining({ drinkLabel: "Rioja glass", priceGbp: 5.25 }),
    ]);
    expect(projected.filter((quote) => quote.servingSize === "250ml")).toEqual([
      expect.objectContaining({ drinkLabel: "Rioja large", priceGbp: 10.5 }),
    ]);
    expect(projected.find((quote) => quote.servingSize === "Btl")).toEqual(
      expect.objectContaining({ drinkLabel: "Chenin bottle", priceGbp: 31.5 }),
    );
  });

  it("uses the newest reading for one named drink and serving before comparing distinct drinks", () => {
    const rows = [
      {
        ...row({ drinkLabel: "Rioja", priceGbp: 5, observedAt: "2026-07-11T10:00:00Z" }),
        servingSize: "125ml",
      },
      {
        ...row({ drinkLabel: "Rioja", priceGbp: 6, observedAt: "2026-09-29T10:00:00Z" }),
        servingSize: "125ml",
      },
      {
        ...row({ drinkLabel: "Chenin", priceGbp: 5.5, observedAt: "2026-09-28T10:00:00Z" }),
        servingSize: "125ml",
      },
    ];

    expect(listedCategoryPrices(rows.slice(0, 2), NOW)).toEqual([
      expect.objectContaining({
        drinkLabel: "Rioja",
        priceGbp: 6,
        observedAt: "2026-09-29T10:00:00Z",
      }),
    ]);
    expect(listedCategoryPrices(rows, NOW)).toEqual([
      expect.objectContaining({ drinkLabel: "Chenin", priceGbp: 5.5 }),
    ]);
  });

  it.each(["forward", "reverse"] as const)(
    "uses newest named-drink reading across equivalent serving spellings (%s)",
    (order) => {
      const older = {
        ...row({
          drinkLabel: "Sauvignon Blanc",
          priceGbp: 4,
          observedAt: "2026-09-18T10:00:00Z",
        }),
        servingSize: "25 ml",
      };
      const newer = {
        ...row({
          drinkLabel: "Sauvignon Blanc",
          priceGbp: 6.25,
          observedAt: "2026-09-28T10:00:00Z",
        }),
        servingSize: "25ml",
      };
      const input = order === "forward" ? [older, newer] : [newer, older];

      expect(listedCategoryPrices(input, NOW)).toEqual([
        expect.objectContaining({
          drinkLabel: "Sauvignon Blanc",
          priceGbp: 6.25,
          servingSize: "25ml",
          observedAt: "2026-09-28T10:00:00Z",
        }),
      ]);
    },
  );

  it("still compares distinct named drinks by price within a canonical serving", () => {
    const dearerNewer = {
      ...row({
        drinkLabel: "Pinot Noir",
        priceGbp: 9,
        observedAt: "2026-09-28T10:00:00Z",
      }),
      servingSize: "125 ml",
    };
    const cheaperOlder = {
      ...row({
        drinkLabel: "House red",
        priceGbp: 5.25,
        observedAt: "2026-09-24T10:00:00Z",
      }),
      servingSize: "125ml",
    };

    expect(listedCategoryPrices([dearerNewer, cheaperOlder], NOW)).toEqual([
      expect.objectContaining({
        drinkLabel: "House red",
        priceGbp: 5.25,
        servingSize: "125ml",
      }),
    ]);
  });

  it("keeps distinct volumes and distinct unranked raw serves for one drink", () => {
    const quotes = [
      { ...row({ drinkLabel: "House red", priceGbp: 5 }), servingSize: "125ml" },
      { ...row({ drinkLabel: "House red", priceGbp: 10 }), servingSize: "250ml" },
      { ...row({ drinkLabel: "House red", priceGbp: 14 }), servingSize: "carafe" },
      { ...row({ drinkLabel: "House red", priceGbp: 2 }), servingSize: "small glass" },
    ];

    expect(listedCategoryPrices(quotes, NOW).map((quote) => quote.servingSize).sort())
      .toEqual(["125ml", "250ml", "carafe", "small glass"]);
  });

  it("does not merge unnamed quotes with unknown servings into a drink identity", () => {
    const rows = [
      row({ drinkLabel: undefined, priceGbp: 7, observedAt: "2026-09-29T10:00:00Z" }),
      row({ drinkLabel: undefined, priceGbp: 5, observedAt: "2026-09-28T10:00:00Z" }),
    ];

    expect(listedCategoryPrices(rows, NOW).map((quote) => quote.priceGbp)).toEqual([7, 5]);
  });
});


describe("base-only published beer projection", () => {
  it("opts in to listed beer without a pint assumption, rank or estimated quote", () => {
    const beer = row({
      venueId: "venue-uk-n10167487694", name: "Donard Bar", category: "beer",
      priceGbp: 4.9, drinkLabel: undefined, sourceUrl: "https://donardbar.co.uk/menus/",
      observedAt: "2026-09-04T10:00:00Z",
    });
    const rows = [beer, { ...beer, standing: "estimate" as const, sourceUrl: null, priceGbp: 1 }];
    expect(listedCategoryPrices(rows, NOW)).toEqual([]);
    expect(listedCategoryPrices(rows, NOW, { includeBeer: true })).toEqual([{
      source: "listed", category: "beer", drinkLabel: null, priceGbp: 4.9,
      servingSize: null, sourceUrl: "https://donardbar.co.uk/menus/",
      observedAt: "2026-09-04T10:00:00Z",
    }]);
  });

  it("keeps stated beer quotes in source order rather than cheapest-serving groups", () => {
    const beers = [7, 4, 6, 5, 3].map((priceGbp, index) => ({
      ...row({ category: "beer", drinkLabel: `Beer ${index}`, priceGbp }), servingSize: "pint",
    }));
    expect(listedCategoryPrices(beers, NOW, { includeBeer: true }).map(quote => quote.priceGbp))
      .toEqual([7, 4, 6, 5]);
  });
});
