import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";
import { offlineCache } from "@/lib/offlineCache";
import { parseShardManifest } from "@/lib/slimShards";

const digest = "abcdefghijklmnopqrstuv";
const row = { id: "venue-abc", name: "The Test Arms", lat: 51.51, lng: -0.13, borough: "Soho", cheapestPrice: 5 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Tonight price snapshot identity", () => {
  it("keeps a valid digest from the manifest", () => {
    expect(parseShardManifest({ version: 2, priceDatasetDigest: digest, shards: [] })?.priceDatasetDigest).toBe(digest);
    expect(parseShardManifest({ version: 2, priceDatasetDigest: "invalid", shards: [] })?.priceDatasetDigest).toBeUndefined();
  });

  it("accepts the matching shard and refuses a different or missing digest", async () => {
    vi.spyOn(offlineCache, "get").mockResolvedValue(null);
    vi.spyOn(offlineCache, "set").mockResolvedValue(true);
    const fetcher = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ d: digest, rows: [row] }) }));
    vi.stubGlobal("fetch", fetcher);
    const options = { expectedPriceDatasetDigest: digest, bypassInFlight: true };
    expect((await loadSlimVenuesFromPathResult("/data/matching-shard.json", options)).rows).toHaveLength(1);
    fetcher.mockImplementation(async () => ({ ok: true, json: async () => ({ d: "different", rows: [row] }) }));
    expect(await loadSlimVenuesFromPathResult("/data/stale-shard.json", options)).toEqual({ rows: [], status: "unavailable" });
    fetcher.mockImplementation(async () => ({ ok: true, json: async () => ({ rows: [row] }) }));
    expect(await loadSlimVenuesFromPathResult("/data/old-shard.json", options)).toEqual({ rows: [], status: "unavailable" });
  });
});
