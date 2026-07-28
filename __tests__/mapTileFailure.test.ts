import { describe, expect, it } from "vitest";
import {
  TILE_FAILURE_BURST,
  TILE_FAILURE_SUSTAIN_MS,
  TILE_FAILURE_WINDOW_MS,
  classifyTileFailure,
  isCriticalBasemapFailure,
  pruneTileFailures,
  type TileFailureInput,
} from "@/lib/mapTileFailure";

describe("isCriticalBasemapFailure", () => {
  it("treats initial vector TileJSON failure as systemic without a tile burst", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(true);
  });

  it("does not promote an individual vector tile miss to critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: true,
      }),
    ).toBe(false);
  });

  it("does not call a GeoJSON overlay or settled source critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "geojson",
        tilePresent: false,
      }),
    ).toBe(false);
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: false,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(false);
  });

  it("keeps sprite and glyph failures critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "Could not load sprite image",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
    expect(
      isCriticalBasemapFailure({
        message: "Could not load glyph range",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
  });
});

// A visible, settled-camera tab with a sustained burst and a full budget the
// individual cases mutate. Every rule passes here, so each test flips exactly
// one field to prove that rule. The stamps span the sustain requirement while
// staying inside the window.
const NOW = 60_000;
const SPREAD = Math.ceil(TILE_FAILURE_SUSTAIN_MS / (TILE_FAILURE_BURST - 1)) + 100;
const burst = Array.from({ length: TILE_FAILURE_BURST }, (_, i) => NOW - i * SPREAD);
const bursting: TileFailureInput = {
  now: NOW,
  errorTimestamps: burst,
  criticalFailure: false,
  documentVisible: true,
  cameraInFlight: false,
  retrySpent: false,
  recoveryBudgetLeft: 5,
};

describe("classifyTileFailure", () => {
  it("spends the one retry on a sustained burst with budget left", () => {
    expect(classifyTileFailure(bursting)).toBe("retry");
  });

  it("ignores a lone transient tile miss", () => {
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: [NOW] }),
    ).toBe("ignore");
  });

  it("ignores a fast self-healing blip (burst count without sustained span)", () => {
    // The live-observed class: a camera flight paints black, tiles catch up in
    // under 5s. Enough errors to look like a burst, but the span is short.
    const blip = Array.from(
      { length: TILE_FAILURE_BURST + 2 },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: blip }),
    ).toBe("ignore");
  });

  it("retries a concentrated burst while the initial basemap is still pending", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
      }),
    ).toBe("retry");
  });

  it("surfaces a repeated initial burst after the bounded retry", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
        retrySpent: true,
      }),
    ).toBe("surface");
  });

  it("ignores tile bursts but not terminal resources while the camera is in flight", () => {
    expect(
      classifyTileFailure({ ...bursting, cameraInFlight: true }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        cameraInFlight: true,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores errors that have aged out of the window", () => {
    const stale = burst.map((t) => t - (TILE_FAILURE_WINDOW_MS + SPREAD * TILE_FAILURE_BURST));
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: stale }),
    ).toBe("ignore");
  });

  it("treats one sprite/glyph failure as systemic on its own", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW],
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores tile bursts but not terminal resources while the tab is hidden", () => {
    expect(
      classifyTileFailure({ ...bursting, documentVisible: false }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        documentVisible: false,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("surfaces when the retry is already spent", () => {
    expect(classifyTileFailure({ ...bursting, retrySpent: true })).toBe(
      "surface",
    );
  });

  it("surfaces when the shared recovery budget is gone", () => {
    expect(
      classifyTileFailure({ ...bursting, recoveryBudgetLeft: 0 }),
    ).toBe("surface");
  });

  it("needs the full burst count even when the span is sustained", () => {
    const oneShort = burst.slice(0, TILE_FAILURE_BURST - 1);
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: oneShort }),
    ).toBe("ignore");
  });

  it("honors threshold, window, and sustain overrides", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 300],
        burstThreshold: 2,
        sustainMs: 200,
      }),
    ).toBe("retry");
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 600],
        burstThreshold: 2,
        windowMs: 500,
        sustainMs: 200,
      }),
    ).toBe("ignore");
  });
});

describe("pruneTileFailures", () => {
  it("keeps stamps inside the window and drops the aged", () => {
    const stamps = [NOW, NOW - TILE_FAILURE_WINDOW_MS, NOW - TILE_FAILURE_WINDOW_MS - 1];
    expect(pruneTileFailures(stamps, NOW)).toEqual([
      NOW,
      NOW - TILE_FAILURE_WINDOW_MS,
    ]);
  });

  it("respects a custom window", () => {
    expect(pruneTileFailures([NOW, NOW - 400, NOW - 600], NOW, 500)).toEqual([
      NOW,
      NOW - 400,
    ]);
  });
});
