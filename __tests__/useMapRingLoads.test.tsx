// @vitest-environment jsdom
import { act, createElement, createRef, useEffect, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapRingLoads } from "@/components/map/pubmap/useMapRingLoads";
import type { CityId } from "@/lib/cities";
import type { MapBounds, SlimShardLoader } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";

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
function publish(next: Lane) {
  lane = next;
}

function Probe({ held, loader }: { held: boolean; loader: SlimShardLoader }) {
  const current = useMapRingLoads({
    secondaryStreamsHeld: held,
    refs: refs(loader),
    mergeSlimVenues: () => undefined,
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
    ringLoadPendingKeyRef: ref<string | null>(null),
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
  vi.stubGlobal("requestIdleCallback", undefined);
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
