import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({ lookup: vi.fn(), prices: vi.fn(), bundle: vi.fn(), cached: vi.fn(), put: vi.fn(), key: vi.fn(), route: vi.fn(), reserve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/venueIndex", () => ({ lookupCanonicalVenue: data.lookup }));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenuesOrThrow: data.prices }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: data.bundle }));
vi.mock("@/lib/walkRouteStore", () => ({ walkRouteStore: () => ({ getLeg: data.cached, putLeg: data.put }) }));
vi.mock("@/lib/walkRouteProvider", () => ({ orsApiKey: data.key, fetchWalkLeg: data.route }));
vi.mock("@/lib/walkRouteBudget", () => ({ reserveOrsBudget: data.reserve }));

import { loadPubComparison, loadPubComparisonCatalogue } from "@/lib/pubComparison.server";

const now = Date.parse("2026-10-28T12:00:00Z");
const request = { venueIds: ["venue-a"], order: [{ category: "beer" as const, drinkLabel: "Guinness", serving: "pint", quantity: 1 }] };
const price = { pint_name: "Guinness", price_gbp: 5, pub_url: "https://example.com/pub/a", scraped_at_values: "2026-10-01" };
const priced = [{ id: "venue-a", name: "The Crown", kind: "pub", address: "1 Upper Street", prices: [price] }];

beforeEach(() => {
  vi.clearAllMocks();
  data.lookup.mockImplementation(async (id: string) => ({ status: "found", canonicalId: id,
    venue: { id, name: "The Crown", kind: "pub", borough: "Islington", lat: 51.51, lng: -0.12 }, slimVenue: {} }));
  data.prices.mockResolvedValue(priced);
  data.bundle.mockResolvedValue({ status: "ready", byVenue: new Map() });
  data.cached.mockResolvedValue(null);
  data.put.mockResolvedValue(undefined);
  data.key.mockReturnValue(null);
  data.route.mockResolvedValue(null);
  data.reserve.mockResolvedValue({ commit: () => true, release: async () => true });
});

describe("comparison service", () => {
  it("uses exact branch identity and labels the source read date", async () => {
    const result = await loadPubComparison(request, undefined, now);
    expect(result.venues[0]).toMatchObject({ name: "The Crown", address: "1 Upper Street", totalPence: 500, mapHref: "/map?sel=venue-a" });
    expect(result.venues[0]?.items[0]?.evidence).toMatchObject({ date: "2026-10-01T00:00:00.000Z", dateMeaning: "source-read", sourceKind: "directory" });
  });

  it("does not convert a bottle or half in the legacy pint list into a pint", async () => {
    data.prices.mockResolvedValue([{ ...priced[0], prices: [
      { ...price, pint_name: "BOTTLED BEER" }, { ...price, pint_name: "Guinness half" },
    ] }]);
    const catalogue = await loadPubComparisonCatalogue(request.venueIds, now);
    expect(catalogue.drinks).toEqual([]);
  });

  it("retains unavailable menu reads as a separate fact", async () => {
    data.bundle.mockResolvedValue({ status: "unavailable", byVenue: new Map() });
    const catalogue = await loadPubComparisonCatalogue(request.venueIds, now);
    expect(catalogue.coverage).toBe("partial");
    expect(catalogue.drinks).toEqual([{ key: '["beer","guinness","pint"]', category: "beer", drinkLabel: "Guinness", serving: "pint" }]);
  });

  it("refuses multi-city and national-base pubs before routing", async () => {
    await expect(loadPubComparison({ ...request, venueIds: ["venue-mcr-abc"] }, undefined, now)).rejects.toMatchObject({ status: 400 });
    await expect(loadPubComparison({ ...request, venueIds: ["venue-uk-n123"] }, undefined, now)).rejects.toMatchObject({ status: 400 });
    expect(data.route).not.toHaveBeenCalled();
  });

  it("refuses two aliases for the same pub", async () => {
    data.lookup.mockImplementation(async () => ({ status: "found", canonicalId: "venue-a",
      venue: { id: "venue-a", name: "The Crown", borough: "Islington", lat: 51.51, lng: -0.12 }, slimVenue: {} }));
    await expect(loadPubComparison({ ...request, venueIds: ["venue-old", "venue-a"] }, undefined, now)).rejects.toMatchObject({ status: 400 });
  });

  it("does not compare a private club or an unknown venue", async () => {
    data.lookup.mockResolvedValue({ status: "found", canonicalId: "venue-a", venue: { id: "venue-a", name: "Members Only Club", kind: "pub" }, slimVenue: {} });
    await expect(loadPubComparison(request, undefined, now)).rejects.toMatchObject({ status: 404 });
    data.lookup.mockResolvedValue({ status: "unknown", canonicalId: "venue-a" });
    await expect(loadPubComparison(request, undefined, now)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an unlisted meeting point before reading venues or routing", async () => {
    await expect(loadPubComparison({ ...request, meetingPointId: "my-home" }, undefined, now)).rejects.toMatchObject({ status: 400 });
    expect(data.lookup).not.toHaveBeenCalled();
    expect(data.route).not.toHaveBeenCalled();
  });

  it("retains a complete price answer when walking directions are unavailable", async () => {
    const result = await loadPubComparison({ ...request, meetingPointId: "big-ben" }, undefined, now);
    expect(result.venues[0]?.totalPence).toBe(500);
    expect(result.venues[0]?.walk).toMatchObject({ status: "unavailable", minutes: null, method: null });
    expect(data.reserve).not.toHaveBeenCalled();
    expect(data.route).not.toHaveBeenCalled();
  });

  it("uses cached street geometry and the same walking pace without spending provider quota", async () => {
    data.cached.mockResolvedValue([[-0.1246, 51.5007], [-0.1246, 51.5047], [-0.12, 51.51]]);
    const result = await loadPubComparison({ ...request, meetingPointId: "big-ben" }, undefined, now);
    expect(result.venues[0]?.walk).toMatchObject({ status: "routed", method: "ors", timing: "shared-walking-pace" });
    expect(result.venues[0]?.walk.minutes).toBeGreaterThan(0);
    expect(data.reserve).not.toHaveBeenCalled();
    expect(data.route).not.toHaveBeenCalled();
  });

  it("reserves provider quota before at most one route per selected pub", async () => {
    data.key.mockReturnValue("test-only");
    data.route.mockResolvedValue([[-0.1246, 51.5007], [-0.12, 51.51]]);
    const result = await loadPubComparison({ ...request, venueIds: ["venue-a", "venue-b", "venue-c"], meetingPointId: "big-ben" }, undefined, now);
    expect(result.venues).toHaveLength(3);
    expect(data.reserve).toHaveBeenCalledTimes(3);
    expect(data.route).toHaveBeenCalledTimes(3);
  });

  it("keeps missing walking comparisons when the provider budget is exhausted", async () => {
    data.key.mockReturnValue("test-only");
    data.reserve.mockResolvedValue(null);
    const result = await loadPubComparison({ ...request, meetingPointId: "big-ben" }, undefined, now);
    expect(result.venues[0]?.walk.minutes).toBeNull();
    expect(data.route).not.toHaveBeenCalled();
  });
});
