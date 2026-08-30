import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offlineGet = vi.hoisted(() => vi.fn(async () => null as unknown));
const offlineSet = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: offlineGet,
    set: offlineSet,
  },
}));

import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

const ROW = {
  id: "venue-cache-retry",
  name: "Retry Arms",
  lat: 51.5,
  lng: -0.1,
  cheapestPrice: null,
  borough: "Camden",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  offlineGet.mockReset();
  offlineSet.mockReset();
  offlineGet.mockResolvedValue(null);
  offlineSet.mockResolvedValue(true);
});

describe("slim venue cache recovery", () => {
  it("retries one cache-bypassed read after an expected revision mismatch", async () => {
    const path = "/data/cache-recovery-current.json";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "previous", rows: [ROW] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "target", rows: [ROW] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable after one retry remains stale", async () => {
    const path = "/data/cache-recovery-stale.json";
    const staleResponse = {
      ok: true,
      json: async () => ({ revision: "previous", rows: [ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(staleResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses a current-revision cache after both network reads remain stale", async () => {
    const path = "/data/cache-recovery-stale-with-fallback.json";
    offlineGet.mockResolvedValueOnce({ revision: "target", rows: [ROW] });
    const staleResponse = {
      ok: true,
      json: async () => ({ revision: "previous", rows: [ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(staleResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(offlineGet).toHaveBeenCalledWith(
      `venues_slim:v2:${path}`,
    );
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("does not retry a request abort as cache recovery", async () => {
    const path = "/data/cache-recovery-abort.json";
    const abort = new DOMException("aborted", "AbortError");
    const fetchSpy = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).rejects.toBe(abort);
    expect(fetchSpy).toHaveBeenCalledWith(path);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
