// @vitest-environment jsdom
import { act, createElement, createRef, useEffect, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapRingLoads } from "@/components/map/pubmap/useMapRingLoads";
import type { CityId } from "@/lib/cities";
import { createSlimShardLoader, type MapBounds, type SlimShardLoader } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WESTMINSTER: MapBounds = { west: -0.14, south: 51.49, east: -0.12, north: 51.51 };
const ALDWYCH: MapBounds = { west: -0.13, south: 51.51, east: -0.11, north: 51.52 };

function ref<T>(value: T): RefObject<T> {
  const held = createRef<T>() as { current: T };
  held.current = value;
  return held;
}

type Deferred = { resolve: (rows: SlimVenue[]) => void };

function fakeLoader() {
  const viewport: Deferred[] = [];
  const loader = {
    inBounds: vi.fn((_bounds: MapBounds, ring: number) =>
      ring === 0
        ? new Promise<SlimVenue[]>((resolve) => viewport.push({ resolve }))
        : Promise.resolve([]),
    ),
  } as unknown as SlimShardLoader;
  const land = (index: number) => {
    const ring = viewport[index];
    if (!ring) throw new Error(`No viewport ring ${index} was asked for.`);
    ring.resolve([]);
  };
  return { loader, viewport, land };
}

type Lane = ReturnType<typeof useMapRingLoads>;

let host: HTMLDivElement;
let root: Root;
let lane: Lane;
let idle: Array<() => void>;
const mergeSlimVenues = vi.fn<(rows: SlimVenue[]) => void>();
function publish(next: Lane) {
  lane = next;
}

function Probe({ held, loader }: { held: boolean; loader: SlimShardLoader }) {
  const current = useMapRingLoads({
    secondaryStreamsHeld: held,
    refs: refs(loader),
    mergeSlimVenues,
    refreshCountCoverage: () => undefined,
  });
  useEffect(() => publish(current));
  return null;
}

let cachedRefs: Parameters<typeof useMapRingLoads>[0]["refs"] | null = null;
function refs(loader: SlimShardLoader) {
  cachedRefs ??= {
    slimLoaderRef: ref<SlimShardLoader | null>(loader),
    slimLoaderGenerationRef: ref(0),
    targetViewportLoadStartedRef: ref(false),
    latestMapBoundsRef: ref<MapBounds | null>(null),
    latestMapBoundsCityRef: ref<CityId | null>(null),
    activeMapCityIdRef: ref<CityId>("london"),
  };
  return cachedRefs;
}

function render(held: boolean, loader: SlimShardLoader) {
  act(() => root.render(createElement(Probe, { held, loader })));
}

beforeEach(() => {
  cachedRefs = null;
  idle = [];
  mergeSlimVenues.mockClear();
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => idle.push(callback));
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("the view's shards landing", () => {
  it("is busy until the viewport ring lands, then ready", async () => {
    const { loader, land } = fakeLoader();
    render(false, loader);
    expect(lane.viewShardsLanding).toBe(true);

    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    expect(lane.viewShardsLanding).toBe(true);

    await act(async () => land(0));
    expect(lane.viewShardsLanding).toBe(false);
  });

  it("stays busy while the first-paint hold keeps the ring back", async () => {
    const { loader, viewport, land } = fakeLoader();
    render(true, loader);
    act(() => lane.settleViewShards());
    expect(lane.viewShardsLanding).toBe(false);

    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    expect(lane.viewShardsLanding).toBe(true);
    expect(viewport).toHaveLength(0);

    render(false, loader);
    expect(viewport).toHaveLength(1);
    expect(lane.viewShardsLanding).toBe(true);

    await act(async () => land(0));
    expect(lane.viewShardsLanding).toBe(false);
  });

  it("lets only the newest view say it has landed", async () => {
    const { loader, viewport, land } = fakeLoader();
    render(false, loader);
    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    act(() => lane.scheduleRingLoad(loader, ALDWYCH));
    expect(viewport).toHaveLength(2);

    await act(async () => land(0));
    expect(lane.viewShardsLanding).toBe(true);

    await act(async () => land(1));
    expect(lane.viewShardsLanding).toBe(false);
  });

  it("is ready when the loader says nothing more is coming", () => {
    const { loader } = fakeLoader();
    render(false, loader);
    act(() => lane.awaitViewShards());
    expect(lane.viewShardsLanding).toBe(true);
    act(() => lane.settleViewShards());
    expect(lane.viewShardsLanding).toBe(false);
  });
});

describe("ring scheduling", () => {
  it("starts each viewport immediately and waits for idle before loading neighbours", () => {
    const { loader } = fakeLoader();
    render(false, loader);

    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    act(() => lane.scheduleRingLoad(loader, ALDWYCH));
    expect(loader.inBounds).toHaveBeenCalledTimes(2);
    expect(loader.inBounds).toHaveBeenNthCalledWith(1, WESTMINSTER, 0);
    expect(loader.inBounds).toHaveBeenNthCalledWith(2, ALDWYCH, 0);

    act(() => idle.forEach((callback) => callback()));
    expect(loader.inBounds).toHaveBeenCalledTimes(6);
    expect(loader.inBounds).toHaveBeenNthCalledWith(3, WESTMINSTER, 1);
    expect(loader.inBounds).toHaveBeenNthCalledWith(4, WESTMINSTER, 0);
    expect(loader.inBounds).toHaveBeenNthCalledWith(5, ALDWYCH, 1);
    expect(loader.inBounds).toHaveBeenNthCalledWith(6, ALDWYCH, 0);
  });

  it("resumes a held request against the current camera bounds", async () => {
    const { loader, land } = fakeLoader();
    render(true, loader);
    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    refs(loader).latestMapBoundsRef.current = ALDWYCH;
    refs(loader).latestMapBoundsCityRef.current = "london";
    expect(loader.inBounds).not.toHaveBeenCalled();

    render(false, loader);
    expect(loader.inBounds).toHaveBeenCalledExactlyOnceWith(ALDWYCH, 0);
    act(() => idle.forEach((callback) => callback()));
    expect(loader.inBounds).toHaveBeenNthCalledWith(2, ALDWYCH, 1);
    await act(async () => {
      land(0);
      land(1);
    });
    expect(lane.viewShardsLanding).toBe(false);
  });

  it.each([false, true])("completes repeated bounds after a canvas hold (land during hold: %s)", async (landDuringHold) => {
    const { loader, land } = fakeLoader();
    render(false, loader);
    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    render(true, loader);
    act(() => lane.scheduleRingLoad(loader, WESTMINSTER));
    expect(loader.inBounds).toHaveBeenCalledTimes(1);
    act(() => idle.shift()?.());
    expect(loader.inBounds).toHaveBeenCalledTimes(1);
    if (landDuringHold) {
      await act(async () => land(0));
      expect(lane.viewShardsLanding).toBe(true);
    }

    render(false, loader);
    await act(async () => {
      land(0);
      land(1);
    });
    expect(lane.viewShardsLanding).toBe(false);
  });
});

describe("visible shard recovery", () => {
  it.each([
    { moved: false, retryFails: false },
    { moved: false, retryFails: true },
    { moved: true, retryFails: false },
    { moved: true, retryFails: true },
  ])("tracks idle recovery through merge or failure ($moved, $retryFails)", async ({ moved, retryFails }) => {
    const centre = { west: 1.1, south: 51.1, east: 1.9, north: 51.9 };
    const east = { west: 2.1, south: 51.1, east: 2.9, north: 51.9 };
    const retryPath = moved ? "/data/retry-east.json" : "/data/retry-centre.json";
    const recovered: SlimVenue = {
      id: "recovered", name: "Recovered pub", lat: 51.5, lng: moved ? 2.5 : 1.5,
      cheapestPrice: null, borough: "x",
    };
    const response = Promise.withResolvers<Response>();
    const outsideResponse = Promise.withResolvers<Response>();
    const retryStarted = Promise.withResolvers<void>();
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "https://pubmaxxing.com").pathname;
      if (path.endsWith(".manifest.json")) {
        return Response.json({
          version: 2,
          grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
          shards: [
            { id: "centre", core: true, url: "/data/retry-centre.json", count: 1, bbox: [1, 51, 2, 52] },
            { id: "east", core: false, url: "/data/retry-east.json", count: 1, bbox: [2, 51, 3, 52] },
            { id: "outside", core: false, url: "/data/retry-outside.json", count: 1, bbox: [0, 51, 1, 52] },
          ],
        });
      }
      if (path === retryPath) {
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 503 });
        retryStarted.resolve();
        return response.promise;
      }
      if (path === "/data/retry-outside.json") return outsideResponse.promise;
      if (path === "/data/retry-centre.json" || path === "/data/retry-east.json") {
        return Response.json([]);
      }
      throw new Error(`Unexpected shard: ${path}`);
    }));
    const loader = createSlimShardLoader("london", { bypassInFlight: true });
    render(false, loader);
    await act(async () => lane.scheduleRingLoad(loader, centre));
    if (moved) await act(async () => lane.scheduleRingLoad(loader, east));
    refs(loader).latestMapBoundsRef.current = moved ? east : centre;
    refs(loader).latestMapBoundsCityRef.current = "london";
    expect(attempts).toBe(1);
    expect(lane.viewShardsLanding).toBe(false);

    await act(async () => {
      idle.shift()?.();
      await retryStarted.promise;
    });
    expect(attempts).toBe(2);
    expect(lane.viewShardsLanding).toBe(true);
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).not.toContainEqual(recovered);

    await act(async () => response.resolve(
      retryFails ? new Response(null, { status: 503 }) : Response.json([recovered]),
    ));
    expect(lane.viewShardsLanding).toBe(false);
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).toEqual(retryFails ? [] : [recovered]);
    expect(attempts).toBe(2);

    await act(async () => outsideResponse.resolve(Response.json([])));
    expect(lane.viewShardsLanding).toBe(false);
  });
});

describe("viewport rows shared with a slower neighbour request", () => {
  it.each([false, true])("merges the visible shard before readiness (already fetched: %s)", async (alreadyFetched) => {
    const centre = { west: 1.1, south: 51.1, east: 1.9, north: 51.9 };
    const visible = { west: 2.1, south: 51.1, east: 2.9, north: 51.9 };
    const row = (id: string, lng: number): SlimVenue => ({
      id, name: id, lat: 51.5, lng, cheapestPrice: null, borough: "x",
    });
    const x = row("visible-x", 2.5);
    const y = row("slow-y", 0.5);
    const responseX = Promise.withResolvers<Response>();
    const responseY = Promise.withResolvers<Response>();
    const neighboursStarted = Promise.withResolvers<void>();
    let neighbourRequests = 0;
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "https://pubmaxxing.com").pathname;
      requests.push(path);
      if (path.endsWith(".manifest.json")) {
        return Response.json({
          version: 2,
          grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
          shards: [
            { id: "centre", core: true, url: "/data/ring-centre.json", count: 1, bbox: [1, 51, 2, 52] },
            { id: "x", core: false, url: "/data/ring-x.json", count: 1, bbox: [2, 51, 3, 52] },
            { id: "y", core: false, url: "/data/ring-y.json", count: 1, bbox: [0, 51, 1, 52] },
          ],
        });
      }
      if (path === "/data/ring-centre.json") return Response.json([row("centre", 1.5)]);
      if (path !== "/data/ring-x.json" && path !== "/data/ring-y.json") {
        throw new Error(`Unexpected shard: ${path}`);
      }
      neighbourRequests += 1;
      if (neighbourRequests === 2) neighboursStarted.resolve();
      return path === "/data/ring-x.json" ? responseX.promise : responseY.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const loader = createSlimShardLoader("london", { bypassInFlight: true });
    render(false, loader);
    await act(async () => lane.scheduleRingLoad(loader, centre));
    expect(lane.viewShardsLanding).toBe(false);
    expect(requests).toEqual(["/data/venues_slim.manifest.json", "/data/ring-centre.json"]);

    await act(async () => {
      idle.shift()?.();
      await neighboursStarted.promise;
    });
    if (alreadyFetched) await act(async () => responseX.resolve(Response.json([x])));
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).not.toContainEqual(x);

    await act(async () => lane.scheduleRingLoad(loader, visible));
    if (!alreadyFetched) {
      expect(lane.viewShardsLanding).toBe(true);
      await act(async () => responseX.resolve(Response.json([x])));
    }
    expect(lane.viewShardsLanding).toBe(false);
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).toContainEqual(x);
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).not.toContainEqual(y);
    expect(requests.filter((path) => path === "/data/ring-x.json")).toHaveLength(1);

    await act(async () => responseY.resolve(Response.json([y])));
    expect(mergeSlimVenues.mock.calls.flatMap(([rows]) => rows)).toContainEqual(y);
    expect(lane.viewShardsLanding).toBe(false);
  });
});
