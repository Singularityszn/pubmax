import type maplibregl from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import {
  createDonutClusterSync,
  readCounts,
  countsEqual,
} from "@/components/map/canvas/donutClusters";
import type { DonutCounts } from "@/lib/donutClusterGeometry";

// M5 donut clusters currently have ZERO tests. These cover the two pure helpers
// that back the module's correctness + perf contracts — the per-bucket count
// coercion and the SVG-rebuild change guard — plus the listener wiring/teardown
// lifecycle (the DOM-marker sync body itself is covered by the map E2E suite,
// matching this repo's "unit-test the pure surface, E2E the GL/DOM" split).

describe("readCounts (M5 donut — b0..b3 cluster-count coercion)", () => {
  it("maps b0..b3 into the DonutCounts tuple in order", () => {
    expect(readCounts({ b0: 1, b1: 2, b2: 3, b3: 4 })).toEqual([1, 2, 3, 4]);
  });

  it("coerces numeric-string props (supercluster can serialize counts as strings)", () => {
    expect(readCounts({ b0: "5", b1: "0", b2: "12", b3: "7" })).toEqual([5, 0, 12, 7]);
  });

  it("guards a missing prop down to 0", () => {
    expect(readCounts({ b0: 3 })).toEqual([3, 0, 0, 0]);
    expect(readCounts({})).toEqual([0, 0, 0, 0]);
  });

  it("guards non-finite / non-numeric props down to 0 (never NaN-poisons the geometry)", () => {
    expect(readCounts({ b0: NaN, b1: "abc", b2: undefined, b3: null })).toEqual([0, 0, 0, 0]);
  });

  it("treats null properties as an all-zero donut", () => {
    expect(readCounts(null)).toEqual([0, 0, 0, 0]);
  });
});

describe("countsEqual (M5 donut — SVG-rebuild change guard)", () => {
  const base: DonutCounts = [4, 2, 1, 3];

  it("is true for tuples with the same values, regardless of array identity", () => {
    expect(countsEqual(base, [4, 2, 1, 3])).toBe(true);
  });

  it("is false when any single bucket differs", () => {
    expect(countsEqual(base, [5, 2, 1, 3])).toBe(false);
    expect(countsEqual(base, [4, 0, 1, 3])).toBe(false);
    expect(countsEqual(base, [4, 2, 9, 3])).toBe(false);
    expect(countsEqual(base, [4, 2, 1, 0])).toBe(false);
  });
});

describe("createDonutClusterSync (M5 donut — listener lifecycle)", () => {
  function makeFakeMap() {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const on = vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
      const set = handlers.get(ev) ?? new Set<(...args: unknown[]) => void>();
      set.add(fn);
      handlers.set(ev, set);
    });
    const off = vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
      handlers.get(ev)?.delete(fn);
    });
    const map = {
      on,
      off,
      // sync() bails at its first guard when there's no pubs source/cluster layer,
      // so no DOM/marker path is exercised by invoking a handler here.
      getSource: () => undefined,
      getLayer: () => undefined,
      getZoom: () => 10,
      querySourceFeatures: () => [],
      setLayoutProperty: vi.fn(),
    };
    return { map, handlers };
  }

  it("registers the render / moveend / sourcedata / style.load listeners", () => {
    const { map } = makeFakeMap();
    createDonutClusterSync(map as unknown as maplibregl.Map, () => {});
    const events = map.on.mock.calls.map((call) => call[0]);
    expect(events).toEqual(
      expect.arrayContaining(["render", "moveend", "sourcedata", "style.load"]),
    );
  });

  it("destroy() detaches every registered listener", () => {
    const { map } = makeFakeMap();
    const sync = createDonutClusterSync(map as unknown as maplibregl.Map, () => {});
    sync.destroy();
    // One off() per on() — the module must not leak a listener on teardown.
    expect(map.off).toHaveBeenCalledTimes(map.on.mock.calls.length);
  });

  it("the sync (moveend) handler no-ops safely when there is no pubs source", () => {
    const { map, handlers } = makeFakeMap();
    createDonutClusterSync(map as unknown as maplibregl.Map, () => {});
    const [moveend] = [...(handlers.get("moveend") ?? [])];
    expect(() => moveend()).not.toThrow();
    // Guarded out before any layer toggle.
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });

  it("the style.load handler clears cleanly with no live markers", () => {
    const { map, handlers } = makeFakeMap();
    createDonutClusterSync(map as unknown as maplibregl.Map, () => {});
    const [onStyleLoad] = [...(handlers.get("style.load") ?? [])];
    expect(() => onStyleLoad()).not.toThrow();
  });

  it("stays active through the whole 13.x band and deactivates only at CLUSTER_MAX_ZOOM + 1", () => {
    // MapLibre serves cluster tiles while floor(zoom) <= clusterMaxZoom, so with
    // CLUSTER_MAX_ZOOM = 13 cluster features remain queryable through 13.x and
    // dissolve at 14 — donuts must not hand back to the plain GL disc early.
    const runSyncAtZoom = (zoom: number) => {
      const { map, handlers } = makeFakeMap();
      const querySourceFeatures = vi.fn(() => []);
      map.getSource = () => ({}) as never;
      map.getLayer = () => ({}) as never;
      map.getZoom = () => zoom;
      map.querySourceFeatures = querySourceFeatures;
      createDonutClusterSync(map as unknown as maplibregl.Map, () => {});
      const [moveend] = [...(handlers.get("moveend") ?? [])];
      moveend();
      return querySourceFeatures;
    };

    expect(runSyncAtZoom(13).mock.calls.length).toBe(1);
    expect(runSyncAtZoom(13.9).mock.calls.length).toBe(1);
    expect(runSyncAtZoom(14).mock.calls.length).toBe(0);
  });

  it("keeps mobile clusters in stable MapLibre layers instead of a render-synced DOM marker loop", () => {
    const { map } = makeFakeMap();
    // Regression: iOS Safari visibly flickers when source/render churn removes
    // and recreates the city-wide DOM donut markers. Mobile must leave the
    // always-present GL cluster + count layers as the only renderer.
    createDonutClusterSync(map as unknown as maplibregl.Map, () => {}, {
      enabled: false,
    });

    expect(map.on).not.toHaveBeenCalled();
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
  });
});
