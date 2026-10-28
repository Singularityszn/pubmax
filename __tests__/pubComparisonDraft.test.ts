import { describe, expect, it } from "vitest";
import { readComparisonDraft, saveComparisonDraft } from "@/lib/pubComparisonDraft";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const request = { venueIds: ["venue-a", "venue-b"], order: [{ category: "beer" as const, drinkLabel: "Guinness", serving: "pint", quantity: 2 }], meetingPointId: "big-ben" };

describe("comparison return", () => {
  it("restores the order and exact pub IDs without storing old prices", () => {
    const store = storage();
    expect(saveComparisonDraft(request, "account-a", store, 1000)).toBe(true);
    expect(readComparisonDraft("account-a", store, 2000)).toEqual(request);
  });
  it("does not restore another account's choices", () => {
    const store = storage(); saveComparisonDraft(request, "account-a", store, 1000);
    expect(readComparisonDraft("account-b", store, 2000)).toBeNull();
    expect(readComparisonDraft("account-a", store, 2000)).toBeNull();
  });
  it("expires choices and tolerates blocked storage", () => {
    const store = storage(); saveComparisonDraft(request, "guest", store, 1000);
    expect(readComparisonDraft("guest", store, 1000 + 2 * 60 * 60 * 1000)).toBeNull();
    expect(saveComparisonDraft(request, "guest", null)).toBe(false);
    expect(readComparisonDraft("guest", null)).toBeNull();
  });
});
