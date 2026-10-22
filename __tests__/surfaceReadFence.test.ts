// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitDeviceIdentityChanged } from "@/lib/deviceAccountIdentity";
import { clearSurfaceCache, loadSurfaceJson, readSurfaceSnapshot } from "@/lib/surfaceDataCache";

beforeEach(() => clearSurfaceCache());
afterEach(() => { clearSurfaceCache(); vi.restoreAllMocks(); });

describe("painted read request and privacy boundaries", () => {
  it("shares concurrent reads and reuses the answer when the surface returns", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ pubs: ["Soho"] }));
    const first = vi.fn();
    const sibling = vi.fn();
    const options = { fetchImpl, freshForMs: 60_000 };
    await Promise.all([
      loadSurfaceJson("/api/whats-on?area=Soho", options, first),
      loadSurfaceJson("/api/whats-on?area=Soho", options, sibling),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ pubs: ["Soho"] }, "network");
    expect(sibling).toHaveBeenCalledWith({ pubs: ["Soho"] }, "network");
    const returned = vi.fn();
    await expect(loadSurfaceJson("/api/whats-on?area=Soho", options, returned)).resolves.toBe("snapshot");
    expect(returned).toHaveBeenCalledWith({ pubs: ["Soho"] }, "snapshot");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("discards held answers when the account changes and reads a new answer", async () => {
    const key = "/api/crawls?author=viewer";
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ ids: ["private-night"] }))
      .mockResolvedValueOnce(Response.json({ ids: [] }));
    await loadSurfaceJson(key, { fetchImpl }, () => {});
    emitDeviceIdentityChanged();
    expect(readSurfaceSnapshot(key)).toBeUndefined();
    const apply = vi.fn();
    await loadSurfaceJson(key, { fetchImpl }, apply);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledExactlyOnceWith({ ids: [] }, "network");
  });

  it.each(["/api/auth/me", "/api/identity", "/api/admin/queue", "/api/price-impact"])(
    "refuses to cache %s before transport", async (key) => {
      const fetchImpl = vi.fn();
      await expect(loadSurfaceJson(key, { fetchImpl }, () => {})).rejects.toThrow(/refuses/);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
