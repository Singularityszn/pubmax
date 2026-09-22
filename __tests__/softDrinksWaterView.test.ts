import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenues: async () => [] }));
vi.mock("@/lib/priceUpdates.server", () => ({ allDrinkPriceUpdates: async () => [] }));
vi.mock("@/lib/ukPriceBundle.server", () => ({
  allUkPriceBundleRows: async () => ({
    status: "ready",
    rows: [{ venueId: "outside-london", category: "soft-drink", drinkSubtype: "soft-drink-coke-zero", standing: "listed" }],
  }),
}));

import { loadSoftDrinksWaterView } from "@/lib/drinkSubtypePricedView.server";

it("does not count UK bundle venues absent from the London view", async () => {
  const view = await loadSoftDrinksWaterView("soft-drink-coke-zero");
  expect(view?.rows).toEqual([]);
  expect(view?.observedCounts["soft-drink-coke-zero"]).toBe(0);
});
