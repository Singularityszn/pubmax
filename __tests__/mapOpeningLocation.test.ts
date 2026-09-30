import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import {
  MAP_OPENING_LOCATION_MAX_AGE_MS,
  readOpeningMapLocation,
  readMapOpeningLocation,
  readMapLocationPermission,
  resolveMapOpeningLocation,
  resolveMapOpeningView,
  writeMapOpeningLocation,
} from "@/lib/mapOpeningLocation";
import { CITIES } from "@/lib/cities";

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

describe("map opening location", () => {
  it("ordinary opening effect cancels a pending permission read on owner disposal", async () => {
    const source = ts.createSourceFile("PubMap.tsx", readFileSync(
      join(process.cwd(), "components/PubMap.tsx"), "utf8",
    ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: ts.ArrowFunction | undefined;
    const findEffect = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" &&
        ts.isArrowFunction(node.arguments[0]) && node.arguments[0].body.getText(source).includes("readOpeningMapLocation(")) {
        callback = node.arguments[0];
      }
      ts.forEachChild(node, findEffect);
    };
    findEffect(source);
    expect(callback, "Actual opening-location effect not found").toBeDefined();
    let grant!: (value: PermissionStatus) => void;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const reads: Array<Promise<unknown>> = [];
    const latchWatch = vi.fn();
    const writeLocation = vi.fn();
    const scope = {
      shouldResolveOpeningLocation: true,
      readOpeningMapLocation: (_environment: unknown, options: Parameters<typeof readOpeningMapLocation>[1]) => {
        const pending = readOpeningMapLocation({
          permissions: { query: vi.fn(() => new Promise<PermissionStatus>((resolve) => { grant = resolve; })) },
          geolocation: { getCurrentPosition },
        }, options);
        reads.push(pending);
        return pending;
      },
      setOpeningLocationPromptActive: vi.fn(),
      openingLocationCancelledRef: { current: false },
      pointInCityBounds: vi.fn(() => true),
      city: {},
      setGrantedOpeningLocation: vi.fn(),
      latchMapReaderLocationWatch: latchWatch,
      writeMapOpeningLocation: writeLocation,
      setOpeningLocationResolved: vi.fn(),
    };
    const effect = new Function(...Object.keys(scope), `return (${callback!.getText(source)});`)(...Object.values(scope));
    const cleanup = effect();
    cleanup();
    grant({ state: "granted" } as PermissionStatus);
    await Promise.all(reads);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(latchWatch).not.toHaveBeenCalled();
    expect(writeLocation).not.toHaveBeenCalled();
  });

  it.each(["granted", "denied", "prompt"] as const)("reads a %s browser permission", async (state) => {
    const query = vi.fn(async () => ({ state } as PermissionStatus));
    expect(await readMapLocationPermission({ permissions: { query } })).toBe(state);
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
  });

  it("refuses unknown permission states without requesting coordinates", async () => {
    expect(await readMapLocationPermission(null)).toBeNull();
    expect(await readMapLocationPermission({})).toBeNull();
    expect(await readMapLocationPermission({
      permissions: { query: vi.fn(async () => { throw new Error("unsupported"); }) },
    })).toBeNull();
    expect(await readMapLocationPermission({
      permissions: { query: vi.fn(async () => ({ state: "unknown" } as unknown as PermissionStatus)) },
    })).toBeNull();
  });

  it("uses city zoom until a reader location owns the opening view", () => {
    const cityView = CITIES.london.mapView;

    expect(resolveMapOpeningView(cityView, null, 15)).toEqual(cityView);
    expect(resolveMapOpeningView(cityView, null, 15).zoom).toBe(12);
    expect(
      resolveMapOpeningView(
        cityView,
        { lat: 51.51, lng: -0.09 },
        15,
      ),
    ).toEqual({
      ...cityView,
      center: [-0.09, 51.51],
      zoom: 15,
    });
  });

  it("uses last-known location before the city default", () => {
    expect(resolveMapOpeningLocation(
      { lat: 51.51, lng: -0.09 },
      { lat: 51.52, lng: -0.12 },
    )).toEqual({ lat: 51.51, lng: -0.09 });
    expect(resolveMapOpeningLocation(null, { lat: 51.52, lng: -0.12 }))
      .toEqual({ lat: 51.52, lng: -0.12 });
  });

  it("rejects malformed storage and writes valid coordinates", () => {
    const store = storage();
    store.setItem("pubmax:map-opening-location:v1", "{bad");
    expect(readMapOpeningLocation(store)).toBeNull();
    expect(store.getItem("pubmax:map-opening-location:v1")).toBeNull();

    writeMapOpeningLocation({ lat: 51.5, lng: -0.1 }, store);
    expect(readMapOpeningLocation(store)).toEqual({ lat: 51.5, lng: -0.1 });

    store.setItem("pubmax:map-opening-location:v1", JSON.stringify({ lat: 99, lng: 0 }));
    expect(readMapOpeningLocation(store)).toBeNull();
    expect(store.getItem("pubmax:map-opening-location:v1")).toBeNull();
  });

  it("uses a recent remembered fix without exposing its storage timestamp", () => {
    const store = storage();
    const now = 1_000_000_000;
    writeMapOpeningLocation({ lat: 51.5, lng: -0.1 }, store, now);
    expect(readMapOpeningLocation(store, now + MAP_OPENING_LOCATION_MAX_AGE_MS - 1))
      .toEqual({ lat: 51.5, lng: -0.1 });
  });

  it.each([
    ["expired", (now: number) => now - MAP_OPENING_LOCATION_MAX_AGE_MS],
    ["future", (now: number) => now + 1],
    ["negative timestamp", () => -1],
    ["undated", () => undefined],
    ["malformed timestamp", () => "yesterday"],
  ] as const)("removes a %s remembered fix", (_name, savedAt) => {
    const store = storage();
    const now = 1_000_000_000;
    store.setItem("pubmax:map-opening-location:v1", JSON.stringify({
      lat: 51.5,
      lng: -0.1,
      savedAt: savedAt(now),
    }));
    expect(readMapOpeningLocation(store, now)).toBeNull();
    expect(store.getItem("pubmax:map-opening-location:v1")).toBeNull();
  });

  it("abandons a disposed map while its permission query waits", async () => {
    const owner = new AbortController();
    let grant!: (value: PermissionStatus) => void;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const pending = readOpeningMapLocation({
      permissions: { query: vi.fn(() => new Promise<PermissionStatus>((resolve) => { grant = resolve; })) },
      geolocation: { getCurrentPosition },
    }, { signal: owner.signal });
    owner.abort();
    grant({ state: "granted" } as PermissionStatus);
    expect(await pending).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("discards a disposed map's delayed native fix before caller side effects", async () => {
    const owner = new AbortController();
    let deliver!: PositionCallback;
    const started = new Promise<void>((resolve) => {
      deliver = () => { resolve(); };
    });
    let success!: PositionCallback;
    const pending = readOpeningMapLocation({
      permissions: { query: vi.fn(async () => ({ state: "granted" } as PermissionStatus)) },
      geolocation: { getCurrentPosition: vi.fn((callback: PositionCallback) => {
        success = callback;
        deliver({} as GeolocationPosition);
      }) },
    }, { signal: owner.signal });
    await started;
    owner.abort();
    success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    expect(await pending).toBeNull();
  });

  it("reads current coordinates when permission is granted", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => ({ state: "granted" } as PermissionStatus)),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toEqual({ lat: 51.5, lng: -0.1 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("returns immediately after showing an ungranted permission prompt", async () => {
    const getCurrentPosition = vi.fn();
    getCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const onPermissionPrompt = vi.fn();
    const location = await readOpeningMapLocation(
      {
        permissions: {
          query: vi.fn(async () => ({ state: "prompt" } as PermissionStatus)),
        },
        geolocation: { getCurrentPosition },
      },
      { onPermissionPrompt },
    );

    expect(location).toBeNull();
    expect(onPermissionPrompt).toHaveBeenCalledOnce();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("waits for an explicit tap when Permissions API is unavailable", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const onPermissionPrompt = vi.fn();
    const location = await readOpeningMapLocation(
      { geolocation: { getCurrentPosition } },
      { onPermissionPrompt },
    );

    expect(location).toBeNull();
    expect(onPermissionPrompt).toHaveBeenCalledOnce();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("does not request coordinates after permission is denied", async () => {
    const getCurrentPosition = vi.fn();
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => ({ state: "denied" } as PermissionStatus)),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("waits for an explicit tap when the permission query fails", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => { throw new Error("unsupported"); }),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("waits for an explicit tap when the permission result is malformed", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    const location = await readOpeningMapLocation({
      permissions: {
        query: vi.fn(async () => null as unknown as PermissionStatus),
      },
      geolocation: { getCurrentPosition },
    });

    expect(location).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("falls back when geolocation throws or returns malformed coordinates", async () => {
    const throwing = await readOpeningMapLocation({
      permissions: { query: vi.fn(async () => ({ state: "granted" } as PermissionStatus)) },
      geolocation: {
        getCurrentPosition: vi.fn(() => { throw new Error("unsupported"); }),
      },
    });
    expect(throwing).toBeNull();

    const malformed = await readOpeningMapLocation({
      permissions: { query: vi.fn(async () => ({ state: "granted" } as PermissionStatus)) },
      geolocation: {
        getCurrentPosition: vi.fn((success: PositionCallback) => {
          success({ coords: null } as unknown as GeolocationPosition);
        }),
      },
    });
    expect(malformed).toBeNull();
  });
});
