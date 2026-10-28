import { describe, expect, it } from "vitest";
import { mapNearbyPriceForVenue } from "@/lib/mapNearbyPrice";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import { initialFilters } from "@/lib/venues";
import { nearbyPriceRow, nearbyVenue } from "./helpers/mapNearbyFixtures";

function lens(overrides: Partial<MapLensPrice> = {}): Map<string, MapLensPrice> {
  return new Map([["venue-crown", {
    venueId: "venue-crown", category: "gin", categoryLabel: "Gin", priceGbp: 3.5,
    source: "community", submittedAt: Date.parse("2026-10-21T12:00:00Z"), ...overrides,
  }]]);
}

describe("nearby exact drink prices", () => {
  it("keeps the selected pint with its own publisher and read day", () => {
    expect(mapNearbyPriceForVenue(nearbyVenue(), initialFilters)).toMatchObject({
      drinkLabel: "Guinness", category: "beer", priceGbp: 4.5, measureLabel: "pint", servingKnown: true,
      sourceLabel: "Pint Prices", sourceUrl: "https://www.pint-prices.com/pub/crown", observedAt: "2026-10-20T12:00:00.000Z",
    });
  });

  it("uses a gin row's stated serving instead of its cheaper pint", () => {
    const venue = nearbyVenue({ prices: [nearbyPriceRow(), nearbyPriceRow({ pint_name: "House gin 25ml", price_gbp: 5 })] });
    expect(mapNearbyPriceForVenue(venue, { ...initialFilters, drinkCategory: "gin" })).toMatchObject({
      drinkLabel: "House gin 25ml", priceGbp: 5, category: "gin", measureLabel: "25ml", servingKnown: true,
    });
  });

  it("does not assign a specific drink or serving to a category report", () => {
    const result = mapNearbyPriceForVenue(nearbyVenue(), { ...initialFilters, drinkCategory: "gin" }, lens());
    expect(result).toMatchObject({ drinkLabel: "Gin", priceGbp: 3.5, measureLabel: "", servingKnown: false, sourceLabel: "Drinker reports" });
    expect(result?.observedAt).toBe("2026-10-21T12:00:00.000Z");
  });

  it("does not answer a brand, subtype or top-shelf request with a category report", () => {
    for (const refinement of [{ drinkBrand: "hendricks" }, { drinkSubtype: "gin-london-dry" }, { topShelfOnly: true }]) {
      expect(mapNearbyPriceForVenue(nearbyVenue(), { ...initialFilters, drinkCategory: "gin", ...refinement }, lens())).toBeNull();
    }
  });

  it("matches the requested brand's own row, not another pint in the same pub", () => {
    const venue = nearbyVenue({ prices: [nearbyPriceRow({ pint_name: "Amstel", price_gbp: 3 }), nearbyPriceRow({ price_gbp: 5 })], cheapestPint: "Amstel", cheapestPrice: 3 });
    expect(mapNearbyPriceForVenue(venue, { ...initialFilters, drinkBrand: "guinness" })).toMatchObject({ drinkLabel: "Guinness", priceGbp: 5 });
  });

  it("does not reuse a community category price for a different drink", () => {
    expect(mapNearbyPriceForVenue(nearbyVenue({ prices: [], cheapestPrice: null }), { ...initialFilters, drinkCategory: "wine" }, lens())).toBeNull();
  });

  it("keeps serving and source unknown when the record does not state them", () => {
    const venue = nearbyVenue({ prices: [nearbyPriceRow({ pint_name: "House gin", price_gbp: 5, pub_url: "", scraped_at_values: "" })] });
    expect(mapNearbyPriceForVenue(venue, { ...initialFilters, drinkCategory: "gin" })).toMatchObject({ measureLabel: "", servingKnown: false });
    expect(mapNearbyPriceForVenue(venue, { ...initialFilters, drinkCategory: "gin" })?.sourceLabel).toBeUndefined();
  });
});

describe("nearby price exclusions", () => {
  it("keeps a trusted no-alcohol category price separate from a cheaper pint", () => {
    const result = mapNearbyPriceForVenue(nearbyVenue(), { ...initialFilters, requireNonAlcoholic: true }, lens({ category: "soft-drink", categoryLabel: "Soft drinks", priceGbp: 5 }));
    expect(result).toMatchObject({ priceGbp: 5, category: "soft-drink", measureLabel: "", servingKnown: false });
  });

  it("does not restore a retired row through its old venue summary", () => {
    const venue = nearbyVenue({ prices: [nearbyPriceRow({ price_superseded: { reason: "operator_change", operator: "Old operator", left_on: "2026-01-01", evidence: "Operator left", evidence_urls: ["https://example.com"], recorded_on: "2026-01-02" } })] });
    expect(mapNearbyPriceForVenue(venue, initialFilters)).toBeNull();
  });

  it("keeps an explicitly stated half-pint serving", () => {
    const venue = nearbyVenue({ prices: [nearbyPriceRow({ pint_name: "Guinness half pint" })] });
    expect(mapNearbyPriceForVenue(venue, initialFilters)?.measureLabel).toBe("half pint");
  });
});

describe("nearby report drink identity", () => {
  it("refuses a merged report summary whose old drink name is not independent report evidence", () => {
    const venue = nearbyVenue({ prices: [], cheapestPrice: 3, cheapestPint: "Guinness", latestContributorPrice: 3, latestContributorAt: "2026-10-22T12:00:00Z" });
    expect(mapNearbyPriceForVenue(venue, initialFilters)).toBeNull();
  });

  it("keeps a named menu row at its own price when a cheaper report has no drink identity", () => {
    const venue = nearbyVenue({ cheapestPrice: 3, cheapestPint: "Guinness", latestContributorPrice: 3, latestContributorAt: "2026-10-22T12:00:00Z" });
    expect(mapNearbyPriceForVenue(venue, initialFilters)).toMatchObject({ drinkLabel: "Guinness", priceGbp: 4.5, sourceLabel: "Pint Prices" });
  });
});
