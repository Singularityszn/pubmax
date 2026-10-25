import { describe, expect, it } from "vitest";
import { loadedListedDrinkCoverage, listedMapDrinkCoverageRows } from "@/lib/listedMapDrinkCoverage";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
const row: UkPriceBundleRow = { venueId: "pub-1", name: "Pub", category: "coffee", priceGbp: 2.5, lane: "site-harvest", standing: "listed", sourceUrl: "https://example.com/menu", publisher: "example.com", observedAt: "2026-10-25T10:00:00Z", basis: null, sampleSize: null, drinkLabel: "Single Espresso" };
describe("listed map drink coverage publication", () => {
  it("keeps each pub and category once with its own newest observation day", () => {
    expect(listedMapDrinkCoverageRows([row, { ...row, priceGbp: 3 }, { ...row, observedAt: "2026-10-01" }, { ...row, category: "alcohol-free" }], Date.parse("2026-10-25T12:00:00Z"))).toEqual([
      { venueId: "pub-1", category: "coffee", observedAt: row.observedAt },
      { venueId: "pub-1", category: "alcohol-free", observedAt: row.observedAt },
    ]);
  });
  it("excludes estimates, expired and future prices", () => {
    expect(listedMapDrinkCoverageRows([{ ...row, standing: "estimate", sourceUrl: null, basis: "borough", sampleSize: 10 }, { ...row, observedAt: "2024-01-01" }, { ...row, observedAt: "2027-01-01" }], Date.parse("2026-10-25"))).toEqual([]);
  });
});

it("counts loaded pub identities once and keeps dates from their source rows", () => {
  const indexed = [{ venueId: "pub-1", category: "coffee", observedAt: "2026-10-25T10:00:00Z" }, { venueId: "pub-2", category: "coffee", observedAt: "2026-10-20" }];
  expect(loadedListedDrinkCoverage([...indexed, indexed[0]], ["pub-1", "pub-1", "cafe-1"], "coffee", Date.parse("2026-10-25T12:00:00Z"))).toEqual({ count: 1, newest: "2026-10-25T10:00:00Z" });
  expect(loadedListedDrinkCoverage(indexed, ["pub-1"], "alcohol-free", Date.parse("2026-10-25T12:00:00Z"))).toEqual({ count: 0, newest: null });
});
