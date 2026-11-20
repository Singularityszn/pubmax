import { describe, expect, it } from "vitest";

import { matchesPriceAlert } from "@/lib/priceAlert";

describe("price alerts", () => {
  const alert = { area: "camden", thresholdPence: 500, enabled: true };
  const price = { pricePence: 450, lat: 51.539, lng: -0.143 };

  it("matches a price below the threshold in the chosen area", () => {
    expect(matchesPriceAlert(alert, price)).toBe(true);
  });

  it("does not match equal prices, other areas, or disabled alerts", () => {
    expect(matchesPriceAlert(alert, { ...price, pricePence: 500 })).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, lat: 51.46, lng: -0.138 })).toBe(false);
    expect(matchesPriceAlert({ ...alert, enabled: false }, price)).toBe(false);
  });

  it("excludes a report outside an estimated ten minute walk from the area centre", () => {
    expect(matchesPriceAlert(alert, { ...price, lat: 51.552 })).toBe(false);
  });

  it("fails closed for invalid areas, prices and locations", () => {
    expect(matchesPriceAlert({ ...alert, area: "unknown" }, price)).toBe(false);
    expect(matchesPriceAlert({ ...alert, thresholdPence: 475 }, price)).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, pricePence: 0 })).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, lat: Number.NaN })).toBe(false);
  });
});
