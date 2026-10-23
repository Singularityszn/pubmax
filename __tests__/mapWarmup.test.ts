import { describe, expect, it, vi } from "vitest";
import type { Route } from "next";

import {
  MAP_INTENT_WARM_PATHS,
  scheduleMapCanvasWarmup,
  shouldWarmMapIntent,
  warmMapIntentData,
  type MapCanvasWarmState,
  type MapWarmDeps,
} from "@/lib/mapWarmup";
import { defined } from "@/__tests__/helpers/defined";

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

describe("scheduleMapCanvasWarmup", () => {
  it("loads the canvas module once during idle on a normal connection", async () => {
    const callbacks: Array<() => void> = [];
    const load = vi.fn(() => Promise.resolve({}));
    const state: MapCanvasWarmState = { status: "idle" };
    const deps = {
      navigator: { connection: { effectiveType: "4g", saveData: false } },
      schedule: (callback: () => void) => callbacks.push(callback),
      load,
      state,
    };

    scheduleMapCanvasWarmup(deps);
    scheduleMapCanvasWarmup(deps);

    expect(callbacks).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    defined(callbacks[0])();
    expect(load).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(state.status).toBe("loaded");
  });

  it("does not schedule the large canvas module for Save Data or 2g", () => {
    for (const connection of [
      { saveData: true, effectiveType: "4g" },
      { saveData: false, effectiveType: "2g" },
      { saveData: false, effectiveType: "slow-2g" },
    ]) {
      const schedule = vi.fn();
      const load = vi.fn(() => Promise.resolve({}));
      scheduleMapCanvasWarmup({
        navigator: { connection },
        schedule,
        load,
        state: { status: "idle" },
      });
      expect(schedule).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("rechecks connection policy before the scheduled load starts", () => {
    const callbacks: Array<() => void> = [];
    const connection = { effectiveType: "4g", saveData: false };
    const load = vi.fn(() => Promise.resolve({}));
    const state: MapCanvasWarmState = { status: "idle" };

    scheduleMapCanvasWarmup({
      navigator: { connection },
      schedule: (callback) => callbacks.push(callback),
      load,
      state,
    });
    connection.saveData = true;
    defined(callbacks[0])();

    expect(load).not.toHaveBeenCalled();
    expect(state.status).toBe("idle");
  });

  it("allows a later warmup after a module-load failure", async () => {
    const callbacks: Array<() => void> = [];
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({});
    const state: MapCanvasWarmState = { status: "idle" };
    const deps = {
      navigator: { connection: { effectiveType: "4g" } },
      schedule: (callback: () => void) => callbacks.push(callback),
      load,
      state,
    };

    scheduleMapCanvasWarmup(deps);
    callbacks.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.status).toBe("idle");

    scheduleMapCanvasWarmup(deps);
    callbacks.shift()?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(state.status).toBe("loaded");
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

describe("warmNavRoute", () => {
  it("prefetches non-map destinations without re-entry", async () => {
    const { warmNavRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmNavRoute({ prefetch }, "/tonight", seen);
    warmNavRoute({ prefetch }, "/social", seen);
    warmNavRoute({ prefetch }, "/tonight", seen);
    // Fragments do not reach the server. Queries select distinct route data.
    warmNavRoute({ prefetch }, "/u/night_owl#contribution-impact", seen);
    warmNavRoute({ prefetch }, "/u/night_owl", seen);
    warmNavRoute({ prefetch }, "/plan?occasion=quiet", seen);
    warmNavRoute({ prefetch }, "/plan", seen);
    expect(prefetch).toHaveBeenCalledWith("/u/night_owl");
    expect(prefetch).not.toHaveBeenCalledWith("/u/night_owl#contribution-impact");
    expect(prefetch).toHaveBeenCalledWith("/plan");
    expect(prefetch).toHaveBeenCalledWith("/plan?occasion=quiet");
    expect(prefetch).toHaveBeenCalledTimes(5);
    expect(prefetch).toHaveBeenCalledWith("/tonight");
    expect(prefetch).toHaveBeenCalledWith("/social");
  });

  it("keeps sibling query destinations distinct and ignores only fragments", async () => {
    const { warmNavRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmNavRoute({ prefetch }, "/social?tab=discover#main", seen);
    warmNavRoute({ prefetch }, "/social?feed=nearby", seen);
    warmNavRoute({ prefetch }, "/social?tab=discover#cards", seen);
    expect(prefetch.mock.calls).toEqual([
      ["/social?tab=discover"], ["/social?feed=nearby"],
    ]);
  });

  it.each(["default", "caller"] as const)("bounds the %s route history and warms evicted destinations again", async (kind) => {
    const { warmNavRoute, MAX_WARMED_ROUTES } = await import("@/lib/mapWarmup");
    expect(MAX_WARMED_ROUTES).toBe(128);
    const seen = kind === "caller" ? new Set<string>() : undefined;
    const prefetch = vi.fn();
    const href = (index: number) => `/plan?query=${kind}-${index}` as Route;
    for (let index = 0; index <= MAX_WARMED_ROUTES; index++) {
      warmNavRoute({ prefetch }, href(index), seen);
    }
    expect(prefetch).toHaveBeenCalledTimes(MAX_WARMED_ROUTES + 1);
    if (seen) expect(seen.size).toBe(MAX_WARMED_ROUTES);
    warmNavRoute({ prefetch }, href(MAX_WARMED_ROUTES), seen);
    expect(prefetch).toHaveBeenCalledTimes(MAX_WARMED_ROUTES + 1);
    warmNavRoute({ prefetch }, href(0), seen);
    expect(prefetch).toHaveBeenLastCalledWith(href(0));
    expect(prefetch).toHaveBeenCalledTimes(MAX_WARMED_ROUTES + 2);
  });

  it("does not prefetch a fragment-only destination", async () => {
    const { warmNavRoute } = await import("@/lib/mapWarmup");
    const prefetch = vi.fn();
    warmNavRoute({ prefetch }, "#main", new Set());
    expect(prefetch).not.toHaveBeenCalled();
  });
});

describe("warmMapRoute", () => {
  it("prefetches distinct map queries without losing the bare map route", async () => {
    const { warmMapRoute } = await import("@/lib/mapWarmup");
    const seen = new Set<string>();
    const prefetch = vi.fn();
    warmMapRoute({ prefetch }, "/map?log=1", seen);
    warmMapRoute({ prefetch }, "/map", seen);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith("/map?log=1");
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
