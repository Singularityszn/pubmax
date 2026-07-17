import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedCrawlState } from "@/lib/crawlUrl";
import {
  MOBILE_MAP_SESSION_KEY,
  readMobileMapSession,
  validateMapViewport,
  validateMobileMapFilters,
  writeMobileMapSession,
} from "@/lib/mobileShell";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("mobile map session adapter", () => {
  beforeEach(() => {
    (globalThis as { window?: { localStorage: Storage } }).window = {
      localStorage: memoryStorage(),
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips only the versioned safe map state", () => {
    const filters = seedCrawlState("").filters;
    writeMobileMapSession({
      viewport: { center: [-0.12, 51.51], zoom: 13, pitch: 28, bearing: -8 },
      filters,
      cityId: "london",
      nightArea: "shoreditch",
      selectedVenueId: "pub-1",
      openSheet: "venue",
      transitNetworkVisible: true,
    });
    const raw = window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "";
    expect(raw).not.toContain("location");
    expect(readMobileMapSession()).toMatchObject({
      version: 1,
      cityId: "london",
      nightArea: "shoreditch",
      selectedVenueId: "pub-1",
      openSheet: "venue",
      transitNetworkVisible: true,
      filters,
    });
  });

  it("rejects malformed city, filters, viewport, and overlay data", () => {
    const filters = seedCrawlState("").filters;
    expect(validateMobileMapFilters({ ...filters, stopCount: "six" })).toBeNull();
    expect(validateMapViewport({ center: [500, 51], zoom: 12, pitch: 20, bearing: 0 })).toBeNull();
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify({
      version: 1,
      cityId: "elsewhere",
      filters,
      openSheet: "secrets",
    }));
    expect(readMobileMapSession()).toBeNull();
  });
});
