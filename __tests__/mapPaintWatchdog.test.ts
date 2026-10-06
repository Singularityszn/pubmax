import { describe, expect, it } from "vitest";
import {
  PAINT_STALL_THRESHOLD_MS,
  PAINT_WATCHDOG_INTERVAL_MS,
  PAINT_WATCHDOG_MAX_RETRIES,
  shouldRecoverPaint,
  sourceChangeOwesFrame,
  type PaintWatchdogInput,
} from "@/lib/mapPaintWatchdog";

// A parked-past-threshold baseline the individual cases mutate: a dirtying
// event owed a frame that never rendered. Every guard passes here, so each test
// flips exactly one field to prove that guard.
const parked: PaintWatchdogInput = {
  now: 10_000,
  lastRenderAt: 10_000 - (PAINT_STALL_THRESHOLD_MS + 4_000),
  dirtiedAt: 10_000 - (PAINT_STALL_THRESHOLD_MS + 500),
  documentVisible: true,
  mapLoaded: true,
  canvasVisible: true,
  canvasWidth: 390,
  canvasHeight: 720,
  retries: 0,
};

describe("shouldRecoverPaint", () => {
  it("recovers a parked renderer once every guard holds", () => {
    expect(shouldRecoverPaint(parked)).toBe(true);
  });

  it("stays quiet once the owed frame has rendered", () => {
    expect(
      shouldRecoverPaint({ ...parked, lastRenderAt: parked.now - 100 }),
    ).toBe(false);
    expect(
      shouldRecoverPaint({ ...parked, lastRenderAt: parked.dirtiedAt }),
    ).toBe(false);
  });

  it("treats exactly the threshold as not-yet-stale (strictly greater)", () => {
    expect(
      shouldRecoverPaint({
        ...parked,
        dirtiedAt: parked.now - PAINT_STALL_THRESHOLD_MS,
      }),
    ).toBe(false);
    expect(
      shouldRecoverPaint({
        ...parked,
        dirtiedAt: parked.now - PAINT_STALL_THRESHOLD_MS - 1,
      }),
    ).toBe(true);
  });

  it("never arms on plain idle: a map at rest with nothing dirtied keeps its budget", () => {
    const renderedAt = 1_000;
    let retries = 0;
    for (let now = renderedAt; now <= renderedAt + 30_000; now += PAINT_WATCHDOG_INTERVAL_MS) {
      if (shouldRecoverPaint({ ...parked, now, lastRenderAt: renderedAt, dirtiedAt: null, retries })) {
        retries += 1;
      }
    }
    expect(retries).toBe(0);
  });

  it("stays quiet for a resize the map answered with a frame, however long it then rests", () => {
    expect(
      shouldRecoverPaint({ ...parked, now: 60_000, dirtiedAt: 1_000, lastRenderAt: 1_016 }),
    ).toBe(false);
  });

  it("still recovers a canvas parked after a sheet resize", () => {
    const resizedAt = 5_000;
    const sample = (now: number) =>
      shouldRecoverPaint({ ...parked, now, lastRenderAt: 4_000, dirtiedAt: resizedAt, retries: 0 });
    expect(sample(resizedAt + PAINT_WATCHDOG_INTERVAL_MS)).toBe(false);
    expect(sample(resizedAt + PAINT_WATCHDOG_INTERVAL_MS * 2)).toBe(true);
  });

  it("never fires while the document is hidden (rAF is throttled there)", () => {
    expect(shouldRecoverPaint({ ...parked, documentVisible: false })).toBe(false);
  });

  it("waits for the map + style to be loaded", () => {
    expect(shouldRecoverPaint({ ...parked, mapLoaded: false })).toBe(false);
  });

  it("does nothing for a hidden or zero-size canvas", () => {
    expect(shouldRecoverPaint({ ...parked, canvasVisible: false })).toBe(false);
    expect(shouldRecoverPaint({ ...parked, canvasWidth: 0 })).toBe(false);
    expect(shouldRecoverPaint({ ...parked, canvasHeight: 0 })).toBe(false);
  });

  it("leaves the first-frame case to the first-frame watchdog", () => {
    // Never rendered: lastRenderAt null must not trigger recovery here.
    expect(shouldRecoverPaint({ ...parked, lastRenderAt: null })).toBe(false);
  });

  it("stops once the retry budget is spent, so it can't loop hot", () => {
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES - 1 }),
    ).toBe(true);
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES }),
    ).toBe(false);
    expect(
      shouldRecoverPaint({ ...parked, retries: PAINT_WATCHDOG_MAX_RETRIES + 3 }),
    ).toBe(false);
  });

  it("honours overridden threshold and cap (hermetic knobs)", () => {
    expect(
      shouldRecoverPaint({
        ...parked,
        dirtiedAt: parked.now - 1_000,
        stallThresholdMs: 500,
      }),
    ).toBe(true);
    expect(
      shouldRecoverPaint({ ...parked, retries: 2, maxRetries: 2 }),
    ).toBe(false);
  });
});

describe("sourceChangeOwesFrame", () => {
  it("arms on new content set on an app GeoJSON source", () => {
    expect(sourceChangeOwesFrame({ sourceDataType: "content", sourceType: "geojson" })).toBe(true);
  });

  it("ignores basemap sources and events that are not new content", () => {
    expect(sourceChangeOwesFrame({ sourceDataType: "content", sourceType: "vector" })).toBe(false);
    expect(sourceChangeOwesFrame({ sourceDataType: "metadata", sourceType: "geojson" })).toBe(false);
    expect(sourceChangeOwesFrame({ sourceDataType: undefined, sourceType: "geojson" })).toBe(false);
  });

  it("re-arms a resting map so a setData whose frame never presents is recovered", () => {
    const setDataAt = 20_000;
    const owed = sourceChangeOwesFrame({ sourceDataType: "content", sourceType: "geojson" });
    expect(
      shouldRecoverPaint({
        ...parked,
        now: setDataAt + PAINT_STALL_THRESHOLD_MS + 1,
        lastRenderAt: 5_000,
        dirtiedAt: owed ? setDataAt : 1_000,
      }),
    ).toBe(true);
  });
});
