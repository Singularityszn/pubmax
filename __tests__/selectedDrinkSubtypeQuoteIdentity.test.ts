import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommunityPrice } from "@/lib/communityPrice";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { discoveryDrinkLensPrices, type MapLensPrice } from "@/lib/mapExperienceLens";
import { drinkCategoryIndexKey } from "@/lib/listedPriceComparison";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { resetUkPriceBundleForTests, ukPriceBundleCategoryIndex } from "@/lib/ukPriceBundle.server";

const fixture = vi.hoisted(() => ({ rows: [] as UkPriceBundleRow[] }));
vi.mock("server-only", () => ({}));
vi.mock("fs", async (original) => {
  const actual = await original<typeof import("fs")>();
  return { ...actual, promises: { ...actual.promises, readFile: vi.fn(async () => JSON.stringify(fixture.rows)) } };
});

const NOW = Date.parse("2026-10-03T12:00:00Z");
const SOURCE = "https://pub.example/menu";
const OBSERVED = "2026-10-01T12:00:00Z";

function row(drinkLabel: string | null, priceGbp: number, overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return { venueId: "pub-one", name: "The One", category: "wine", priceGbp,
    lane: "site-harvest", standing: "listed", sourceUrl: SOURCE, publisher: "The One",
    observedAt: OBSERVED, basis: null, sampleSize: null, servingSize: "175ml",
    ...(drinkLabel ? { drinkLabel } : {}), ...overrides };
}

function quote(drinkLabel: string, priceGbp: number): MapLensPrice {
  return { venueId: "pub-one", category: "wine", categoryLabel: "Wine", priceGbp,
    source: "listed", servingSize: "175ml", drinkLabel, sourceUrl: SOURCE, observedAt: OBSERVED };
}

beforeEach(() => { fixture.rows = []; resetUkPriceBundleForTests(); });

describe("selected drink subtype quote identity", () => {
  it("filters named wine before the same-serving minimum, keeping generic wine unchanged", () => {
    const rows = [row("Chardonnay", 4), row("Rioja", 8)];
    expect(listedCategoryPrices(rows, NOW, { serving: "175ml" })[0]).toMatchObject({ drinkLabel: "Chardonnay", priceGbp: 4 });
    expect(listedCategoryPrices(rows, NOW, { serving: "175ml", drinkSubtype: "wine-red" })).toEqual([
      { source: "listed", category: "wine", drinkLabel: "Rioja", priceGbp: 8,
        servingSize: "175ml", sourceUrl: SOURCE, observedAt: OBSERVED },
    ]);
    expect(listedCategoryPrices(rows, NOW, { serving: "175ml", drinkSubtype: "wine-white" })[0])
      .toMatchObject({ drinkLabel: "Chardonnay", priceGbp: 4 });
  });

  it("filters subtype before the quote cap instead of losing a later red quote", () => {
    const rows = [1, 2, 3, 4].map((n) => row(`Chardonnay bottle ${n}`, n, { servingSize: undefined }));
    rows.push(row("Rioja glass", 8, { servingSize: undefined }));
    expect(listedCategoryPrices(rows, NOW, { drinkSubtype: "wine-red" }))
      .toEqual([expect.objectContaining({ drinkLabel: "Rioja glass", priceGbp: 8, servingSize: null })]);
  });

  it("does not borrow unnamed, unmatched, or stale authority for a subtype", () => {
    const rows = [row(null, 1), row("Chardonnay", 2), row("Rioja", 3, { observedAt: "2025-01-01T12:00:00Z" })];
    expect(listedCategoryPrices(rows, NOW, { drinkSubtype: "wine-red" })).toEqual([]);
  });

  it("keeps actual cider pint and ml groups separate from lager and unknown servings", () => {
    const rows = [row("Lager", 2, { category: "beer", servingSize: "pint" }),
      row("Apple cider", 6.3, { category: "beer", servingSize: "pint" }),
      row("Pear cider", 4, { category: "beer", servingSize: "500ml" }),
      row("Cider bottle", 1, { category: "beer", servingSize: undefined })];
    expect(listedCategoryPrices(rows, NOW)).toEqual([]);
    expect(listedCategoryPrices(rows, NOW, { includeBeer: true, drinkSubtype: "beer-cider", serving: "pint" }))
      .toEqual([expect.objectContaining({ drinkLabel: "Apple cider", priceGbp: 6.3, servingSize: "pint" })]);
    expect(listedCategoryPrices(rows, NOW, { includeBeer: true, drinkSubtype: "beer-cider", serving: "500ml" }))
      .toEqual([expect.objectContaining({ drinkLabel: "Pear cider", priceGbp: 4, servingSize: "500ml" })]);
  });

  it("matches closed family members without accepting ordinary cola", () => {
    const rows = [row("Coca-Cola", 1, { category: "soft-drink", servingSize: "330ml" }),
      row("Diet Coke", 4, { category: "soft-drink", servingSize: "330ml" }),
      row("Pepsi Max", 5, { category: "soft-drink", servingSize: "330ml" })];
    expect(listedCategoryPrices(rows, NOW, { drinkSubtype: "soft-drink-zero-sugar-cola", serving: "330ml" }))
      .toEqual([expect.objectContaining({ drinkLabel: "Diet Coke", priceGbp: 4 })]);
  });

  it("indexes selected quotes from actual bundle parsing without first reducing the generic category", async () => {
    fixture.rows = [row("Chardonnay", 4), row("Rioja", 8)];
    expect((await ukPriceBundleCategoryIndex("wine", NOW, "175ml", "wine-red")).prices)
      .toEqual([expect.objectContaining({ venueId: "pub-one", drinkLabel: "Rioja", priceGbp: 8 })]);
    expect((await ukPriceBundleCategoryIndex("wine", NOW, "175ml", "wine-white")).prices)
      .toEqual([expect.objectContaining({ venueId: "pub-one", drinkLabel: "Chardonnay", priceGbp: 4 })]);
  });

  it("refuses category-wide community authority when a named subtype is selected", () => {
    const community: CommunityPrice = { venueId: "pub-one", drinkCategory: "wine", priceGbp: 1,
      submittedAt: NOW, source: "community", corroborations: 2,
      mapCandidate: { priceGbp: 1, submittedAt: NOW, corroborations: 2 } };
    const rows = new Map([["pub-one", [community]]]);
    const listed = [quote("Chardonnay", 4), quote("Rioja", 8)];
    expect(discoveryDrinkLensPrices(rows, "wine", listed, NOW).get("pub-one")?.source).toBe("community");
    expect(discoveryDrinkLensPrices(rows, "wine", listed, NOW, "175ml").get("pub-one"))
      .toMatchObject({ drinkLabel: "Chardonnay", priceGbp: 4, source: "listed" });
    expect(discoveryDrinkLensPrices(rows, "wine", listed, NOW, undefined, "wine-red").get("pub-one"))
      .toMatchObject({ drinkLabel: "Rioja", priceGbp: 8, source: "listed", sourceUrl: SOURCE, observedAt: OBSERVED });
    expect(discoveryDrinkLensPrices(rows, "wine", listed, NOW, "175ml", "wine-red").get("pub-one"))
      .toMatchObject({ drinkLabel: "Rioja", priceGbp: 8, source: "listed", sourceUrl: SOURCE, observedAt: OBSERVED });
    expect(discoveryDrinkLensPrices(rows, "wine", [quote("Chardonnay", 4)], NOW, "175ml", "wine-red").size).toBe(0);
  });

  it("separates subtype caches while preserving invalid and cross-category generic keys", () => {
    const generic = drinkCategoryIndexKey("wine", "175ml");
    const red = drinkCategoryIndexKey("wine", "175ml", "wine-red");
    const white = drinkCategoryIndexKey("wine", "175ml", "wine-white");
    expect(red).not.toBe(generic);
    expect(white).not.toBe(generic);
    expect(red).not.toBe(white);
    expect(drinkCategoryIndexKey("wine", "175ml", "beer-cider")).toBe(generic);
    expect(drinkCategoryIndexKey("wine", "175ml", "made-up")).toBe(generic);
  });
});
