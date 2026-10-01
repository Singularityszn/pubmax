import { afterEach, describe, expect, it, vi } from "vitest";

import { readMapOpeningLocation, readOpeningMapLocation, writeMapOpeningLocation } from "@/lib/mapOpeningLocation";

const LOCATION_KEY = "pubmax:map-opening-location:v1";
const NOW = 1_000_000_000;

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("accepted returning map location", () => {
  it("stores a dated fix and exposes coordinates only", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const store = storage();
    writeMapOpeningLocation({ lat: 51.5, lng: -0.1 }, store);
    expect(JSON.parse(store.getItem(LOCATION_KEY)!)).toEqual({ lat: 51.5, lng: -0.1, savedAt: NOW });
    expect(readMapOpeningLocation(store)).toEqual({ lat: 51.5, lng: -0.1 });
  });

  it.each([
    ["expired", NOW - 30 * 60 * 1000],
    ["future", NOW + 1],
    ["undated", undefined],
    ["malformed timestamp", "yesterday"],
  ])("discards a %s remembered fix", (_name, savedAt) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const store = storage();
    store.setItem(LOCATION_KEY, JSON.stringify({ lat: 51.5, lng: -0.1, savedAt }));
    expect(readMapOpeningLocation(store)).toBeNull();
    expect(store.getItem(LOCATION_KEY)).toBeNull();
  });

  it.each(["missing", "failed", "unknown"] as const)("waits for a tap when permission is %s", async (state) => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const permissions = state === "missing" ? undefined : {
      query: vi.fn(async () => {
        if (state === "failed") throw new Error("unsupported");
        return { state: "unknown" } as unknown as PermissionStatus;
      }),
    };
    expect(await readOpeningMapLocation({ permissions, geolocation: { getCurrentPosition } })).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("never starts native coordinates after owner cancellation during the permission query", async () => {
    const owner = new AbortController();
    let grant!: (value: PermissionStatus) => void;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.5, longitude: -0.1 } } as GeolocationPosition);
    });
    const options = { signal: owner.signal, onPermissionPrompt: vi.fn() };
    const pending = readOpeningMapLocation({
      permissions: { query: vi.fn(() => new Promise<PermissionStatus>((resolve) => { grant = resolve; })) },
      geolocation: { getCurrentPosition },
    }, options);
    owner.abort();
    grant({ state: "granted" } as PermissionStatus);
    expect(await pending).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
