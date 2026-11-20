import { describe, expect, it } from "vitest";

import { matchesPriceAlert } from "@/lib/priceAlert";

describe("price alerts", () => {
  const alert = { lat: 51.539, lng: -0.143, thresholdPence: 500, enabled: true };
  const price = { pricePence: 450, lat: 51.539, lng: -0.143 };

  it("matches a price below the threshold near the saved location", () => {
    expect(matchesPriceAlert(alert, price)).toBe(true);
  });

  it("does not match equal prices, distant pubs, or disabled alerts", () => {
    expect(matchesPriceAlert(alert, { ...price, pricePence: 500 })).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, lat: 51.46, lng: -0.138 })).toBe(false);
    expect(matchesPriceAlert({ ...alert, enabled: false }, price)).toBe(false);
  });

  it("excludes a report outside an estimated ten minute walk from the saved location", () => {
    expect(matchesPriceAlert(alert, { ...price, lat: 51.552 })).toBe(false);
  });

  it("fails closed for invalid preferences, prices and locations", () => {
    expect(matchesPriceAlert({ ...alert, lat: 91, lng: -0.143 }, price)).toBe(false);
    expect(matchesPriceAlert({ ...alert, thresholdPence: 475 }, price)).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, pricePence: 0 })).toBe(false);
    expect(matchesPriceAlert(alert, { ...price, lat: Number.NaN })).toBe(false);
  });
});
