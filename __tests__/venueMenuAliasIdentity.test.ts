import { describe, expect, it } from "vitest";
import { parseDrinkPriceUpdates, reviewedDrinkItemId } from "@/lib/drinkPriceUpdates";
import { venueMenuForInspector } from "@/lib/venueMenu";
import fixture from "@/__tests__/fixtures/harvest/eagle-reviewed-drinks-20261013.json";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const venue = {
  id: fixture.venueId,
  name: "The Eagle",
  address: "215 Askew Rd, London W12 9AZ, UK",
  latitude: 51.5006,
  longitude: -0.239333,
  prices: [],
};

describe("public venue-menu alias identity", () => {
  it("preserves validated explicit source IDs and both servings across a supported venue alias", () => {
    const raw = fixture.updates.slice(0, 2).map((row) => {
      const aliased = { ...row, venueKey: venue.id };
      return { ...aliased, itemId: reviewedDrinkItemId(aliased) };
    });
    const updates = parseDrinkPriceUpdates(raw, NOW);
    const original = structuredClone(updates);
    expect(updates).toHaveLength(2);
    const menu = venueMenuForInspector(venue, updates);

    expect(menu.map((drink) => [drink.id, drink.servingSize, drink.priceGbp])).toEqual([
      [raw[0]!.itemId, "125ml", 7.1],
      [raw[1]!.itemId, "750ml", 35.5],
    ]);
    expect(menu.every((drink) => drink.provenance.sourceUrl === fixture.updates[0]!.source.url)).toBe(true);
    expect(updates).toEqual(original);
  });

  it("preserves the existing canonical rating ID for a legacy alias observation", () => {
    const updates = parseDrinkPriceUpdates([{ ...fixture.updates[0], venueKey: venue.id }], NOW);
    const original = structuredClone(updates);
    const menu = venueMenuForInspector(venue, updates);

    expect(menu).toHaveLength(1);
    expect(menu[0]!.id).toBe("drink-1mv2xoy");
    expect(menu[0]!.servingSize).toBe("125ml");
    expect(menu[0]!.priceGbp).toBe(7.1);
    expect(updates).toEqual(original);
  });
});
