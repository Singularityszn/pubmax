import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenues: async () => [] }));
vi.mock("@/lib/priceUpdates.server", () => ({ allDrinkPriceUpdates: async () => [] }));
vi.mock("@/lib/ukPriceBundle.server", () => ({
  ukPriceBundleRowsByVenue: async () => ({
    status: "ready",
    byVenue: new Map([
      [
        "outside-london",
        [
          {
            venueId: "outside-london",
            name: "Outside London",
            category: "soft-drink",
            priceGbp: 2.2,
            lane: "site-harvest",
            standing: "listed",
            sourceUrl: "https://example.com/menu",
            publisher: "example.com",
            observedAt: "2026-09-04T13:40:04.870Z",
            basis: null,
            sampleSize: null,
            drinkLabel: "Coke Zero",
            drinkSubtype: "soft-drink-coke-zero",
          },
        ],
      ],
    ]),
  }),
}));

import { loadSoftDrinksWaterView } from "@/lib/drinkSubtypePricedView.server";

it("does not count UK bundle venues absent from the London view", async () => {
  const view = await loadSoftDrinksWaterView("soft-drink-coke-zero");
  expect(view?.rows).toEqual([]);
  expect(view?.observedCounts["soft-drink-coke-zero"]).toBe(0);
});

it("opens on the Lucia lens and counts it beside the other launch chips", async () => {
  const view = await loadSoftDrinksWaterView("soft-drink-lucia-special");
  expect(view?.subtypeId).toBe("soft-drink-lucia-special");
  expect(view?.subtypeLabel).toBe("Coke Zero and Diet Coke");
  expect(view?.observedCounts).toEqual({
    "soft-drink-lucia-special": 0,
    "soft-drink-zero-sugar-cola": 0,
    "soft-drink-still-water": 0,
  });
});
