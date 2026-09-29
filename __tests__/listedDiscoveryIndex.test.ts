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
