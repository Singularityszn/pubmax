import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeStoredSaved,
  getSaved,
  savedByList,
  toggleSaveDurable,
} from "@/lib/savedPubs";

// `window.localStorage` is a property getter. Chrome throws SecurityError on
// the read itself when site data is blocked ("Block all cookies", or a
// sandboxed frame without allow-same-origin). PubMap calls getSaved() from a
// useState initializer, so a throw here takes the map down during render.

type WindowLike = { localStorage?: Storage };

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

function installBlockedWindow(): void {
  const refuse = (): never => {
    throw new DOMException("site data is blocked", "SecurityError");
  };
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { configurable: true, get: refuse });
  (globalThis as { window?: unknown }).window = blocked;
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

afterEach(() => {
  clearWindow();
});

describe("saved pubs when the browser refuses site data", () => {
  it("returns an empty list instead of throwing out of render", () => {
    installBlockedWindow();

    expect(() => getSaved()).not.toThrow();
    expect(getSaved()).toEqual([]);
    expect(savedByList()).toEqual({});
    expect(canonicalizeStoredSaved((venueId) => venueId)).toEqual([]);
  });

  it("keeps a signed-out toggle as a quiet no-op", async () => {
    installBlockedWindow();

    await expect(toggleSaveDurable("", "venue-1", "Want to Visit")).resolves.toBeNull();
    expect(getSaved()).toEqual([]);
  });
});

describe("saved pubs when storage is available", () => {
  it("round-trips a signed-out save through localStorage", async () => {
    installWindow(makeMemoryStorage());

    expect(getSaved()).toEqual([]);
    await expect(toggleSaveDurable("", "venue-1", "Want to Visit")).resolves.toBeNull();
    expect(getSaved()).toEqual([
      expect.objectContaining({ venueId: "venue-1", listType: "Want to Visit" }),
    ]);
  });
});
