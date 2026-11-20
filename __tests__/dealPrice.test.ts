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

  it("rejects missing hours, missing serving and invalid end dates", () => {
    expect(validateDealPrice({ ...deal, schedule: null }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, measure: "unknown" }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, endDate: "2026-02-30" }).ok).toBe(false);
    expect(validateDealPrice({ ...deal, measure: "other", measureLabel: "" }).ok).toBe(false);
  });
});
