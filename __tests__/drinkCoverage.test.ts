import { describe, expect, it } from "vitest";
import { mapDrinkCoverage } from "@/lib/drinkCoverage";
import { listedDrinkCoverage } from "@/lib/listedDrinkCoverage";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { venueMenuLookupKeys } from "@/lib/venueMenu";

const venues = groupVenuePrices([
  { pub_name: "The One", address: "1 Test Road", latitude: 51.5, longitude: -0.1, pint_name: "Amstel", price_gbp: 5 },
  { pub_name: "The Two", address: "2 Test Road", latitude: 51.51, longitude: -0.1, pint_name: "", price_gbp: null },
] as VenuePrice[]);
const first = venues[0]!;
const updates: DrinkPriceUpdate[] = ["Flat white", "Latte"].map((drinkName) => ({
  venueKey: venueMenuLookupKeys(first)[0]!, drinkName, category: "coffee", priceGbp: 3,
  observedAt: "2026-10-01", source: { label: "Pub menu", url: "https://example.com/menu", licence: "Facts only" }, lane: "publisher",
}));

describe("public drink coverage", () => {
  it("counts each venue once per drink and keeps unpriced venues in the denominator", () => {
    expect(listedDrinkCoverage(venues, updates)).toMatchObject({ total: 2, pricedPubs: 1, counts: { beer: 1, coffee: 1, "alcohol-free": 0 } });
  });
  it("does not count a bottled beer menu price as an additional priced pint pub", () => {
    const bottle: DrinkPriceUpdate = { ...updates[0]!, venueKey: venueMenuLookupKeys(venues[1]!)[0]!, drinkName: "Bottled lager", category: "beer", servingSize: "330ml" };
    expect(listedDrinkCoverage(venues, [bottle])).toMatchObject({ pricedPubs: 1, counts: { beer: 1 } });
  });
  it("includes authoritative UK menu rows once without admitting estimates or other venue ids", () => {
    const row: UkPriceBundleRow = {
      venueId: venues[1]!.id, name: "The Two", category: "coffee", priceGbp: 3,
      lane: "site-harvest", standing: "listed", sourceUrl: "https://example.com/menu",
      publisher: "Pub menu", observedAt: "2026-10-01", basis: null, sampleSize: null,
    };
    const bundle = new Map([
      [venues[1]!.id, [row, { ...row, priceGbp: 4 }, { ...row, category: "wine", standing: "estimate" as const }]],
      ["unrelated-venue", [{ ...row, venueId: "unrelated-venue" }]],
    ]);
    expect(listedDrinkCoverage(venues, [], bundle, Date.parse("2026-10-23"))).toMatchObject({ total: 2, counts: { coffee: 1, wine: 0 } });
    expect(listedDrinkCoverage(venues, [], new Map([[venues[1]!.id, [{ ...row, category: "beer" }]]]), Date.parse("2026-10-23"))).toMatchObject({ pricedPubs: 2, counts: { beer: 2 } });
  });
  it("never counts a demo menu as public coverage", () => {
    expect(listedDrinkCoverage(venues, updates.map((row) => ({ ...row, lane: "demo" })))).toMatchObject({ counts: { coffee: 0 } });
  });
  it("counts map prices only for loaded pubs, without treating a partial read as complete", () => {
    const result = mapDrinkCoverage(venues, "coffee", new Map([
      [first.id, { venueId: first.id, category: "coffee", categoryLabel: "Coffee", priceGbp: 3, source: "community" }],
      ["outside-loaded-area", { venueId: "outside-loaded-area", category: "coffee", categoryLabel: "Coffee", priceGbp: 4, source: "community" }],
    ]), "partial");
    expect(result).toEqual({ count: 1, total: 2, status: "partial" });
  });
});
