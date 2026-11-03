import { describe, expect, it } from "vitest";
import { legacyCheapestPriceEvidence, legacyCheapestPriceReadDay } from "@/lib/legacyPriceEvidence.mjs";

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

  it.each(["2026-01", "2026-02-30", "2026-02-30T12:00:00Z", "2999-01-01"])("refuses the original invalid observation %s before timestamp or London-day conversion", (scraped_at_values) => {
    const prices = [{ price_gbp: 3, pub_url: "https://pub.example/menu", scraped_at_values }];
    expect(legacyCheapestPriceEvidence(prices, 3)).toEqual({ priceSource: "pub.example" });
    expect(legacyCheapestPriceReadDay(prices, 3)).toBeNull();
  });

  it("keeps a valid read without turning invalid reads into newer evidence", () => {
    const prices = [{ price_gbp: 3, pub_url: "https://pub.example/menu", scraped_at_values: "2026-01-02T23:30:00Z|2026-02-30|2026-03|2999-01-01" }];
    expect(legacyCheapestPriceEvidence(prices, 3)).toEqual({ priceSource: "pub.example", priceObservedAt: "2026-01-02T23:30:00.000Z" });
    expect(legacyCheapestPriceReadDay(prices, 3)).toBe("2026-01-02");
  });

  it("uses one matching record on a tie without merging unrelated reads", () => {
    expect(legacyCheapestPriceEvidence([
      { price_gbp: 3, pub_url: "https://old.example/menu", scraped_at_values: "2026-07-03T23:10:47+00:00" },
      { price_gbp: 3, pub_url: "https://new.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
    ], 3)).toEqual({ priceSource: "old.example", priceObservedAt: "2026-07-03T23:10:47.000Z" });
    expect(legacyCheapestPriceReadDay([
      { price_gbp: 3, pub_url: "https://old.example/menu", scraped_at_values: "2026-07-03T23:10:47+00:00" },
      { price_gbp: 3, pub_url: "https://new.example/menu", scraped_at_values: "2026-10-02T12:00:00Z" },
    ], 3)).toBe("2026-07-04");
  });
});
