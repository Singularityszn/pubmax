import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("warms the exact deployment URLs consumed by the foreground map loader", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "intent-test-revision");
  vi.stubGlobal("window", {});
  const { warmMapIntentData, warmPathsForMapHref } = await import("@/lib/mapWarmup");
  const { createSlimShardLoader } = await import("@/lib/slimShards");
  const cache = new Map<string, string>();
  const misses: string[] = [];
  const fetch = vi.fn(async (path: string) => {
    if (!cache.has(path)) {
      misses.push(path);
      cache.set(path, readFileSync(`public${path.split("?")[0]}`, "utf8"));
    }
    return new Response(cache.get(path));
  });
  vi.stubGlobal("fetch", fetch);

  warmMapIntentData({ fetch, navigator: {}, paths: warmPathsForMapHref("/map") });
  const warmedReads = misses.length;
  const rows = await createSlimShardLoader("london").core();

  expect(rows.length).toBeGreaterThan(0);
  expect(misses.slice(warmedReads)).toEqual([]);
  expect(misses).toContain("/data/venues_slim.manifest.json?v=intent-test-revision");
  expect(misses).toContain("/data/venues_slim.core.json?v=intent-test-revision");
});

it("keeps local venue keys and London overlay keys unchanged", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "local");
  const { warmPathsForMapHref } = await import("@/lib/mapWarmup");
  expect(warmPathsForMapHref("/map?sel=venue-test")).toEqual([
    "/data/venues_slim.manifest.json",
    "/data/venues_slim.core.json",
    "/data/london_pois.json",
    "/data/tfl_lines.json",
  ]);
});

it("warms the same city monolith URL that the city loader reads", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "intent-city-revision");
  vi.stubGlobal("window", {});
  const { warmMapIntentData, warmPathsForMapHref } = await import("@/lib/mapWarmup");
  const { loadSlimVenuesForCity } = await import("@/lib/venuesSlim");
  const cache = new Map<string, string>();
  const misses: string[] = [];
  const fetch = vi.fn(async (path: string) => {
    if (!cache.has(path)) {
      misses.push(path);
      cache.set(path, readFileSync(`public${path.split("?")[0]}`, "utf8"));
    }
    return new Response(cache.get(path));
  });
  vi.stubGlobal("fetch", fetch);
  warmMapIntentData({ fetch, navigator: {}, paths: warmPathsForMapHref("/map/manchester") });
  const warmedReads = misses.length;
  expect((await loadSlimVenuesForCity("manchester")).length).toBeGreaterThan(0);
  expect(misses.slice(warmedReads)).toEqual([]);
  expect(misses).toContain("/data/cities/manchester/venues_slim.json?v=intent-city-revision");
});

it("versions each city's venue index while preserving its own overlay paths", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "release/with spaces");
  const { warmPathsForMapHref } = await import("@/lib/mapWarmup");
  expect(warmPathsForMapHref("/map/manchester?mode=build")).toEqual([
    "/data/cities/manchester/venues_slim.json?v=release%2Fwith%20spaces",
    "/data/cities/manchester/pois.json",
  ]);
  expect(warmPathsForMapHref("/map/leeds")).toEqual([
    "/data/cities/leeds/venues_slim.json?v=release%2Fwith%20spaces",
  ]);
});

it("deduplicates default and href-specific intent reads under the same revision keys", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "intent-test-revision");
  vi.stubGlobal("window", {});
  const { warmMapIntentData, warmPathsForMapHref } = await import("@/lib/mapWarmup");
  const fetch = vi.fn(async () => new Response("[]"));
  const seen = new Set<string>();
  warmMapIntentData({ fetch, navigator: {}, seen });
  warmMapIntentData({ fetch, navigator: {}, paths: warmPathsForMapHref("/map"), seen });
  expect(fetch.mock.calls).toHaveLength(4);
  expect([...seen]).toEqual([
    "/data/venues_slim.manifest.json?v=intent-test-revision",
    "/data/venues_slim.core.json?v=intent-test-revision",
    "/data/london_pois.json",
    "/data/tfl_lines.json",
  ]);
});

it.each([
  { saveData: true },
  { effectiveType: "2g" },
  { effectiveType: "slow-2g" },
])("still respects connection limits for versioned warm reads: %j", async (connection) => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "intent-test-revision");
  const { warmMapIntentData } = await import("@/lib/mapWarmup");
  const fetch = vi.fn(async () => new Response("[]"));
  warmMapIntentData({ fetch, navigator: { connection } });
  expect(fetch).not.toHaveBeenCalled();
});

it("recognises the early manifest's raw cache key when intent paths are versioned", async () => {
  vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "intent-test-revision");
  vi.stubGlobal("window", {
    __pubmaxMapWarm: {
      json: new Map([["/data/venues_slim.manifest.json", Promise.resolve({})]]),
    },
  });
  const { warmMapIntentData, warmPathsForMapHref } = await import("@/lib/mapWarmup");
  const fetch = vi.fn(async () => new Response("[]"));
  warmMapIntentData({ fetch, navigator: {}, paths: warmPathsForMapHref("/map") });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch).not.toHaveBeenCalledWith(
    "/data/venues_slim.manifest.json?v=intent-test-revision",
    { cache: "force-cache" },
  );
});
