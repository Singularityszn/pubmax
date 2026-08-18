import { describe, expect, it } from "vitest";

import {
  MAP_LOADING_SLOW_AFTER_MS,
  MAP_LOADING_SLOW_LINE,
  mapLoadingPrimaryLine,
  mapLoadingProgressPercent,
} from "@/lib/mapLoadingCopy";

describe("mapLoadingCopy", () => {
  it("names the city in the primary loading line", () => {
    expect(mapLoadingPrimaryLine("London")).toBe("Loading London pubs…");
    expect(mapLoadingPrimaryLine("Manchester")).toBe("Loading Manchester pubs…");
  });

  it("falls back when the city name is empty", () => {
    expect(mapLoadingPrimaryLine("")).toBe("Loading pubs…");
    expect(mapLoadingPrimaryLine("   ")).toBe("Loading pubs…");
  });

  it("keeps the slow line short and honest", () => {
    expect(MAP_LOADING_SLOW_LINE).toBe("Still loading pubs…");
  });
});

describe("mapLoadingProgressPercent", () => {
  const stage = {
    pinsRevealed: false,
    canvasReady: false,
    slimLoaded: false,
    slimPinCount: 0,
  };

  it("climbs one rung per signal and only tops out on painted pins", () => {
    expect(mapLoadingProgressPercent(stage)).toBe(12);
    expect(mapLoadingProgressPercent({ ...stage, slimLoaded: true })).toBe(35);
    expect(
      mapLoadingProgressPercent({ ...stage, slimLoaded: true, slimPinCount: 40 }),
    ).toBe(55);
    expect(
      mapLoadingProgressPercent({
        ...stage,
        slimLoaded: true,
        slimPinCount: 40,
        canvasReady: true,
      }),
    ).toBe(85);
    expect(mapLoadingProgressPercent({ ...stage, pinsRevealed: true })).toBe(100);
  });

  it("never claims a full load from a basemap alone", () => {
    expect(
      mapLoadingProgressPercent({ ...stage, canvasReady: true }),
    ).toBeLessThan(100);
  });
});

describe("MAP_LOADING_SLOW_AFTER_MS", () => {
  it("waits eight seconds before admitting the load is slow", () => {
    expect(MAP_LOADING_SLOW_AFTER_MS).toBe(8_000);
  });
});
