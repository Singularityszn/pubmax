import { describe, expect, it } from "vitest";
import { menuBasketItems, quoteMenuBasket } from "@/lib/menuBasket";
import type { Drink } from "@/lib/drinks";
import type { FoodItem } from "@/lib/food";

const testFood: FoodItem = { id: "meal", name: "Synthetic meal", category: "mains", priceGbp: 12, provenance: { source: "Test menu", licence: "test", observedAt: "2026-08-01" }, source: "https://example.com/menu" };
const testDrink: Drink = { id: "soft", name: "Synthetic lemonade", category: "soft-drink", servingSize: "330ml bottle", priceGbp: 5, provenance: { source: "Test menu", licence: "test", observedAt: "2026-08-01", sourceUrl: "https://example.com/menu" } };

describe("admitted menu basket", () => {
  it("adds selected food and alcohol-free drink amounts while keeping the full cost unknown", () => {
    const rows = menuBasketItems("v", [testFood], [testDrink]);
    expect(quoteMenuBasket("v", rows, { "food:meal": 1, "drink:soft": 1 }, "2026-10-29T12:00:00Z")).toMatchObject({ menuSubtotalPence: 1700, totalPence: null, eligibility: "unknown" });
    expect(rows[0]!.evidence.observedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(rows[0]!.serving).toBeNull();
    expect(rows[1]!.serving).toBe("330ml bottle");
  });
  it("excludes demo rows and never rounds fractional pennies into invented prices", () => {
    expect(menuBasketItems("v", [{ ...testFood, provenance: { ...testFood.provenance, source: "seed" } }], [{ ...testDrink, provenance: { ...testDrink.provenance, lane: "demo" } }])).toEqual([]);
    const rows = menuBasketItems("v", [{ ...testFood, priceGbp: 1.234 }], []);
    expect(rows[0]!.unitPence).toBeNull();
    expect(quoteMenuBasket("v", rows, { "food:meal": 1 }, "2026-10-29T12:00:00Z").menuSubtotalPence).toBeNull();
  });
  it("rejects cross-venue selections and does not substitute a missing serving or date", () => {
    const rows = menuBasketItems("v", [], [{ ...testDrink, servingSize: undefined, provenance: { ...testDrink.provenance, observedAt: null } }]);
    expect(rows[0]).toMatchObject({ serving: null, evidence: { observedAt: null } });
    expect(quoteMenuBasket("other", rows, { "drink:soft": 1 }, "2026-10-29T12:00:00Z").status).toBe("ineligible");
  });
});
