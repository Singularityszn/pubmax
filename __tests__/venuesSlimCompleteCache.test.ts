import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
      return true;
    },
  },
}));

import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";
import { createSlimShardLoader } from "@/lib/slimShards";

const PARTIAL_PATH = "/data/slim-partial-cache.json";
const COMPLETE_PATH = "/data/slim-complete-cache.json";
const VALID_ROW = {
  id: "venue-partial",
  name: "Partial Arms",
  lat: 51.5,
  lng: -0.1,
  cheapestPrice: 5,
  borough: "Camden",
};

describe("loadSlimVenues caches only complete payloads", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("does not treat a later fetch failure as a complete cached index", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PARTIAL_PATH) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, VALID_ROW]),
        } as Response);
      }
      return Promise.reject(new Error("cellar signal"));
    }) as typeof fetch;

    await expect(loadSlimVenuesFromPathResult(PARTIAL_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "unavailable",
    });
    expect([...store.values()]).toEqual([]);

    globalThis.fetch = (() => Promise.reject(new Error("cellar signal"))) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(PARTIAL_PATH)).rejects.toThrow("cellar signal");
  });

  it("returns a complete cached payload as ready when the live read fails", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === COMPLETE_PATH) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([VALID_ROW]),
        } as Response);
      }
      return Promise.reject(new Error("cellar signal"));
    }) as typeof fetch;

    await expect(loadSlimVenuesFromPathResult(COMPLETE_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "ready",
    });

    globalThis.fetch = (() => Promise.reject(new Error("cellar signal"))) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(COMPLETE_PATH)).resolves.toEqual({
      rows: [VALID_ROW],
      status: "ready",
    });
  });
  it("preserves the minimum price's own evidence through live and offline reads", async () => {
    const path = "/data/slim-price-receipts.json";
    const row = { ...VALID_ROW, priceSource: "Pint Prices", priceObservedAt: "2026-07-03T23:10:47.000Z" };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [row] }) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(path)).resolves.toEqual({ rows: [row], status: "ready" });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch;
    await expect(loadSlimVenuesFromPathResult(path)).resolves.toEqual({ rows: [row], status: "ready" });
  });

  it.each([false, true])("retains the response snapshot before adoption with revision checking=%s", async (checkRevision) => {
    const path = "/data/slim-snapshot-core.json";
    const payload = { revision: "target", d: "abcdefghijklmnopqrstuv", rows: [VALID_ROW] };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });

    await expect(loadSlimVenuesFromPathResult(path, checkRevision ? { expectedRevision: "target" } : {}))
      .resolves.toEqual({ rows: [VALID_ROW], status: "ready" });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(loadSlimVenuesFromPathResult(path, {
      expectedRevision: "target",
      expectedPriceDatasetDigest: "abcdefghijklmnopqrstuv",
    })).resolves.toEqual({ rows: [VALID_ROW], status: "ready" });
    await expect(loadSlimVenuesFromPathResult(path, {
      expectedRevision: "target",
      expectedPriceDatasetDigest: "zyxwvutsrqponmlkjihgfed",
    })).rejects.toThrow("offline");
  });

  it.each([true, false])("uses the speculative core offline only under a matching manifest=%s", async (matching) => {
    const corePath = "/data/venues_slim.core.json";
    const digest = "abcdefghijklmnopqrstuv";
    const bounds = { west: -0.2, south: 51.45, east: 0, north: 51.55 };
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revision: "target", d: digest, rows: [VALID_ROW] }),
    });
    globalThis.fetch = fetcher;
    const firstVisit = createSlimShardLoader("london", { deferSpatial: true });
    await expect(firstVisit.initialResult(bounds)).resolves.toEqual({ rows: [VALID_ROW], status: "ready" });
    expect(fetcher).toHaveBeenCalledOnce();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("manifest")) throw new Error("offline core");
      return {
        ok: true,
        json: async () => ({
          version: 2,
          revision: "target",
          priceDatasetDigest: matching ? digest : "zyxwvutsrqponmlkjihgfe",
          grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
          shards: [{ id: "core", core: true, url: corePath, count: 1, bbox: [-0.2, 51.45, 0, 51.55] }],
        }),
      } as Response;
    });
    const reload = createSlimShardLoader("london");
    const result = await reload.nearPoint(51.5, -0.1);
    expect(result.rows).toEqual(matching ? [VALID_ROW] : []);
    expect(result.status).toBe(matching ? "ready" : "unavailable");
    expect(reload.coverageComplete(bounds)).toBe(matching);
  });

  it.each([
    { label: "bare rows", payload: [VALID_ROW] },
    ...[undefined, "", null, 42].map((d) => ({
      label: `digest ${String(d)}`,
      payload: { revision: "target", d, rows: [VALID_ROW] },
    })),
  ])("preserves a certified mirror after a response with $label", async ({ payload }) => {
    const path = "/data/slim-uncertified-core.json";
    const options = { expectedRevision: "target", expectedPriceDatasetDigest: "abcdefghijklmnopqrstuv" };
    const savedRow = { ...VALID_ROW, id: "venue-certified", name: "Certified Arms" };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revision: "target", d: "abcdefghijklmnopqrstuv", rows: [savedRow] }),
    });
    await expect(loadSlimVenuesFromPathResult(path, options))
      .resolves.toEqual({ rows: [savedRow], status: "ready" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    await expect(loadSlimVenuesFromPathResult(path))
      .resolves.toEqual({ rows: [VALID_ROW], status: "ready" });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(loadSlimVenuesFromPathResult(path, options))
      .resolves.toEqual({ rows: [savedRow], status: "ready" });
  });

  it("does not invent an absent response digest from a later request", async () => {
    const path = "/data/slim-unknown-snapshot.json";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revision: "target", rows: [VALID_ROW] }),
    });
    await expect(loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }))
      .resolves.toEqual({ rows: [VALID_ROW], status: "ready" });
    await expect(loadSlimVenuesFromPathResult(path, {
      expectedRevision: "target",
      expectedPriceDatasetDigest: "abcdefghijklmnopqrstuv",
    })).resolves.toEqual({ rows: [], status: "unavailable" });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(loadSlimVenuesFromPathResult(path, {
      expectedRevision: "target",
      expectedPriceDatasetDigest: "abcdefghijklmnopqrstuv",
    })).rejects.toThrow("offline");
    await expect(loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }))
      .resolves.toEqual({ rows: [VALID_ROW], status: "ready" });
  });

});
