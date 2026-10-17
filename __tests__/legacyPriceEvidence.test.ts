import { describe, expect, it } from "vitest";
import { legacyCheapestPriceEvidence } from "@/lib/legacyPriceEvidence.mjs";

describe("listed minimum price projection", () => {
  it("retains the minimum row's own older read and publisher", () => {
    expect(legacyCheapestPriceEvidence([
      { price_gbp: 6, pub_url: "https://newer.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
      { price_gbp: 2.95, pub_url: "https://www.pint-prices.com/pub/example", scraped_at_values: "2026-07-03T23:10:47+00:00" },
    ], 2.95)).toEqual({ priceSource: "Pint Prices", priceObservedAt: "2026-07-03T23:10:47.000Z" });
  });

  it("does not borrow a higher row's evidence for an undated or unnamed minimum", () => {
    expect(legacyCheapestPriceEvidence([
      { price_gbp: 6, pub_url: "https://newer.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
      { price_gbp: 2.95 },
    ], 2.95)).toEqual({});
    expect(legacyCheapestPriceEvidence([{ price_gbp: 6 }], 2.95)).toEqual({});
  });

  it("uses one matching record on a tie without merging unrelated reads", () => {
    expect(legacyCheapestPriceEvidence([
      { price_gbp: 3, pub_url: "https://old.example/menu", scraped_at_values: "2026-07-03T23:10:47+00:00" },
      { price_gbp: 3, pub_url: "https://new.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
    ], 3)).toEqual({ priceSource: "old.example", priceObservedAt: "2026-07-03T23:10:47.000Z" });
  });
});
