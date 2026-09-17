import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSurfaceCache, loadSurfaceJson } from "@/lib/surfaceDataCache";

// TWO SURFACES ASKING ONE QUESTION ARE ONE REQUEST.
//
// A venue sheet mounts several readers at once, and two of them read the same
// URL: `/api/whats-on?window=tonight&limit=60` (the map lane and the venue
// chips) and `/api/citymcp/places?q=...` (the place strip and the buzz card).
// Both are `no-store`, so each duplicate was a second function invocation and a
// second round trip for an answer already on its way.

beforeEach(() => {
  clearSurfaceCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deferredFetch(body: unknown) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = vi.fn(async () => {
    await gate;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetchImpl, release: () => release() };
}

describe("loadSurfaceJson shares a read that is already in flight", () => {
  it("asks once for two callers that arrive together", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const seen: string[] = [];
    const first = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        seen.push("first");
      },
    );
    const second = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        seen.push("second");
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    release();
    expect(await first).toBe("network");
    expect(await second).toBe("network");
    // One request, and BOTH callers were given the answer.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen.sort()).toEqual(["first", "second"]);
  });

  it("still asks again once the first read has settled and its answer aged out", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const first = loadSurfaceJson<{ rows: number[] }>(
      "/api/citymcp/places?q=The%20Lamb&limit=5",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {},
    );
    release();
    await first;
    clearSurfaceCache();
    const { fetchImpl: second, release: releaseSecond } = deferredFetch({ rows: [2] });
    const run = loadSurfaceJson<{ rows: number[] }>(
      "/api/citymcp/places?q=The%20Lamb&limit=5",
      { fetchImpl: second as unknown as typeof fetch },
      () => {},
    );
    releaseSecond();
    await run;
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("one caller aborting does not take the answer away from the other", async () => {
    const { fetchImpl, release } = deferredFetch({ rows: [1] });
    const controller = new AbortController();
    const applied: string[] = [];
    const leaving = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal },
      () => {
        applied.push("leaving");
      },
    );
    const staying = loadSurfaceJson<{ rows: number[] }>(
      "/api/whats-on?window=tonight&limit=60",
      { fetchImpl: fetchImpl as unknown as typeof fetch },
      () => {
        applied.push("staying");
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    release();
    await leaving;
    expect(await staying).toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(applied).toEqual(["staying"]);
  });
});

describe("the CityMCP place search has one owner", () => {
  it("is asked for through lib/cityPlaceSearch.ts and nowhere else", () => {
    const root = process.cwd();
    const owner = path.join(root, "lib", "cityPlaceSearch.ts");
    expect(readFileSync(owner, "utf8")).toContain("/api/citymcp/places?");
    for (const file of [
      path.join(root, "components", "map", "VenueBuzz.tsx"),
      path.join(root, "components", "map", "CityPlaceStrip.tsx"),
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("searchCityPlacesByName");
      expect(source).not.toContain("/api/citymcp/places?");
    }
  });
});
