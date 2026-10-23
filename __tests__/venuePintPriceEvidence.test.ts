import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsFor: vi.fn() }));

import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { readVenuePintPriceEvidence } from "@/lib/venuePintPriceEvidence.server";
import { venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { venueUpdateKey } from "@/lib/pubMap";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const venue = groupVenuePrices([
  { pub_name: "Test Arms", address: "1 Test Road", latitude: 51.5, longitude: -0.1, pint_name: "Lager", price_gbp: 5.5 },
] as VenuePrice[])[0]!;
const menu: UkPriceBundleRow = {
  venueId: venue.id, name: venue.name, category: "beer", priceGbp: 5, lane: "site-harvest", standing: "listed",
  sourceUrl: "https://example.com/menu", publisher: "Pub menu", observedAt: "2026-10-23T16:00:00Z",
  basis: null, sampleSize: null, drinkLabel: "Session IPA",
};
const update = {
  venueKey: venueUpdateKey(venue), price: 4.8,
  source: { label: "Pub website", url: "https://example.com/drinks" }, observedAt: "2026-10-23T15:00:00Z",
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T18:00:00Z"));
  vi.mocked(ukPriceBundleRowsFor).mockResolvedValue({ status: "empty", rows: [] });
  vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify({ updates: [] }));
});
afterEach(() => vi.restoreAllMocks());

describe("shared venue pint evidence", () => {
  it("uses the bundle's selected category, price, source and timestamp for metadata", async () => {
    vi.mocked(ukPriceBundleRowsFor).mockResolvedValue({ status: "ready", rows: [
      { ...menu, priceGbp: 4, drinkLabel: "Old cheaper lager", observedAt: "2026-07-18T12:00:00Z" },
      { ...menu, category: "cocktail", priceGbp: 3, drinkLabel: "Martini" },
      menu,
    ] });
    const evidence = await readVenuePintPriceEvidence(venue);
    expect(evidence.bundlePrices?.listed).toEqual({ priceGbp: 5, sourceUrl: menu.sourceUrl, observedAt: menu.observedAt });
    expect(evidence.listedRow?.drinkLabel).toBe("Session IPA");
  });
  it("rejects future menu and sourced-refresh observations", async () => {
    vi.mocked(ukPriceBundleRowsFor).mockResolvedValue({ status: "ready", rows: [menu, { ...menu, priceGbp: 1, observedAt: "2099-10-23T16:00:00Z" }] });
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ updates: [{ ...update, observedAt: "2099-10-23T16:00:00Z" }] }));
    const evidence = await readVenuePintPriceEvidence(venue);
    expect(evidence.bundlePrices?.listed?.priceGbp).toBe(5);
    expect(evidence.venue.cheapestPrice).toBe(5.5);
    expect(evidence.venue.sourcedPrice).toBeNull();
    expect(evidence.pintPriceRefresh).toEqual({ status: "ready", update: null });
  });
  it("preserves the sourced-refresh price and exact attribution used by the sheet", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ updates: [update] }));
    const evidence = await readVenuePintPriceEvidence(venue);
    const lane = venuePriceLane(evidence.venue, null, venueSourcedPrice(evidence.venue), evidence.bundlePrices ?? {});
    expect(lane).toMatchObject({ lane: "sourced", cheapestPrice: 4.8, sourcedPrice: {
      sourceLabel: "Pub website", sourceUrl: "https://example.com/drinks", observedAt: update.observedAt,
    } });
  });
  it("does not replace a newer trusted public report with the sourced refresh", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ updates: [update] }));
    const evidence = await readVenuePintPriceEvidence({ ...venue, latestContributorPrice: 6, latestContributorAt: "2026-10-23T17:00:00Z" });
    expect(evidence.venue.sourcedPrice).toBeNull();
  });
  it("retains unavailable source reads rather than claiming successful empty results", async () => {
    vi.mocked(ukPriceBundleRowsFor).mockResolvedValue({ status: "unavailable", rows: [] });
    vi.mocked(fs.readFile).mockRejectedValue(new Error("pack missing"));
    const evidence = await readVenuePintPriceEvidence(venue);
    expect(evidence.bundlePrices).toBeNull();
    expect(evidence.reads).toEqual({ bundle: "unavailable", sourced: "unavailable" });
    expect(evidence.venue.cheapestPrice).toBe(5.5);
    expect(evidence.pintPriceRefresh).toEqual({ status: "unavailable", update: null });
  });
});
