import { describe, expect, it } from "vitest";

import {
  MAP_CHOSEN_AREA_KEY,
  clearMapChosenArea,
  readMapChosenArea,
  resolveMapChosenAreaRestore,
  writeMapChosenArea,
  type MapChosenArea,
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

const CAMDEN: MapChosenArea = {
  cityId: "london",
  label: "Camden",
  slug: "camden",
  center: [-0.143, 51.539],
  kind: "night-area",
};

const NEAR_ME: MapChosenArea = {
  cityId: "london",
  label: "Near me",
  slug: "near-me",
  center: [-0.09, 51.515],
  kind: "near-me",
};

describe("resolveMapChosenAreaRestore", () => {
  const base = {
    stored: CAMDEN,
    cityId: "london" as const,
    explicitArrivalIntent: false,
    hasRestoredViewport: false,
    venueCount: 40,
  };

  it("restores the remembered area on a clean arrival", () => {
    expect(resolveMapChosenAreaRestore(base)).toEqual({
      action: "restore",
      area: CAMDEN,
    });
  });

  it("stands down for an explicit arrival, so a shared ?sel= keeps its camera", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, explicitArrivalIntent: true }),
    ).toEqual({ action: "skip" });
  });

  it("stands down for a restored session viewport", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, hasRestoredViewport: true }),
    ).toEqual({ action: "skip" });
  });

  it("skips a row belonging to another city", () => {
    expect(
      resolveMapChosenAreaRestore({
        ...base,
        stored: { ...CAMDEN, cityId: "manchester" },
      }),
    ).toEqual({ action: "skip" });
  });

  it("skips when nothing is remembered", () => {
    expect(resolveMapChosenAreaRestore({ ...base, stored: null })).toEqual({
      action: "skip",
    });
  });

  it("waits for the index before ranking a Near me row, and never on intent", () => {
    expect(
      resolveMapChosenAreaRestore({ ...base, stored: NEAR_ME, venueCount: 0 }),
    ).toEqual({ action: "wait" });
    expect(
      resolveMapChosenAreaRestore({ ...base, stored: NEAR_ME, venueCount: 12 }),
    ).toEqual({ action: "restore", area: NEAR_ME });
    // Intent is answered first: an explicit arrival never leaves the one-shot
    // hanging on a venue count that may never arrive.
    expect(
      resolveMapChosenAreaRestore({
        ...base,
        stored: NEAR_ME,
        venueCount: 0,
        explicitArrivalIntent: true,
      }),
    ).toEqual({ action: "skip" });
  });
});
