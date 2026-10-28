import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: async (key: string) => idb.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      idb.set(key, value);
      return true;
    },
  },
}));

import {
  createMapResumeWriter,
  isCurrentMapResumeRefresh,
  isPersistableMapResumeViewport,
  readMapResume,
  readMapResumeSync,
  clearMapResumeCamera,
  scheduleMapResumeWrite,
} from "@/lib/mapResume";
import { offlineCache } from "@/lib/offlineCache";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";
import type { Venue } from "@/lib/venues";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const value = {
  cityId: "london" as const,
  viewport: { center: [-0.12, 51.52] as [number, number], zoom: 15, pitch: 38, bearing: -8 },
  rows: [{ id: "venue-1", name: "Test pub", lat: 51.52, lng: -0.12, borough: "Camden", cheapestPrice: 5 }],
};

function cameraFor(viewport: typeof value.viewport) {
  const owner = createMapCameraOwnership();
  owner.beginPublicPlace(viewport.center);
  owner.settle(viewport);
  return owner.capture(viewport)!;
}

// A resident pin whose name read is counted, so a test sees each compaction.
function countedPin(reads: { count: number }): Venue {
  const pin = { id: "venue-1", latitude: 51.52, longitude: -0.12, primaryBorough: "Camden", cheapestPrice: 5 };
  Object.defineProperty(pin, "name", {
    enumerable: true,
    get: () => {
      reads.count += 1;
      return "Test pub";
    },
  });
  return pin as unknown as Venue;
}

describe("map resume", () => {
  beforeEach(async () => {
    await readMapResume("london", 1_000);
    idb.clear();
  });

  it("considers a camera only once the opening and camera settle", () => {
    expect(isPersistableMapResumeViewport(false, false)).toBe(false);
    expect(isPersistableMapResumeViewport(true, false)).toBe(false);
    expect(isPersistableMapResumeViewport(false, true)).toBe(false);
    expect(isPersistableMapResumeViewport(true, true)).toBe(true);
  });

  it("mirrors a valid snapshot for synchronous warm paint", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, cameraFor(value.viewport));
    expect(readMapResumeSync("london", 1_000, store)).toEqual({ ...value, cameraProvenance: { version: 1, source: "public-place" }, version: 2, savedAt: 1_000 });
  });

  it("ignores malformed synchronous snapshots", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, cameraFor(value.viewport));
    store.setItem("map-resume:v2:london:rows", "broken");
    expect(readMapResumeSync("london", 1_000, store)).toBeNull();
  });

  it("reuses fresh rows even when their camera record is absent", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, cameraFor(value.viewport));
    const view = store.getItem("map-resume:v2:london:view");
    store.removeItem("map-resume:v2:london:view");
    expect(readMapResumeSync("london", 1_000, store)).toMatchObject({ viewport: null, rows: value.rows });
    store.setItem("map-resume:v2:london:view", view ?? "");
    expect(readMapResumeSync("london", 1_000 + 15 * 24 * 60 * 60 * 1000, store)).toBeNull();
  });

  it("allows resume refresh after unavailable live loading", () => {
    expect(isCurrentMapResumeRefresh("pending", false, 4, 4)).toBe(true);
    expect(isCurrentMapResumeRefresh("unavailable", false, 4, 4)).toBe(true);
    expect(isCurrentMapResumeRefresh("unavailable", true, 4, 4)).toBe(false);
    expect(isCurrentMapResumeRefresh("ready", true, 4, 4)).toBe(false);
    expect(isCurrentMapResumeRefresh("pending", false, 5, 4)).toBe(false);
  });

  it("writes the rows once per pins array and only the camera on a move", () => {
    const store = storage();
    const setItem = vi.spyOn(store, "setItem");
    const reads = { count: 0 };
    const pins = [countedPin(reads)];
    const write = createMapResumeWriter(store);

    expect(write("london", value.viewport, pins, 1_000, cameraFor(value.viewport))).toBe(true);
    expect(write("london", value.viewport, pins, 2_000, cameraFor(value.viewport))).toBe(false);
    const moved = { ...value.viewport, zoom: 16 };
    expect(write("london", moved, pins, 3_000, cameraFor(moved))).toBe(true);

    expect(reads.count).toBe(1);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([
      "map-resume:v2:london:rows",
      "map-resume:v2:london:view",
      "map-resume:v2:london:view",
    ]);
    expect(readMapResumeSync("london", 3_000, store)).toEqual({
      ...value,
      viewport: moved,
      cameraProvenance: { version: 1, source: "public-place" },
      version: 2,
      savedAt: 3_000,
    });
  });

  it("writes the rows again when the resident pins change", () => {
    const store = storage();
    const setItem = vi.spyOn(store, "setItem");
    const reads = { count: 0 };
    const write = createMapResumeWriter(store);
    write("london", value.viewport, [countedPin(reads)], 1_000, cameraFor(value.viewport));
    expect(write("london", value.viewport, [countedPin(reads)], 2_000, cameraFor(value.viewport))).toBe(true);
    expect(reads.count).toBe(2);
    expect(setItem).toHaveBeenCalledTimes(4);
    expect(readMapResumeSync("london", 2_000, store)?.savedAt).toBe(2_000);
  });

  it("drops the one-record v1 snapshot it replaces", async () => {
    const store = storage();
    store.setItem("map-resume:v1:london", JSON.stringify({ ...value, version: 1, savedAt: 500 }));
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, cameraFor(value.viewport));
    expect(store.getItem("map-resume:v1:london")).toBeNull();
    await vi.waitFor(() => expect(idb.get("map-resume:v1:london")).toBeNull());
  });

  it("stores IndexedDB as the same text and reads it back", async () => {
    createMapResumeWriter(storage())("london", value.viewport, [countedPin({ count: 0 })], 1_000, cameraFor(value.viewport));
    await vi.waitFor(() => expect(typeof idb.get("map-resume:v2:london:view")).toBe("string"));
    expect(typeof idb.get("map-resume:v2:london:rows")).toBe("string");
    expect(await readMapResume("london", 1_000)).toEqual({ ...value, cameraProvenance: { version: 1, source: "public-place" }, version: 2, savedAt: 1_000 });
  });

  it("waits for idle time, and cancels a write the next move replaces", () => {
    const idle: Array<() => void> = [];
    const cancelIdleCallback = vi.fn();
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idle.push(() => callback({ didTimeout: false, timeRemaining: () => 50 }));
      return idle.length;
    });
    const timing = { requestIdleCallback, cancelIdleCallback, setTimeout: vi.fn(), clearTimeout: vi.fn() };
    const write = vi.fn();

    const cancel = scheduleMapResumeWrite(write, timing);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });
    expect(write).not.toHaveBeenCalled();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(1);
    idle[0]?.();
    expect(write).not.toHaveBeenCalled();
    expect(timing.setTimeout).not.toHaveBeenCalled();
  });

  it("falls back to a short timer without requestIdleCallback", () => {
    const timing = { setTimeout: vi.fn(() => 7), clearTimeout: vi.fn() };
    const write = vi.fn();
    scheduleMapResumeWrite(write, timing)();
    expect(timing.setTimeout).toHaveBeenCalledWith(expect.any(Function), 250);
    expect(timing.clearTimeout).toHaveBeenCalledWith(7);
  });
});

describe("camera privacy in resume storage", () => {
  beforeEach(async () => {
    await readMapResume("london", 1_000);
    idb.clear();
  });

  it("keeps legacy venue rows while erasing an unmarked synchronous camera", () => {
    const store = storage();
    store.setItem("map-resume:v2:london:view", JSON.stringify({
      version: 2, cityId: "london", savedAt: 1_000, viewport: value.viewport,
    }));
    const rows = JSON.stringify({ version: 2, cityId: "london", savedAt: 1_000, rows: value.rows });
    store.setItem("map-resume:v2:london:rows", rows);
    expect(readMapResumeSync("london", 1_000, store)).toMatchObject({ viewport: null, rows: value.rows });
    expect(store.getItem("map-resume:v2:london:view")).toBeNull();
    expect(store.getItem("map-resume:v2:london:rows")).toBe(rows);
  });

  it("keeps legacy venue rows while rejecting an unmarked asynchronous camera", async () => {
    idb.set("map-resume:v2:london:view", JSON.stringify({
      version: 2, cityId: "london", savedAt: 1_000, viewport: value.viewport,
    }));
    idb.set("map-resume:v2:london:rows", JSON.stringify({
      version: 2, cityId: "london", savedAt: 1_000, rows: value.rows,
    }));
    expect(await readMapResume("london", 1_000)).toMatchObject({ viewport: null, rows: value.rows });
    await vi.waitFor(() => expect(idb.get("map-resume:v2:london:view")).toBeNull());
    expect(idb.get("map-resume:v2:london:rows")).toContain('"venue-1"');
  });

  it("retains rows without persisting an automatic location camera", async () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    expect(store.getItem("map-resume:v2:london:view")).toBeNull();
    expect(readMapResumeSync("london", 1_000, store)).toMatchObject({ viewport: null, rows: value.rows });
    await vi.waitFor(() => expect(idb.get("map-resume:v2:london:rows")).toContain('"venue-1"'));
    expect(idb.get("map-resume:v2:london:view")).toBeNull();
  });

  it("rechecks ownership before a queued asynchronous camera write", async () => {
    const store = storage();
    const owner = createMapCameraOwnership();
    owner.beginPublicPlace(value.viewport.center);
    owner.settle(value.viewport);
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, owner.capture(value.viewport));
    owner.invalidate();
    await vi.waitFor(() => expect(idb.get("map-resume:v2:london:view")).toBeNull());
  });
  it("erases a camera whose asynchronous write finishes after location revokes it", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const set = vi.spyOn(offlineCache, "set").mockImplementation(async (key, payload) => {
      if (key === "map-resume:v2:london:view" && payload !== null) {
        started = true;
        await pending;
      }
      idb.set(key, payload);
      return true;
    });
    try {
      const owner = createMapCameraOwnership();
      owner.beginPublicPlace(value.viewport.center);
      owner.settle(value.viewport);
      const store = storage();
      createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000, owner.capture(value.viewport));
      await vi.waitFor(() => expect(started).toBe(true));
      owner.invalidate();
      clearMapResumeCamera("london", store);
      release();
      await vi.waitFor(() => expect(idb.get("map-resume:v2:london:view")).toBeNull());
      expect(store.getItem("map-resume:v2:london:view")).toBeNull();
    } finally {
      release();
      set.mockRestore();
    }
  });

});
