import { describe, expect, it } from "vitest";
import { validateDealPrice } from "@/lib/dealPrice";

const deal = {
  venueId: "venue-17h8293",
  drinkCategory: "beer",
  drink: "House lager",
  measure: "pint",
  priceGbp: "4.50",
  schedule: { days: [1, 2], start: "16:00", end: "19:00" },
  endDate: null,
  conditions: "With a meal",
};

describe("deal price submission", () => {
  it("keeps the price, serving, schedule and conditions together", () => {
    expect(validateDealPrice(deal)).toMatchObject({ ok: true, value: { ...deal, priceGbp: 4.5 } });
  });

  it.each([
    { drink: "Lager <0.5%", conditions: "Groups <6 only" },
    { drink: "Lager >5%", conditions: "Groups >6 only" },
    { drink: "House <special> lager", conditions: "Spend >=£10 & groups <=6" },
  ])("preserves literal drink and condition text through revalidation: $conditions", ({ drink, conditions }) => {
    const result = validateDealPrice({ ...deal, drink, conditions });
    expect(result).toMatchObject({ ok: true, value: { drink, conditions } });
    if (!result.ok) throw new Error(result.error);
    expect(validateDealPrice(result.value)).toMatchObject({ ok: true, value: { drink, conditions } });
  });

  it("still removes control characters and normalises whitespace", () => {
    expect(validateDealPrice({ ...deal, drink: "  House\u0000  lager\u007f ", conditions: "\tGroups\n<6\u0001 only  " }))
      .toMatchObject({ ok: true, value: { drink: "House lager", conditions: "Groups <6 only" } });
  });

  it("rejects missing hours, missing serving and invalid end dates", () => {
    expect(validateDealPrice({ ...deal, schedule: null }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, measure: "unknown" }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, endDate: "2026-02-30" }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, measure: "other", measureLabel: "" }).ok).toBe(false);
  });
});
