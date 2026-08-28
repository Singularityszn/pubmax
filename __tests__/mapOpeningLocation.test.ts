import { describe, expect, it } from "vitest";

import {
  readMapOpeningLocation,
  resolveMapOpeningLocation,
  writeMapOpeningLocation,
} from "@/lib/mapOpeningLocation";

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

    writeMapOpeningLocation({ lat: 51.5, lng: -0.1 }, store);
    expect(readMapOpeningLocation(store)).toEqual({ lat: 51.5, lng: -0.1 });

    store.setItem("pubmax:map-opening-location:v1", JSON.stringify({ lat: 99, lng: 0 }));
    expect(readMapOpeningLocation(store)).toBeNull();
  });
});
