// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  latchMapReaderLocationWatch,
  MAP_READER_LOCATION_LATCH_EVENT,
  mapReaderPositionFromGeolocation,
  mapReaderPositionGeoJSON,
} from "@/lib/mapReaderPosition";
import type { MapReaderPosition } from "@/lib/mapReaderPosition";
import { attachMapReaderPositionWatch } from "@/lib/mapReaderPositionWatch";
import { syncReaderPositionOnMap } from "@/components/map/canvas/readerPositionProbe";


describe("mapReaderPositionGeoJSON", () => {
  it("carries accuracy and latitude on the feature for the accuracy ring", () => {
    const collection = mapReaderPositionGeoJSON({
      lat: 51.5,
      lng: -0.12,
      accuracyMeters: 42,
    });
    expect(collection.features).toHaveLength(1);
    const props = collection.features[0]?.properties as Record<string, number>;
    expect(props.accuracyMeters).toBe(42);
    expect(props.lat).toBe(51.5);
    expect(collection.features[0]?.geometry).toEqual({
      type: "Point",
      coordinates: [-0.12, 51.5],
    });
  });
});

describe("attachMapReaderPositionWatch", () => {
  let watchSuccess: PositionCallback | null = null;

  beforeEach(() => {
    watchSuccess = null;
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback) => {
        watchSuccess = success;
        return 1;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    Object.defineProperty(globalThis.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({
          state: "prompt",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates on each watch callback and never touches the map camera", () => {
    const updates: Array<MapReaderPosition | null> = [];
    const detach = attachMapReaderPositionWatch((position) => {
      updates.push(position);
    });

    latchMapReaderLocationWatch();
    expect(navigator.geolocation.watchPosition).toHaveBeenCalled();

    watchSuccess?.({
      coords: {
        latitude: 51.51,
        longitude: -0.11,
        accuracy: 18,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);

    watchSuccess?.({
      coords: {
        latitude: 51.52,
        longitude: -0.1,
        accuracy: 30,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    } as GeolocationPosition);

    expect(updates.at(-1)).toEqual({
      lat: 51.52,
      lng: -0.1,
      accuracyMeters: 30,
    });

    detach();

    const canvasSrc = readFileSync(
      join(process.cwd(), "components/PubMapCanvas.tsx"),
      "utf8",
    );
    const start = canvasSrc.indexOf("// The reader's dot is a CANVAS layer");
    const readerBlock = canvasSrc.slice(
      start,
      canvasSrc.indexOf("// Frame the crawl only when", start),
    );
    expect(readerBlock).toContain('syncReaderPositionOnMap');
    expect(readerBlock).not.toMatch(/\b(flyTo|easeTo|jumpTo|fitBounds|setCenter)\s*\(/);
  });

  it("starts watch when permission is already granted", async () => {
    vi.mocked(navigator.permissions!.query).mockResolvedValueOnce({
      state: "granted",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as PermissionStatus);

    attachMapReaderPositionWatch(() => {});
    await Promise.resolve();
    expect(navigator.geolocation.watchPosition).toHaveBeenCalled();
  });
});

describe("mapReaderPositionFromGeolocation", () => {
  it("rejects invalid coordinates", () => {
    expect(
      mapReaderPositionFromGeolocation({
        coords: {
          latitude: Number.NaN,
          longitude: 0,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: 0,
      } as GeolocationPosition),
    ).toBeNull();
  });
});

describe("map reader position latch", () => {
  it("dispatches the latch event the watcher listens for", () => {
    const handler = vi.fn();
    window.addEventListener(MAP_READER_LOCATION_LATCH_EVENT, handler);
    latchMapReaderLocationWatch();
    window.removeEventListener(MAP_READER_LOCATION_LATCH_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("syncReaderPositionOnMap", () => {
  it("updates the GeoJSON source and never moves the camera", () => {
    const setData = vi.fn();
    const flyTo = vi.fn();
    const easeTo = vi.fn();
    const jumpTo = vi.fn();
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    const map = {
      getSource: () => ({ setData }),
      flyTo,
      easeTo,
      jumpTo,
      fitBounds,
      setCenter,
    } as unknown as maplibregl.Map;

    const data = mapReaderPositionGeoJSON({
      lat: 51.5,
      lng: -0.12,
      accuracyMeters: 20,
    });
    syncReaderPositionOnMap(map, data);
    expect(setData).toHaveBeenCalledWith(data);
    expect(flyTo).not.toHaveBeenCalled();
    expect(easeTo).not.toHaveBeenCalled();
    expect(jumpTo).not.toHaveBeenCalled();
    expect(fitBounds).not.toHaveBeenCalled();
    expect(setCenter).not.toHaveBeenCalled();
  });
});

