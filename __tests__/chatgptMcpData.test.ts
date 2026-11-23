import { afterEach, expect, it, vi } from "vitest";
import { publicPubDetails, searchPublicPubs } from "@/lib/chatgpt/data.server";
import * as bundleReader from "@/lib/ukPriceBundle.server";
import * as updatesReader from "@/lib/priceUpdates.server";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const id = "venue-133bdp8";
afterEach(() => { vi.restoreAllMocks(); });

it("returns the selected pint's name when a half pint has the same price", async () => {
  const pint: UkPriceBundleRow = {
    venueId: id, name: "Fox and Pheasant", category: "beer", priceGbp: 5,
    lane: "site-harvest", standing: "listed", sourceUrl: "https://pub.example/menu",
    publisher: "Pub menu", observedAt: "2026-11-22T12:00:00Z", basis: null, sampleSize: null,
    drinkLabel: "Lager pint", servingSize: "pint",
  };
  vi.spyOn(bundleReader, "ukPriceBundleRowsFor").mockResolvedValue({ status: "ready", rows: [
    { ...pint, drinkLabel: "Premium half", servingSize: "half pint" },
    { ...pint, drinkLabel: "Cheaper half", servingSize: "half pint", priceGbp: 2.5 },
    pint,
  ] });
  vi.spyOn(updatesReader, "venuePriceUpdatesFor").mockResolvedValue({ food: [], drink: [] });
  const pub = await publicPubDetails(id, false);
  expect(pub?.prices).toContainEqual(expect.objectContaining({ drink: "Lager pint", priceGbp: 5 }));
  expect(pub?.prices.some((price) => price.drink === "Premium half" || price.drink === "Cheaper half")).toBe(false);
});

it("returns the real Fox and Pheasant listing through details and search", async () => {
  const expected = {
    priceGbp: 6, observedAt: "2026-09-21T18:31:50.211Z",
    publisher: { label: "thefoxandpheasant.com", url: "https://www.thefoxandpheasant.com/drinks-menu" },
  };
  expect((await publicPubDetails(id, false))?.prices).toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
  expect((await searchPublicPubs("Fox and Pheasant", 8)).find((pub) => pub.id === id)?.prices)
    .toEqual(expect.arrayContaining([expect.objectContaining(expected)]));
});
it("keeps a failed public price read distinct from an empty read", async () => {
  vi.spyOn(bundleReader, "ukPriceBundleRowsFor").mockResolvedValue({ status: "unavailable", rows: [] });
  vi.spyOn(updatesReader, "venuePriceUpdatesFor").mockResolvedValue(null);
  expect(await publicPubDetails(id, false)).toMatchObject({ priceReads: { bundle: "unavailable", updates: "unavailable" } });
});
it("uses a newer menu observation without exposing demo or unsafe publisher links", async () => {
  vi.spyOn(updatesReader, "venuePriceUpdatesFor").mockResolvedValue({ food: [], drink: [{
    venueKey: id, drinkName: "New lager", category: "beer", servingSize: "pint", priceGbp: 7,
    source: { label: "Pub menu", url: "https://pub.example/menu", licence: "Public facts" },
    observedAt: "2026-10-20T12:00:00Z", lane: "publisher",
  }, {
    venueKey: id, drinkName: "Demo lager", category: "beer", servingSize: "pint", priceGbp: 1,
    source: { label: "Demo", url: "https://pub.example/demo", licence: "Demo" },
    observedAt: "2026-10-21T12:00:00Z", lane: "demo",
  }, {
    venueKey: id, drinkName: "Unsafe link lager", category: "beer", servingSize: "pint", priceGbp: 8,
    source: { label: "Unsafe menu link", url: "https://user:password@pub.example/menu", licence: "Public facts" },
    observedAt: "2026-10-19T12:00:00Z", lane: "publisher",
  }] });
  const pub = await publicPubDetails(id, false);
  expect(pub?.prices[0]).toMatchObject({ drink: "New lager", priceGbp: 7, observedAt: "2026-10-20T12:00:00Z", publisher: { label: "Pub menu", url: "https://pub.example/menu" } });
  expect(pub?.prices.some((price) => price.drink === "Demo lager")).toBe(false);
  expect(pub?.prices.find((price) => price.drink === "Unsafe link lager")?.publisher).toEqual({ label: "Unsafe menu link", url: null });
});
it("keeps a model calculation date separate from source observations", async () => {
  vi.spyOn(bundleReader, "ukPriceBundleRowsFor").mockResolvedValue({ status: "ready", rows: [{
    venueId: id, name: "Fox and Pheasant", category: "beer", priceGbp: 6.73,
    lane: "estimate", standing: "estimate", sourceUrl: null, publisher: null,
    observedAt: "2026-10-05T23:53:08.357Z", basis: "regional_baseline:kensington-and-chelsea", sampleSize: 102,
  }] });
  vi.spyOn(updatesReader, "venuePriceUpdatesFor").mockResolvedValue({ food: [], drink: [] });
  expect((await publicPubDetails(id, false))?.prices).toContainEqual({
    drink: "Pint", priceGbp: 6.73, observedAt: null, computedAt: "2026-10-05T23:53:08.357Z", basis: "Typical prices in the region", status: "estimate", publisher: null,
  });
});
