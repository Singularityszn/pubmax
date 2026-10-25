import { afterEach, expect, it, vi } from "vitest";
import * as bundle from "@/lib/ukPriceBundle.server";
import { venuePriceUpdatesFor, resetVenuePriceUpdatesForTests } from "@/lib/priceUpdates.server";
afterEach(() => { vi.restoreAllMocks(); resetVenuePriceUpdatesForTests(); });
it("keeps an unavailable bundle distinct from an empty per-venue menu", async () => {
  vi.spyOn(bundle, "ukPriceBundleRowsByVenue").mockResolvedValue({ status: "unavailable", byVenue: new Map() });
  expect(await venuePriceUpdatesFor(["venue-ege2qq"])).toBeNull();
});
it("returns a measured empty menu when the bundle was read and no source targets the venue", async () => {
  vi.spyOn(bundle, "ukPriceBundleRowsByVenue").mockResolvedValue({ status: "empty", byVenue: new Map() });
  expect(await venuePriceUpdatesFor(["missing-test-venue"])).toEqual({ drink: [], food: [] });
});
