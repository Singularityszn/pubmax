// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as maplibregl from "maplibre-gl";

import type { UkBasePub } from "@/lib/ukBasePubs";

const { viewportPubs } = vi.hoisted(() => ({ viewportPubs: { current: [] as UkBasePub[] } }));
vi.mock("@/lib/ukBasePubs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ukBasePubs")>()),
  createUkBaseLoader: () => ({
    pubsForBounds: async () => ({ status: "ready", pubs: viewportPubs.current }),
    find: () => null,
    restorePub: async () => null,
  }),
}));

import {
  invalidateUkBaseStreamToken,
  nextUkBaseStreamToken,
  parseUkBaseRestoreResponse,
  ukBaseStreamModeIsCurrent,
  useUkBaseStreaming,
  visibleUkBaseStreamState,
} from "@/components/map/pubmap/useUkBaseStreaming";

describe("nextUkBaseStreamToken", () => {
  it("invalidates an in-flight request before declining a below-gate stream", () => {
    const generation = { current: 4 };
    const inFlightToken = generation.current;

    expect(nextUkBaseStreamToken(generation, 10, 13)).toBeNull();
    expect(generation.current).toBe(5);
    expect(inFlightToken).not.toBe(generation.current);
  });

  it("invalidates an active viewport read as soon as another camera settle is queued", () => {
    const generation = { current: 0 };
    const activeToken = nextUkBaseStreamToken(generation, 12, 12);

    invalidateUkBaseStreamToken(generation);

    expect(activeToken).toBe(1);
    expect(generation.current).toBe(2);
    expect(activeToken).not.toBe(generation.current);
  });
});

describe("visibleUkBaseStreamState", () => {
  const published = {
    scopeKey: "london",
    status: "ready" as const,
    count: 2,
    pubs: [],
  };

  it("reports loading with no old rows while a new city scope takes over", () => {
    expect(visibleUkBaseStreamState(published, "manchester", false)).toEqual({
      status: "loading",
      count: 0,
      pubs: [],
    });
  });

  it("returns one stable empty state while a drink lens suspends base pubs", () => {
    const first = visibleUkBaseStreamState(published, "london", true);
    const second = visibleUkBaseStreamState(published, "london", true);

    expect(first).toBe(second);
    expect(first).toEqual({ status: "suspended", count: 0, pubs: [] });
  });
});

describe("ukBaseStreamModeIsCurrent", () => {
  it("drops a deferred read after scope or suspension changes", async () => {
    const current = { scopeKey: "london", suspended: false };
    const requested = { ...current };
    let settle: (() => void) | undefined;
    const deferred = new Promise<void>((resolve) => {
      settle = resolve;
    }).then(() => ukBaseStreamModeIsCurrent(current, requested));

    current.scopeKey = "manchester";
    settle?.();
    await expect(deferred).resolves.toBe(false);

    current.scopeKey = "london";
    current.suspended = true;
    expect(ukBaseStreamModeIsCurrent(current, requested)).toBe(false);
  });
});

describe("parseUkBaseRestoreResponse (streaming module export)", () => {
  it("is exported for cold-restore wiring tests", () => {
    expect(
      parseUkBaseRestoreResponse(
        {
          pub: {
            id: "venue-uk-n9",
            name: "The Test",
            address: "",
            lat: 51.5,
            lng: -0.1,
            curatedVenueId: "",
          },
        },
        "venue-uk-n9",
      )?.name,
    ).toBe("The Test");
  });
});

describe("useUkBaseStreaming source updates", () => {
  const basePub = (id: string, curatedVenueId = ""): UkBasePub => ({
    id, name: id, address: "", lat: 51.5, lng: -0.1, curatedVenueId, kind: "pub",
  });
  const setData = vi.fn<(data: GeoJSON.FeatureCollection) => void>();
  const source = { setData };
  const map = {
    getZoom: () => 14,
    getBounds: () => ({ getWest: () => -0.2, getSouth: () => 51.4, getEast: () => 0, getNorth: () => 51.6 }),
    on: () => undefined,
    off: () => undefined,
    project: () => ({ x: 10, y: 10 }),
    getContainer: () => ({ clientWidth: 390, clientHeight: 844 }),
    getSource: (id: string) => (id === "uk-base" ? source : undefined),
  } as unknown as maplibregl.Map;
  const mapRef = { current: map };
  const applyToMap = (_key: string, fn: (map: maplibregl.Map) => void) => fn(map);
  const dataRef = { current: { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection };
  const overviewRef = { current: { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection };

  function Harness({ drawableVenueIds }: { drawableVenueIds: ReadonlySet<string> }) {
    useUkBaseStreaming({ mapRef, mapReady: true, applyToMap, ukBaseDataRef: dataRef, ukBaseOverviewDataRef: overviewRef, drawableVenueIds, scopeKey: "london" });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setData.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("re-sends the base layer only when a curated shard changes which base pubs it draws", async () => {
    viewportPubs.current = [basePub("venue-uk-n1"), basePub("venue-uk-n2", "venue-priced")];
    const root = createRoot(document.createElement("div"));
    const render = async (ids: string[]) => {
      await act(async () => root.render(createElement(Harness, { drawableVenueIds: new Set(ids) })));
      await act(async () => vi.advanceTimersByTimeAsync(400));
    };
    const drawn = () => (setData.mock.lastCall?.[0].features ?? []).map((feature) => feature.properties?.id);

    await render(["venue-a"]);
    const settled = setData.mock.calls.length;
    expect(drawn()).toEqual(["venue-uk-n1", "venue-uk-n2"]);

    await render(["venue-a", "venue-b"]);
    await render(["venue-a", "venue-b", "venue-c"]);
    expect(setData.mock.calls.length).toBe(settled);

    // The priced venue lands: its unpriced base twin leaves, so the recorded
    // price is never drawn under an unpriced pin.
    await render(["venue-a", "venue-b", "venue-c", "venue-priced"]);
    expect(setData.mock.calls.length).toBe(settled + 1);
    expect(drawn()).toEqual(["venue-uk-n1"]);
    act(() => root.unmount());
  });
});
