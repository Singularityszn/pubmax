import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("fs", () => ({ promises: { readFile } }));

import { resetUkPriceBundleForTests, ukPriceBundleCategoryIndex } from "@/lib/ukPriceBundle.server";
import { discoveryDrinkLensPrices, readListedDrinkIndex } from "@/lib/mapExperienceLens";

const now = Date.parse("2026-09-29T12:00:00Z");
const row = { venueId: "listed-only", name: "Listed", category: "wine", priceGbp: 7.5,
  lane: "site-harvest", standing: "listed", sourceUrl: "https://pub.example/menu",
  publisher: "Pub", observedAt: "2026-09-20T12:00:00.000Z", basis: null, sampleSize: null };

beforeEach(() => { resetUkPriceBundleForTests(); readFile.mockReset(); });

describe("bounded listed/community discovery", () => {
  it("discovers listed-only venues before detail, preferring trusted community on overlap", async () => {
    readFile.mockResolvedValue(JSON.stringify([row, { ...row, venueId: "both" }, { ...row, venueId: "stale", observedAt: "2025-01-01T00:00:00.000Z" }, { ...row, venueId: "other", category: "cocktail" }]));
    const index = await ukPriceBundleCategoryIndex("wine", now);
    const listed = readListedDrinkIndex(index.prices, "wine");
    const prices = discoveryDrinkLensPrices(new Map([["both", [{ venueId: "both", drinkCategory: "wine", priceGbp: 9, submittedAt: now, source: "community", corroborations: 2 }]]]), "wine", listed, now);
    expect([...prices.keys()]).toEqual(["both", "listed-only"]);
    expect(prices.get("both")).toMatchObject({ source: "community", priceGbp: 9 });
    expect(prices.get("listed-only")).toMatchObject({ source: "listed", priceGbp: 7.5, sourceUrl: row.sourceUrl, observedAt: row.observedAt, servingSize: null });
    expect(index).toMatchObject({ truncated: false, degraded: false });
  });

  it("caps cross-venue quotes and reports partial coverage", async () => {
    readFile.mockResolvedValue(JSON.stringify(Array.from({ length: 1001 }, (_, i) => ({ ...row, venueId: `venue-${i}` }))));
    const index = await ukPriceBundleCategoryIndex("wine", now);
    expect(index.prices).toHaveLength(1000);
    expect(index.truncated).toBe(true);
  });

  it("fails closed on missing sources and expired client-held listings", async () => {
    readFile.mockRejectedValue(new Error("unavailable"));
    expect(await ukPriceBundleCategoryIndex("wine", now)).toEqual({ prices: [], degraded: true, truncated: false });
    const listed = readListedDrinkIndex([{ ...row, servingSize: null, source: "listed" }], "wine");
    expect(discoveryDrinkLensPrices(new Map(), "wine", listed, Date.parse("2028-01-01T00:00:00Z")).size).toBe(0);
    expect(readListedDrinkIndex([{ ...row, source: "listed", servingSize: null, sourceUrl: "javascript:alert(1)" }], "wine")).toEqual([]);
  });
});


describe("listed serving alternatives survive discovery reads", () => {
  it("keeps a venue's stated serving groups even when an unknown-serving quote is newer", async () => {
    readFile.mockResolvedValue(JSON.stringify([
      { ...row, drinkLabel: "House wine bottle", priceGbp: 31.5,
        observedAt: "2026-09-28T12:00:00.000Z" },
      { ...row, drinkLabel: "Rioja", priceGbp: 6.5, servingSize: "125ml",
        observedAt: "2026-09-27T12:00:00.000Z" },
      { ...row, drinkLabel: "Rioja", priceGbp: 11, servingSize: "250ml",
        observedAt: "2026-09-27T12:00:00.000Z" },
    ]));

    const index = await ukPriceBundleCategoryIndex("wine", now);

    expect(index.prices).toHaveLength(3);
    expect(index.prices).toEqual(expect.arrayContaining([
      expect.objectContaining({ venueId: "listed-only", drinkLabel: "Rioja",
        priceGbp: 6.5, servingSize: "125ml", source: "listed" }),
      expect.objectContaining({ venueId: "listed-only", drinkLabel: "Rioja",
        priceGbp: 11, servingSize: "250ml", source: "listed" }),
      expect.objectContaining({ venueId: "listed-only", drinkLabel: "House wine bottle",
        priceGbp: 31.5, servingSize: null, source: "listed" }),
    ]));
    expect(index).toMatchObject({ truncated: false, degraded: false });
  });

  it("keeps the source-stated drink name with a listed offer in the client reader", () => {
    const listed = readListedDrinkIndex([
      { ...row, source: "listed", drinkLabel: "Rioja", servingSize: "125ml" },
    ], "wine");

    expect(listed).toEqual([
      expect.objectContaining({ venueId: "listed-only", drinkLabel: "Rioja",
        category: "wine", priceGbp: 7.5, servingSize: "125ml", source: "listed",
        sourceUrl: row.sourceUrl, observedAt: row.observedAt }),
    ]);
  });
});


describe("explicit listed serving discovery", () => {
  const fiveServingRows = [
    { ...row, category: "gin", drinkLabel: "Named gin", servingSize: "25ml",
      priceGbp: 4.2, observedAt: "2026-09-28T12:00:00.000Z" },
    { ...row, category: "gin", drinkLabel: "Named gin", servingSize: "50ml",
      priceGbp: 6, observedAt: "2026-09-27T12:00:00.000Z" },
    { ...row, category: "gin", drinkLabel: "Named gin", servingSize: "20ml",
      priceGbp: 3.5, observedAt: "2026-09-26T12:00:00.000Z" },
    { ...row, category: "gin", drinkLabel: "Named gin", servingSize: "10ml",
      priceGbp: 2.5, observedAt: "2026-09-25T12:00:00.000Z" },
    { ...row, category: "gin", drinkLabel: "Named gin", servingSize: "35ml",
      priceGbp: 5, observedAt: "2026-09-24T12:00:00.000Z" },
    { ...row, category: "gin", drinkLabel: "Expired gin", servingSize: "99ml",
      observedAt: "2020-01-01T00:00:00.000Z" },
    { ...row, category: "gin", servingSize: "75ml", priceGbp: 9,
      sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
      drinkLabel: "0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0%" },
  ];

  it("discovers all eligible serving choices while keeping four default quotes per venue", async () => {
    readFile.mockResolvedValue(JSON.stringify(fiveServingRows));

    const index = await ukPriceBundleCategoryIndex("gin", now);

    expect(index.prices).toHaveLength(4);
    expect(index.prices.map((quote) => quote.servingSize)).toEqual(expect.arrayContaining(["25ml", "50ml", "20ml", "10ml"]));
    expect(index.servingGroups).toEqual(["10ml", "20ml", "25ml", "35ml", "50ml"]);
    expect(index).toMatchObject({ truncated: false, degraded: false });
  });

  it("returns a selected eligible serving before the four-quote venue projection", async () => {
    readFile.mockResolvedValue(JSON.stringify(fiveServingRows));

    const index = await ukPriceBundleCategoryIndex("gin", now, "35ml");

    expect(index.prices).toEqual([expect.objectContaining({
      venueId: "listed-only", category: "gin", drinkLabel: "Named gin", servingSize: "35ml",
      priceGbp: 5, source: "listed", sourceUrl: row.sourceUrl,
      observedAt: "2026-09-24T12:00:00.000Z",
    })]);
    expect(index.servingGroups).toEqual(["10ml", "20ml", "25ml", "35ml", "50ml"]);
    expect(index).toMatchObject({ truncated: false, degraded: false });
  });

  it("filters a selected printed serving before the global quote cap and reports actual groups", async () => {
    const gin = { ...row, category: "gin", drinkLabel: "Named gin" };
    readFile.mockResolvedValue(JSON.stringify([
      ...Array.from({ length: 1001 }, (_, index) => ({ ...gin,
        venueId: `unknown-${index}`, priceGbp: 2 })),
      { ...gin, venueId: "venue-uk-n1001", servingSize: "25ml", priceGbp: 4.2 },
      { ...gin, venueId: "venue-uk-n1002", servingSize: "50ml", priceGbp: 6 },
      { ...gin, venueId: "expired", servingSize: "35ml",
        observedAt: "2020-01-01T00:00:00.000Z" },
    ]));

    const index = await ukPriceBundleCategoryIndex("gin", now, "25ml");

    expect(index.prices).toEqual([expect.objectContaining({
      venueId: "venue-uk-n1001", servingSize: "25ml", drinkLabel: "Named gin", priceGbp: 4.2,
    })]);
    expect(index.servingGroups).toEqual(["25ml", "50ml"]);
    expect(index.truncated).toBe(false);
  });

  it("keeps the 1000 quote cap and honest truncation within a selected serving", async () => {
    readFile.mockResolvedValue(JSON.stringify(Array.from({ length: 1001 }, (_, index) => ({
      ...row, category: "gin", venueId: `venue-uk-n${index}`, servingSize: "25ml",
    }))));
    const index = await ukPriceBundleCategoryIndex("gin", now, "25ml");
    expect(index.prices).toHaveLength(1000);
    expect(index.prices.every((quote) => quote.servingSize === "25ml")).toBe(true);
    expect(index.servingGroups).toEqual(["25ml"]);
    expect(index.truncated).toBe(true);
  });
});
