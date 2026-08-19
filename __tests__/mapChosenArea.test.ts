import { describe, expect, it } from "vitest";

import {
  MAP_CHOSEN_AREA_KEY,
  clearMapChosenArea,
  readMapChosenArea,
  writeMapChosenArea,
} from "@/lib/mapChosenArea";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("mapChosenArea", () => {
  it("round-trips a remembered area", () => {
    const storage = makeMemoryStorage();
    expect(readMapChosenArea(storage)).toBeNull();
    writeMapChosenArea(
      {
        cityId: "london",
        label: "Camden",
        slug: "camden",
        center: [-0.143, 51.539],
        kind: "night-area",
      },
      storage,
    );
    expect(readMapChosenArea(storage)).toEqual({
      cityId: "london",
      label: "Camden",
      slug: "camden",
      center: [-0.143, 51.539],
      kind: "night-area",
    });
    expect(storage.getItem(MAP_CHOSEN_AREA_KEY)).toContain("Camden");
    clearMapChosenArea(storage);
    expect(readMapChosenArea(storage)).toBeNull();
  });

  it("refuses malformed stored rows", () => {
    const storage = makeMemoryStorage();
    storage.setItem(MAP_CHOSEN_AREA_KEY, JSON.stringify({ label: "Camden" }));
    expect(readMapChosenArea(storage)).toBeNull();
  });

  it("returns a stable snapshot for useSyncExternalStore", () => {
    const storage = makeMemoryStorage();
    writeMapChosenArea(
      {
        cityId: "london",
        label: "Camden",
        slug: "camden",
        center: [-0.143, 51.539],
        kind: "night-area",
      },
      storage,
    );
    const first = readMapChosenArea(storage);
    const second = readMapChosenArea(storage);
    expect(first).toBe(second);
  });
});
