import { describe, expect, it } from "vitest";

import {
  mapAmbientBannersVisible,
  pickMapSurfaceToast,
} from "@/lib/mapSurfaceChrome";

describe("pickMapSurfaceToast", () => {
  it("keeps one toast when a tile retry and a lookup note both want the surface", () => {
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: true }),
    ).toBe("soft-retry");
    expect(
      pickMapSurfaceToast({
        selectionNotice: true,
        selectionNoticePriority: true,
        softRetry: true,
      }),
    ).toBe("selection");
    expect(
      pickMapSurfaceToast({ selectionNotice: true, softRetry: false }),
    ).toBe("selection");
    expect(
      pickMapSurfaceToast({ selectionNotice: false, softRetry: false }),
    ).toBe("none");
  });
});

describe("ambient banners on a map with no canvas", () => {
  it("stand down when the shell has replaced the canvas with the venue view", () => {
    // Measured at 390 with the map chunk blocked: the UK place arrival banner
    // landed on top of the fallback card's own pub rows.
    expect(mapAmbientBannersVisible({ canvasUnavailable: true })).toBe(false);
  });

  it("are untouched on a live map", () => {
    expect(mapAmbientBannersVisible({ canvasUnavailable: false })).toBe(true);
  });
});
