import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPreferredCity,
  mapHrefForCity,
  preferredCityMapHref,
  readPreferredCity,
  writePreferredCity,
} from "@/lib/cityPreference";

const STORAGE_KEY = "pubmax:preferredCity:v1";

type WindowLike = { localStorage: Storage };

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

function installWindow(storage: Storage): void {
  (globalThis as { window?: WindowLike }).window = { localStorage: storage };
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

afterEach(() => {
  clearWindow();
});

describe("preferred city storage", () => {
  beforeEach(() => {
    installWindow(makeMemoryStorage());
  });

  it("reads null when unset and round-trips a write", () => {
    expect(readPreferredCity()).toBeNull();
    writePreferredCity("oxford");
    expect(readPreferredCity()).toBe("oxford");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("oxford");
  });

  it("ignores unknown city ids on write", () => {
    writePreferredCity("paris");
    expect(readPreferredCity()).toBeNull();
  });

  it("clears a stored preference", () => {
    writePreferredCity("bristol");
    expect(readPreferredCity()).toBe("bristol");
    clearPreferredCity();
    expect(readPreferredCity()).toBeNull();
  });

  it("skips storage write when the same city is already stored", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    writePreferredCity("oxford");
    const setItem = vi.spyOn(storage, "setItem");
    writePreferredCity("oxford");
    expect(setItem).not.toHaveBeenCalled();
    writePreferredCity("glasgow");
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, "glasgow");
  });

  it("mapHrefForCity mirrors city share paths", () => {
    expect(mapHrefForCity("london")).toBe("/map");
    expect(mapHrefForCity("manchester")).toBe("/map/manchester");
  });

  it("returns null without window (SSR)", () => {
    clearWindow();
    expect(readPreferredCity()).toBeNull();
    writePreferredCity("glasgow"); // no-op
    expect(readPreferredCity()).toBeNull();
  });
});

describe("preferredCityMapHref", () => {
  beforeEach(() => {
    installWindow(makeMemoryStorage());
  });

  it("falls back to /map when preference is null", () => {
    expect(preferredCityMapHref()).toBe("/map");
    expect(preferredCityMapHref(new URLSearchParams({ log: "1" }))).toBe(
      "/map?log=1",
    );
  });

  it("uses the preferred city path (+ optional query)", () => {
    writePreferredCity("glasgow");
    expect(preferredCityMapHref()).toBe("/map/glasgow");
    expect(preferredCityMapHref(new URLSearchParams({ log: "1" }))).toBe(
      "/map/glasgow?log=1",
    );
  });

  it("deep-link write sticks so Map/Drop do not bounce to London", () => {
    writePreferredCity("manchester");
    expect(preferredCityMapHref()).toBe("/map/manchester");
    expect(preferredCityMapHref(new URLSearchParams({ log: "1" }))).toBe(
      "/map/manchester?log=1",
    );
  });

  it("rivalry-style city picks stick for subsequent Map nav", () => {
    writePreferredCity("bristol");
    expect(readPreferredCity()).toBe("bristol");
    expect(preferredCityMapHref()).toBe("/map/bristol");
    writePreferredCity("london");
    expect(preferredCityMapHref()).toBe("/map");
  });
});
