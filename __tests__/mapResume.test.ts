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
  scheduleMapResumeWrite,
} from "@/lib/mapResume";
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
  beforeEach(() => idb.clear());

  it("persists the viewport only once location and camera settle", () => {
    expect(isPersistableMapResumeViewport(false, false)).toBe(false);
    expect(isPersistableMapResumeViewport(true, false)).toBe(false);
    expect(isPersistableMapResumeViewport(false, true)).toBe(false);
    expect(isPersistableMapResumeViewport(true, true)).toBe(true);
  });

  it("mirrors a valid snapshot for synchronous warm paint", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    expect(readMapResumeSync("london", 1_000, store)).toEqual({ ...value, version: 2, savedAt: 1_000 });
  });

  it("ignores malformed synchronous snapshots", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    store.setItem("map-resume:v2:london:rows", "broken");
    expect(readMapResumeSync("london", 1_000, store)).toBeNull();
  });

  it("needs both records, each inside the age limit", () => {
    const store = storage();
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    const view = store.getItem("map-resume:v2:london:view");
    store.removeItem("map-resume:v2:london:view");
    expect(readMapResumeSync("london", 1_000, store)).toBeNull();
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

    expect(write("london", value.viewport, pins, 1_000)).toBe(true);
    expect(write("london", value.viewport, pins, 2_000)).toBe(false);
    const moved = { ...value.viewport, zoom: 16 };
    expect(write("london", moved, pins, 3_000)).toBe(true);

    expect(reads.count).toBe(1);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([
      "map-resume:v2:london:rows",
      "map-resume:v2:london:view",
      "map-resume:v2:london:view",
    ]);
    expect(readMapResumeSync("london", 3_000, store)).toEqual({
      ...value,
      viewport: moved,
      version: 2,
      savedAt: 3_000,
    });
  });

  it("writes the rows again when the resident pins change", () => {
    const store = storage();
    const setItem = vi.spyOn(store, "setItem");
    const reads = { count: 0 };
    const write = createMapResumeWriter(store);
    write("london", value.viewport, [countedPin(reads)], 1_000);
    expect(write("london", value.viewport, [countedPin(reads)], 2_000)).toBe(true);
    expect(reads.count).toBe(2);
    expect(setItem).toHaveBeenCalledTimes(4);
    expect(readMapResumeSync("london", 2_000, store)?.savedAt).toBe(2_000);
  });

  it("drops the one-record v1 snapshot it replaces", () => {
    const store = storage();
    store.setItem("map-resume:v1:london", JSON.stringify({ ...value, version: 1, savedAt: 500 }));
    createMapResumeWriter(store)("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    expect(store.getItem("map-resume:v1:london")).toBeNull();
    expect(idb.get("map-resume:v1:london")).toBeNull();
  });

  it("stores IndexedDB as the same text and reads it back", async () => {
    createMapResumeWriter(storage())("london", value.viewport, [countedPin({ count: 0 })], 1_000);
    expect(typeof idb.get("map-resume:v2:london:view")).toBe("string");
    expect(typeof idb.get("map-resume:v2:london:rows")).toBe("string");
    expect(await readMapResume("london", 1_000)).toEqual({ ...value, version: 2, savedAt: 1_000 });
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
    expect(write).toHaveBeenCalledTimes(1);
    expect(timing.setTimeout).not.toHaveBeenCalled();
  });

  it("falls back to a short timer without requestIdleCallback", () => {
    const timing = { setTimeout: vi.fn(() => 7), clearTimeout: vi.fn() };
    const write = vi.fn();
    scheduleMapResumeWrite(write, timing)();
    expect(timing.setTimeout).toHaveBeenCalledWith(write, 250);
    expect(timing.clearTimeout).toHaveBeenCalledWith(7);
  });
});
