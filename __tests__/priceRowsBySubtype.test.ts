import { describe, expect, it } from "vitest";

import {
  authoritativeBundleRowsForSubtype,
  bundleRowsForSubtype,
  countBundleVenuesForSubtype,
} from "@/lib/priceRowsBySubtype";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const listedSoft: UkPriceBundleRow = {
  venueId: "venue-uk-w1",
  name: "The Crown",
  category: "soft-drink",
  priceGbp: 2.5,
  lane: "site-harvest",
  standing: "listed",
  sourceUrl: "https://thecrown.co.uk/drinks",
  publisher: "thecrown.co.uk",
  observedAt: "2026-09-01T00:00:00.000Z",
  basis: null,
  sampleSize: null,
  drinkLabel: "Coke Zero",
  drinkSubtype: "soft-drink-coke-zero",
};

const estimateBeer: UkPriceBundleRow = {
  ...listedSoft,
  venueId: "venue-uk-w2",
  category: "beer",
  drinkLabel: "Guinness",
  drinkSubtype: "beer-stout",
  lane: "estimate",
  standing: "estimate",
  sourceUrl: null,
  publisher: null,
  basis: "regional_baseline:camden",
  sampleSize: 12,
};

describe("priceRowsBySubtype", () => {
  it("selects rows for a subtype id", () => {
    const rows = [listedSoft, estimateBeer];
    expect(bundleRowsForSubtype(rows, "soft-drink-coke-zero")).toEqual([listedSoft]);
    expect(bundleRowsForSubtype(rows, "beer-stout")).toEqual([estimateBeer]);
  });

  it("counts authoritative venues only", () => {
    const rows = [listedSoft, estimateBeer];
    expect(authoritativeBundleRowsForSubtype(rows, "soft-drink-coke-zero")).toEqual([listedSoft]);
    expect(countBundleVenuesForSubtype(rows, "soft-drink-coke-zero")).toBe(1);
    expect(countBundleVenuesForSubtype(rows, "beer-stout")).toBe(0);
  });
});
