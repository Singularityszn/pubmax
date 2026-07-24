import { describe, expect, it, vi } from "vitest";

import {
  MAP_INTENT_WARM_PATHS,
  shouldWarmMapIntent,
  warmMapIntentData,
  type MapWarmDeps,
} from "@/lib/mapWarmup";

function makeDeps(overrides: Partial<MapWarmDeps> = {}) {
  const fetch = vi.fn<MapWarmDeps["fetch"]>(() => Promise.resolve({}));
  const deps: MapWarmDeps = {
    fetch,
    navigator: { connection: { effectiveType: "4g", saveData: false } },
    ...overrides,
  };
  return { deps, fetch };
}

describe("shouldWarmMapIntent", () => {
  it("does not warm when navigator is unavailable", () => {
    expect(shouldWarmMapIntent(undefined)).toBe(false);
    expect(shouldWarmMapIntent(null)).toBe(false);
  });

  it("warms when navigator exists but Network Information is unavailable", () => {
    expect(shouldWarmMapIntent({})).toBe(true);
    expect(shouldWarmMapIntent({ connection: undefined })).toBe(true);
  });

  it("does not warm when Save Data is enabled", () => {
    expect(shouldWarmMapIntent({ connection: { saveData: true } })).toBe(false);
  });

  it("does not warm on 2g or slow-2g connections", () => {
    expect(shouldWarmMapIntent({ connection: { effectiveType: "2g" } })).toBe(false);
    expect(shouldWarmMapIntent({ connection: { effectiveType: "slow-2g" } })).toBe(false);
  });

  it("warms on a normal connection", () => {
    expect(
      shouldWarmMapIntent({ connection: { effectiveType: "4g", saveData: false } }),
    ).toBe(true);
  });
});

describe("warmMapIntentData", () => {
  it("does not fetch when navigator is unavailable", () => {
    const { deps, fetch } = makeDeps({ navigator: undefined });
    warmMapIntentData(deps);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when Save Data is enabled", () => {
    const { deps, fetch } = makeDeps({ navigator: { connection: { saveData: true } } });
    warmMapIntentData(deps);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch on 2g or slow-2g connections", () => {
    const blockedTypes = ["2g", "slow-2g"];

    for (const effectiveType of blockedTypes) {
      const { deps, fetch } = makeDeps({ navigator: { connection: { effectiveType } } });
      warmMapIntentData(deps);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("warms all map intent paths on a normal connection", () => {
    const { deps, fetch } = makeDeps();
    warmMapIntentData(deps);
    expect(fetch).toHaveBeenCalledTimes(MAP_INTENT_WARM_PATHS.length);
    expect(fetch.mock.calls.map(([path]) => path)).toEqual(MAP_INTENT_WARM_PATHS);
    for (const path of MAP_INTENT_WARM_PATHS) {
      expect(fetch).toHaveBeenCalledWith(path, { cache: "force-cache" });
    }
  });

  it("dedupes warm requests with the same seen set", () => {
    const seen = new Set<string>();
    const { deps, fetch } = makeDeps({ seen });

    warmMapIntentData(deps);
    warmMapIntentData(deps);

    expect(fetch).toHaveBeenCalledTimes(MAP_INTENT_WARM_PATHS.length);
    expect([...seen]).toEqual(MAP_INTENT_WARM_PATHS);
  });

  it("swallows fetch failures", () => {
    const fetch = vi.fn<MapWarmDeps["fetch"]>(() =>
      Promise.reject(new Error("warm failed")),
    );
    expect(() =>
      warmMapIntentData({
        fetch,
        navigator: { connection: { effectiveType: "4g", saveData: false } },
      }),
    ).not.toThrow();
  });
});

describe("warmPathsForMapHref", () => {
  it("returns London slim paths for /map", async () => {
    const { warmPathsForMapHref, MAP_INTENT_WARM_PATHS } = await import(
      "@/lib/mapWarmup"
    );
    expect(warmPathsForMapHref("/map")).toEqual(MAP_INTENT_WARM_PATHS);
    expect(warmPathsForMapHref("/map?log=1")).toEqual(MAP_INTENT_WARM_PATHS);
  });

  it("returns city slim (+ pois) for /map/{city}", async () => {
    const { warmPathsForMapHref } = await import("@/lib/mapWarmup");
    expect(warmPathsForMapHref("/map/manchester")).toEqual([
      "/data/cities/manchester/venues_slim.json",
      "/data/cities/manchester/pois.json",
    ]);
    expect(warmPathsForMapHref("/map/bath")).toEqual([
      "/data/cities/bath/venues_slim.json",
    ]);
  });
});

describe("warmNavRoute / warmPrimaryTabRoutes", () => {
  it("prefetches non-map destinations without re-entry", async () => {
    const { warmNavRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmNavRoute({ prefetch }, "/tonight", seen);
    warmNavRoute({ prefetch }, "/feed", seen);
    warmNavRoute({ prefetch }, "/tonight", seen);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith("/tonight");
    expect(prefetch).toHaveBeenCalledWith("/feed");
  });

  it("warms every durable tab and skips Moment", async () => {
    const { warmPrimaryTabRoutes } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmPrimaryTabRoutes(
      { prefetch },
      ["/today", "/map", "/moment?returnTo=%2Ftoday", "/tonight", "/feed", "/u/you"],
      seen,
    );
    expect(prefetch).toHaveBeenCalledWith("/today");
    expect(prefetch).toHaveBeenCalledWith("/map");
    expect(prefetch).toHaveBeenCalledWith("/tonight");
    expect(prefetch).toHaveBeenCalledWith("/feed");
    expect(prefetch).toHaveBeenCalledWith("/u/you");
    expect(prefetch.mock.calls.every(([href]) => !String(href).startsWith("/moment"))).toBe(true);
  });
});

describe("warmMapRoute", () => {
  it("prefetches the route once and warms map data for /map", async () => {
    const { warmMapRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmMapRoute({ prefetch }, "/map?log=1", seen);
    warmMapRoute({ prefetch }, "/map", seen);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith("/map");
    expect(seen.has("/map")).toBe(true);
  });

  it("prefetches city map routes", async () => {
    const { warmMapRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmMapRoute({ prefetch }, "/map/oxford", seen);
    expect(prefetch).toHaveBeenCalledWith("/map/oxford");
  });

  it("still marks non-map routes as warmed without calling warmMapIntent paths twice", async () => {
    const { warmMapRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmMapRoute({ prefetch }, "/discover", seen);
    warmMapRoute({ prefetch }, "/discover", seen);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith("/discover");
  });

  it("retries prefetch on the next intent when the first prefetch threw", async () => {
    // A prefetch throw (dev HMR, router-not-mounted, transient) must NOT
    // silently poison the seen set. The route stays unwarmed until a call
    // succeeds so a follow-up hover/touch actually retries.
    const { warmMapRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi
      .fn<(href: string) => void>()
      .mockImplementationOnce(() => {
        throw new Error("router not mounted");
      })
      .mockImplementationOnce(() => undefined);

    warmMapRoute({ prefetch }, "/map", seen);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(seen.has("/map")).toBe(false);

    warmMapRoute({ prefetch }, "/map", seen);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(seen.has("/map")).toBe(true);

    // A third attempt is deduped now that a successful prefetch has landed.
    warmMapRoute({ prefetch }, "/map", seen);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
});
