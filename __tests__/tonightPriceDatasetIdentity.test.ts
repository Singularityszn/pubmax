import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";
import { offlineCache } from "@/lib/offlineCache";
import { parseShardManifest } from "@/lib/slimShards";
import { priceDatasetDigestFor, slimLocalityField } from "@/scripts/build_slim_index.mjs";
import { venueAreaLabel } from "@/lib/venueDisplay";

const digest = "abcdefghijklmnopqrstuv";
const row = { id: "venue-abc", name: "The Test Arms", lat: 51.51, lng: -0.13, borough: "Soho", cheapestPrice: 5 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Tonight price snapshot identity", () => {
  it("changes when the selected slim price, detail order or selection policy changes", () => {
    const baseline = priceDatasetDigestFor([{ id: "one", cheapestPrice: 4 }], "first\nsecond\n", ["policy"]);
    expect(priceDatasetDigestFor([{ id: "one", cheapestPrice: 5 }], "first\nsecond\n", ["policy"])).not.toBe(baseline);
    expect(priceDatasetDigestFor([{ id: "one", cheapestPrice: 4 }], "second\nfirst\n", ["policy"])).not.toBe(baseline);
    expect(priceDatasetDigestFor([{ id: "one", cheapestPrice: 4 }], "first\nsecond\n", ["changed policy"])).not.toBe(baseline);
  });
  it("omits an empty optional locality without changing the reader's area", async () => {
    expect(slimLocalityField("")).toEqual({});
    expect(slimLocalityField("Soho")).toEqual({ locality: "Soho" });
    vi.spyOn(offlineCache, "get").mockResolvedValue(null);
    vi.spyOn(offlineCache, "set").mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [
      { ...row, id: "empty", locality: "" },
      { ...row, id: "absent", ...slimLocalityField("") },
      { ...row, id: "named", ...slimLocalityField("Soho") },
    ] }) }));
    const loaded = await loadSlimVenuesFromPathResult("/data/locality-fixture.json");
    expect(loaded.rows.map((venue) => venueAreaLabel({ locality: venue.locality, primaryBorough: "Westminster" })))
      .toEqual(["Westminster", "Westminster", "Soho"]);
  });
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
