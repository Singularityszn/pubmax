// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaderFactory = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/ukBasePubs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBasePubs")>();
  return { ...actual, createUkBaseLoader: loaderFactory.create };
});

import { useUkBaseStreaming } from "@/components/map/pubmap/useUkBaseStreaming";
import type { UkBaseLoader, UkBasePub } from "@/lib/ukBasePubs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type HookOptions = Parameters<typeof useUkBaseStreaming>[0];
type StreamRead = Awaited<ReturnType<UkBaseLoader["pubsForBounds"]>>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function loaderWithReads(reads: Promise<StreamRead>[]): UkBaseLoader {
  const pubsForBounds = vi.fn(() =>
    reads.shift() ??
      Promise.resolve({ status: "ready", pubs: [] } satisfies StreamRead),
  );
  return {
    pubsForBounds,
    find: () => null,
    restorePub: async () => null,
  };
}

function basePub(id: string, kind: UkBasePub["kind"]): UkBasePub {
  return {
    id,
    name: id,
    address: "",
    lat: 51.5,
    lng: -0.1,
    curatedVenueId: "",
    kind,
  };
}

function createMapHarness() {
  const listeners = new Map<string, Set<() => void>>();
  let sourceData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  const source = {
    setData(data: GeoJSON.FeatureCollection) {
      sourceData = data;
    },
  };
  const bounds = {
    getWest: () => -0.2,
    getSouth: () => 51.4,
    getEast: () => 0.1,
    getNorth: () => 51.6,
  };
  const map = {
    getZoom: () => 14,
    getBounds: () => bounds,
    getSource: () => source,
    on(event: string, listener: () => void) {
      const callbacks = listeners.get(event) ?? new Set<() => void>();
      callbacks.add(listener);
      listeners.set(event, callbacks);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as NonNullable<HookOptions["mapRef"]["current"]>;
  const options: HookOptions = {
    mapRef: { current: map },
    mapReady: true,
    applyToMap: (_key, apply) => apply(map),
    ukBaseDataRef: {
      current: { type: "FeatureCollection", features: [] },
    },
    drawableVenueIds: new Set(),
    venueKindVisibility: { pub: true, bar: true, food: true, restaurant: true },
    scopeKey: "london",
  };

  return {
    options,
    sourceIds: () => sourceData.features.map((feature) => feature.properties?.id),
    fire(event: "moveend" | "zoomend") {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let latestState: ReturnType<typeof useUkBaseStreaming>;

function HookHarness({ options }: { options: HookOptions }) {
  const state = useUkBaseStreaming(options);
  useLayoutEffect(() => {
    latestState = state;
  }, [state]);
  return null;
}

async function renderHook(options: HookOptions): Promise<void> {
  await act(async () => {
    root.render(createElement(HookHarness, { options }));
  });
}

async function flushTimers(): Promise<void> {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

async function resolveRead(read: Deferred<StreamRead>, value: StreamRead): Promise<void> {
  await act(async () => {
    read.resolve(value);
    await read.promise;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  loaderFactory.create.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useUkBaseStreaming kind changes during viewport reads", () => {
  it("applies latest kind visibility when a pending read settles without rereading", async () => {
    const read = deferred<StreamRead>();
    const loader = loaderWithReads([read.promise]);
    loaderFactory.create.mockReturnValue(loader);
    const map = createMapHarness();
    const pub = basePub("venue-uk-n1", "pub");
    const bar = basePub("venue-uk-w2", "bar");

    await renderHook(map.options);
    await flushTimers();
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(1);

    await renderHook({
      ...map.options,
      venueKindVisibility: { ...map.options.venueKindVisibility, bar: false },
    });
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(1);

    await resolveRead(read, { status: "ready", pubs: [pub, bar] });

    expect(latestState).toEqual({ status: "ready", count: 1, pubs: [pub] });
    expect(map.sourceIds()).toEqual([pub.id]);
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(1);
  });

  it("clears old-city rows on a concurrent kind change and ignores its late read", async () => {
    const initialRead = deferred<StreamRead>();
    const staleRead = deferred<StreamRead>();
    const currentRead = deferred<StreamRead>();
    const loader = loaderWithReads([
      initialRead.promise,
      staleRead.promise,
      currentRead.promise,
    ]);
    loaderFactory.create.mockReturnValue(loader);
    const map = createMapHarness();
    const londonPub = basePub("venue-uk-n1", "pub");
    const londonBar = basePub("venue-uk-w2", "bar");
    const manchesterPub = basePub("venue-uk-n3", "pub");
    const manchesterBar = basePub("venue-uk-w4", "bar");

    await renderHook(map.options);
    await flushTimers();
    await resolveRead(initialRead, {
      status: "ready",
      pubs: [londonPub, londonBar],
    });
    expect(map.sourceIds()).toEqual([londonPub.id, londonBar.id]);

    await act(async () => map.fire("moveend"));
    await flushTimers();
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(2);

    await renderHook({
      ...map.options,
      scopeKey: "manchester",
      venueKindVisibility: { ...map.options.venueKindVisibility, bar: false },
    });
    expect(latestState).toEqual({ status: "loading", count: 0, pubs: [] });
    expect(map.sourceIds()).toEqual([]);

    await flushTimers();
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(3);
    await resolveRead(currentRead, {
      status: "ready",
      pubs: [manchesterPub, manchesterBar],
    });
    expect(latestState).toEqual({
      status: "ready",
      count: 1,
      pubs: [manchesterPub],
    });
    expect(map.sourceIds()).toEqual([manchesterPub.id]);

    await resolveRead(staleRead, {
      status: "ready",
      pubs: [londonPub, londonBar],
    });
    expect(latestState).toEqual({
      status: "ready",
      count: 1,
      pubs: [manchesterPub],
    });
    expect(map.sourceIds()).toEqual([manchesterPub.id]);
    expect(loader.pubsForBounds).toHaveBeenCalledTimes(3);
  });
});
