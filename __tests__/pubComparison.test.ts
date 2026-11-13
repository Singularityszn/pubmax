import { describe, expect, it } from "vitest";
import { comparePubOrders, comparisonCatalogueDrinks, parsePubComparisonRequest, type PubComparisonEvidence, type PubComparisonVenueInput } from "@/lib/pubComparison";

const now = Date.parse("2026-10-28T12:00:00Z");
const order = [{ category: "beer" as const, drinkLabel: "Guinness", serving: "pint", quantity: 2 }];
function evidence(overrides: Partial<PubComparisonEvidence> = {}): PubComparisonEvidence {
  return { category: "beer", drinkLabel: "Guinness", serving: "pint", pricePence: 500, sourceClass: "listed", sourceKind: "directory", sourceUrl: "https://example.com/pub", publisher: "Example", date: "2026-10-01", dateMeaning: "source-read", eligible: true, ...overrides };
}
function venue(id: string, prices: PubComparisonEvidence[]): PubComparisonVenueInput {
  return { id, name: "The Crown", address: `${id} High Street`, borough: "Islington", evidence: prices, mapHref: `/map?sel=${id}` };
}

describe("pub order comparison", () => {
  it("totals the requested serving at each exact branch without ranking incomplete orders", () => {
    const result = comparePubOrders({ venueIds: ["a", "b"], order }, [venue("a", [evidence()]), venue("b", [evidence({ serving: "half", pricePence: 280 })])], now);
    expect(result.venues[0]?.totalPence).toBe(1000);
    expect(result.venues[1]?.totalPence).toBeNull();
    expect(result.venues[1]?.items[0]?.reason).toBe("Serving size does not match.");
    expect(result.completeVenueCount).toBe(1);
  });
});

describe("comparison request", () => {
  it("accepts offered menu names without truncating their drink identity", () => {
    const drinkLabel = "Tropical alcohol-free botanical spritz with pineapple, rosemary and orange served over ice";
    const choices = comparisonCatalogueDrinks([venue("a", [evidence({ drinkLabel, category: "alcohol-free", serving: "250ml" })])]);
    expect(choices).toHaveLength(1);
    expect(parsePubComparisonRequest({ venueIds: ["a"], order: [{ category: "alcohol-free", drinkLabel: choices[0]?.drinkLabel, serving: "250ml", quantity: 1 }] })?.order[0]?.drinkLabel).toBe(drinkLabel);
  });

  it("refuses a fourth pub and private origin coordinates", () => {
    expect(parsePubComparisonRequest({ venueIds: ["a", "b", "c", "d"], order })).toBeNull();
    expect(parsePubComparisonRequest({ venueIds: ["a"], order, origin: { lat: 51, lng: 0 } })).toBeNull();
  });
});

describe("comparison evidence", () => {
  it("keeps unknown prices out of the complete order while showing the known subtotal", () => {
    const request = { venueIds: ["a"], order: [...order, { category: "alcohol-free" as const, drinkLabel: "Guinness 0.0", serving: "440 ml can", quantity: 1 }] };
    const result = comparePubOrders(request, [venue("a", [evidence()])], now);
    expect(result.venues[0]?.knownSubtotalPence).toBe(1000);
    expect(result.venues[0]?.totalPence).toBeNull();
    expect(result.venues[0]?.items[1]?.evidence).toBeNull();
  });

  it("does not replace the requested brand or alcohol-free drink", () => {
    const rows = [evidence({ drinkLabel: "Guinness 0.0", category: "alcohol-free" }), evidence({ drinkLabel: "Murphy's" })];
    expect(comparePubOrders({ venueIds: ["a"], order }, [venue("a", rows)], now).completeVenueCount).toBe(0);
  });

  it.each([
    { date: null },
    { date: "2024-01-01" },
    { date: "2027-01-01" },
    { sourceUrl: null },
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:secret@example.com/menu" },
  ])("preserves incomplete evidence without giving it a complete total: %j", (changes) => {
    const result = comparePubOrders({ venueIds: ["a"], order }, [venue("a", [evidence(changes)])], now);
    expect(result.venues[0]?.totalPence).toBeNull();
    expect(result.venues[0]?.items[0]?.evidence?.eligible).toBe(false);
  });

  it("uses the newest eligible listing without presenting its read date as today's price", () => {
    const result = comparePubOrders({ venueIds: ["a"], order }, [venue("a", [evidence({ pricePence: 400, date: "2026-09-01" }), evidence({ pricePence: 550, date: "2026-10-01" })])], now);
    expect(result.venues[0]?.totalPence).toBe(1100);
    expect(result.venues[0]?.items[0]?.evidence?.dateMeaning).toBe("source-read");
    expect(result.venues[0]?.items[0]?.evidence?.date).toBe("2026-10-01");
  });

  it("does not equate unspecified bottles", () => {
    const request = { venueIds: ["a"], order: [{ category: "beer" as const, drinkLabel: "Guinness", serving: "bottle", quantity: 1 }] };
    const result = comparePubOrders(request, [venue("a", [evidence({ serving: "bottle" })])], now);
    expect(result.venues[0]?.totalPence).toBeNull();
  });

  it("totals explicitly recorded coffee, soft-drink and alcohol-free servings", () => {
    const request = { venueIds: ["a"], order: [
      { category: "coffee" as const, drinkLabel: "Espresso", serving: "single espresso", quantity: 1 },
      { category: "soft-drink" as const, drinkLabel: "Coca-Cola", serving: "330ml can", quantity: 2 },
      { category: "alcohol-free" as const, drinkLabel: "Guinness 0.0", serving: "440ml can", quantity: 1 },
    ] };
    const prices = request.order.map((line, index) => evidence({ ...line, pricePence: index === 0 ? 250 : index === 1 ? 300 : 450 }));
    expect(comparePubOrders(request, [venue("a", prices)], now).venues[0]?.totalPence).toBe(1300);
  });

  it("preserves input order for pubs with equal names", () => {
    const result = comparePubOrders({ venueIds: ["b", "a"], order }, [venue("a", [evidence()]), venue("b", [evidence({ pricePence: 700 })])], now);
    expect(result.venues.map((row) => row.address)).toEqual(["b High Street", "a High Street"]);
    expect(result.venues.map((row) => row.totalPence)).toEqual([1400, 1000]);
  });
});

describe("request bounds", () => {
  it.each([0, -1, 13, 1.5, "2", null])("refuses invalid quantity %j", (quantity) => {
    expect(parsePubComparisonRequest({ venueIds: ["a"], order: [{ ...order[0], quantity }] })).toBeNull();
  });
  it("refuses duplicate pubs, duplicate lines and unsupported hard requirements", () => {
    expect(parsePubComparisonRequest({ venueIds: ["a", "a"], order })).toBeNull();
    expect(parsePubComparisonRequest({ venueIds: ["a"], order: [...order, ...order] })).toBeNull();
    expect(parsePubComparisonRequest({ venueIds: ["a"], order, accessibility: "step-free" })).toBeNull();
  });
});
