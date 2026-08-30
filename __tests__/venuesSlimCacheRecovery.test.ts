import { afterEach, describe, expect, it, vi } from "vitest";

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
