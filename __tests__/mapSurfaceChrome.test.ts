import { describe, expect, it } from "vitest";

import {
  MAP_SURFACE_FLOATING_LIST_TOGGLE,
  MAP_SURFACE_FLOATING_PRICE_KEY,
  pickMapSurfaceToast,
} from "@/lib/mapSurfaceChrome";

describe("pickMapSurfaceToast", () => {
  it("keeps one toast when a tile retry and a lookup note both want the surface", () => {
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: true }),
    ).toBe("soft-retry");
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: false }),
    ).toBe("selection");
    expect(
      pickMapSurfaceToast({ selectionNotice: false, softRetry: false }),
    ).toBe("none");
  });
});

describe("map surface floating chrome", () => {
  it("holds the price key and list toggle out of the map overlay stack", () => {
    expect(MAP_SURFACE_FLOATING_PRICE_KEY).toBe(false);
    expect(MAP_SURFACE_FLOATING_LIST_TOGGLE).toBe(false);
  });
});
