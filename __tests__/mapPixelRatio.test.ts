// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as maplibregl from "maplibre-gl";
import { MAX_MAP_PIXEL_RATIO, mapPixelRatio } from "@/components/map/canvas/webgl";
import {
  FULL_RESOLUTION_CEILING_MS,
  FULL_RESOLUTION_POLL_MS,
  OPENING_MAP_PIXEL_RATIO,
  armFullResolution,
  fullRatioSpriteRequest,
  fullResolutionDue,
  openingMapPixelRatio,
  spriteUrlForFullRatio,
  type FullResolutionInput,
} from "@/components/map/canvas/openingPixelRatio";

describe("mapPixelRatio", () => {
  it("draws a 3x phone at 2x", () => {
    expect(MAX_MAP_PIXEL_RATIO).toBe(2);
    expect(mapPixelRatio(3)).toBe(2);
    expect(mapPixelRatio(2.625)).toBe(2);
  });

  it("keeps a screen at or under the cap as it is", () => {
    expect(mapPixelRatio(2)).toBe(2);
    expect(mapPixelRatio(1.5)).toBe(1.5);
    expect(mapPixelRatio(1)).toBe(1);
  });

  it("falls back to 1 for a ratio the browser cannot give", () => {
    expect(mapPixelRatio(0)).toBe(1);
    expect(mapPixelRatio(Number.NaN)).toBe(1);
  });

  it("builds the plan preview at the capped ratio", () => {
    const source = readFileSync(
      join(process.cwd(), "components/map/canvas/PlanCrawlRouteMapCanvas.tsx"),
      "utf8",
    );
    expect(source).toMatch(/new maplibregl\.Map\(\{[\s\S]*?pixelRatio: mapPixelRatio\(\),/);
  });

  it("opens the main map at 1x and ends it at the capped ratio", () => {
    const source = readFileSync(join(process.cwd(), "components/PubMapCanvas.tsx"), "utf8");
    expect(source).toMatch(/const fullPixelRatio = mapPixelRatio\(\);/);
    expect(source).toMatch(
      /new maplibregl\.Map\(\{[\s\S]*?pixelRatio: openingMapPixelRatio\(fullPixelRatio, fullResolutionReachedRef\.current\),\s*\n\s*transformRequest: fullRatioSpriteRequest\(fullPixelRatio\),/,
    );
    expect(source).toMatch(/armFullResolution\(map, \{\s*\n\s*fullRatio: fullPixelRatio,/);
    expect(source).toMatch(/entranceSettled: \(\) => pinEntranceSettled,/);
    expect(source).toMatch(/cameraOwed: mapCameraOwed,/);
    expect(source).toMatch(/constructCleanup = \(\) => \{[\s\S]*?disarmFullResolution\(\);/);
  });
});

describe("openingMapPixelRatio", () => {
  it("opens a 2x screen at 1x", () => {
    expect(OPENING_MAP_PIXEL_RATIO).toBe(1);
    expect(openingMapPixelRatio(2, false)).toBe(1);
    expect(openingMapPixelRatio(1.5, false)).toBe(1);
  });

  it("leaves a 1x screen where it is", () => {
    expect(openingMapPixelRatio(1, false)).toBe(1);
  });

  it("rebuilds a map that already reached its full ratio at that ratio", () => {
    expect(openingMapPixelRatio(2, true)).toBe(2);
  });
});

describe("fullResolutionDue", () => {
  const over: FullResolutionInput = {
    currentRatio: 1,
    fullRatio: 2,
    entranceSettled: true,
    cameraMoving: false,
    cameraOwed: false,
    pointerDown: false,
    contextLost: false,
    sinceConstructMs: 3_000,
  };

  it("switches once the pins have arrived and the camera is at rest", () => {
    expect(fullResolutionDue(over)).toBe(true);
  });

  it("does nothing at or above the full ratio", () => {
    expect(fullResolutionDue({ ...over, currentRatio: 2 })).toBe(false);
    expect(fullResolutionDue({ ...over, currentRatio: 1, fullRatio: 1 })).toBe(false);
  });

  it("waits for the pin entrance and for every move the app owes the camera", () => {
    expect(fullResolutionDue({ ...over, entranceSettled: false })).toBe(false);
    expect(fullResolutionDue({ ...over, cameraOwed: true })).toBe(false);
  });

  it("never switches under a moving camera, a finger or a lost context", () => {
    for (const hold of ["cameraMoving", "pointerDown", "contextLost"] as const) {
      expect(fullResolutionDue({ ...over, [hold]: true })).toBe(false);
      expect(
        fullResolutionDue({
          ...over,
          entranceSettled: false,
          sinceConstructMs: FULL_RESOLUTION_CEILING_MS * 10,
          [hold]: true,
        }),
      ).toBe(false);
    }
  });

  it("is not held at 1x for ever when the pins or the turn never come", () => {
    const stuck = { ...over, entranceSettled: false, cameraOwed: true };
    expect(fullResolutionDue({ ...stuck, sinceConstructMs: FULL_RESOLUTION_CEILING_MS - 1 })).toBe(false);
    expect(fullResolutionDue({ ...stuck, sinceConstructMs: FULL_RESOLUTION_CEILING_MS })).toBe(true);
  });
});

describe("spriteUrlForFullRatio", () => {
  const sprite = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm";

  it("asks for the @2x sheet while the canvas is below a full ratio over 1", () => {
    expect(spriteUrlForFullRatio(`${sprite}.json`, 2)).toBe(`${sprite}@2x.json`);
    expect(spriteUrlForFullRatio(`${sprite}.png`, 1.5)).toBe(`${sprite}@2x.png`);
    expect(spriteUrlForFullRatio(`${sprite}.png?key=1`, 2)).toBe(`${sprite}@2x.png?key=1`);
  });

  it("leaves a 1x screen, an @2x request and anything that is not a sprite file alone", () => {
    expect(spriteUrlForFullRatio(`${sprite}.json`, 1)).toBeNull();
    expect(spriteUrlForFullRatio(`${sprite}@2x.json`, 2)).toBeNull();
    expect(spriteUrlForFullRatio(`${sprite}@2x.png`, 2)).toBeNull();
    expect(spriteUrlForFullRatio(`${sprite}.pbf`, 2)).toBeNull();
    expect(spriteUrlForFullRatio("not a url", 2)).toBeNull();
  });

  it("rewrites sprite requests only", () => {
    const transform = fullRatioSpriteRequest(2);
    type Kind = Parameters<typeof transform>[1];
    expect(transform(`${sprite}.json`, "SpriteJSON" as Kind)).toEqual({ url: `${sprite}@2x.json` });
    expect(transform(`${sprite}.png`, "SpriteImage" as Kind)).toEqual({ url: `${sprite}@2x.png` });
    expect(transform(`${sprite}@2x.png`, "SpriteImage" as Kind)).toBeUndefined();
    expect(transform("https://tiles.openfreemap.org/planet/1/2/3.json", "Tile" as Kind)).toBeUndefined();
    expect(transform("https://tiles.openfreemap.org/styles/positron.json", "Style" as Kind)).toBeUndefined();
  });
});

describe("armFullResolution", () => {
  type FakeMap = {
    ratio: number;
    moving: boolean;
    surface: HTMLDivElement;
    calls: string[];
  };

  let frames: FrameRequestCallback[];

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fakeMap = (): FakeMap & { map: maplibregl.Map } => {
    const state: FakeMap = {
      ratio: 1,
      moving: false,
      surface: document.createElement("div"),
      calls: [],
    };
    const map = {
      getPixelRatio: () => state.ratio,
      isMoving: () => state.moving,
      getCanvasContainer: () => state.surface,
      getCanvas: () => document.createElement("canvas"),
      painter: { context: { gl: { isContextLost: () => false } } },
      setPixelRatio: (ratio: number) => {
        state.calls.push(`setPixelRatio:${ratio}`);
        state.ratio = ratio;
      },
      redraw: () => {
        state.calls.push("redraw");
      },
    } as unknown as maplibregl.Map;
    return Object.assign(state, { map });
  };

  const runFrames = () => {
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(performance.now());
  };

  it("switches at the top of a frame and draws that frame itself", () => {
    const fake = fakeMap();
    let settled = false;
    const onFullResolution = vi.fn();
    armFullResolution(fake.map, {
      fullRatio: 2,
      entranceSettled: () => settled,
      cameraOwed: () => false,
      onFullResolution,
    });
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS * 3);
    expect(frames).toHaveLength(0);
    settled = true;
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS);
    expect(fake.calls).toEqual([]);
    runFrames();
    expect(fake.calls).toEqual(["setPixelRatio:2", "redraw"]);
    expect(onFullResolution).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FULL_RESOLUTION_CEILING_MS);
    runFrames();
    expect(fake.calls).toEqual(["setPixelRatio:2", "redraw"]);
  });

  it("stands down when a gesture starts between the poll and the frame", () => {
    const fake = fakeMap();
    armFullResolution(fake.map, {
      fullRatio: 2,
      entranceSettled: () => true,
      cameraOwed: () => false,
      onFullResolution: () => {},
    });
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS);
    fake.moving = true;
    runFrames();
    expect(fake.calls).toEqual([]);
    fake.moving = false;
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS);
    runFrames();
    expect(fake.calls).toEqual(["setPixelRatio:2", "redraw"]);
  });

  it("waits for a finger to leave the map, even past the ceiling", () => {
    const fake = fakeMap();
    armFullResolution(fake.map, {
      fullRatio: 2,
      entranceSettled: () => false,
      cameraOwed: () => true,
      onFullResolution: () => {},
    });
    const down = new Event("pointerdown") as Event & { pointerId: number };
    down.pointerId = 7;
    fake.surface.dispatchEvent(down);
    vi.advanceTimersByTime(FULL_RESOLUTION_CEILING_MS + FULL_RESOLUTION_POLL_MS);
    runFrames();
    expect(fake.calls).toEqual([]);
    const up = new Event("pointerup") as Event & { pointerId: number };
    up.pointerId = 7;
    window.dispatchEvent(up);
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS);
    runFrames();
    expect(fake.calls).toEqual(["setPixelRatio:2", "redraw"]);
  });

  it("arms nothing for a map already at its full ratio, and its teardown stops a pending switch", () => {
    const full = fakeMap();
    full.ratio = 2;
    armFullResolution(full.map, {
      fullRatio: 2,
      entranceSettled: () => true,
      cameraOwed: () => false,
      onFullResolution: () => {},
    });
    vi.advanceTimersByTime(FULL_RESOLUTION_CEILING_MS);
    expect(frames).toHaveLength(0);

    const torn = fakeMap();
    const disarm = armFullResolution(torn.map, {
      fullRatio: 2,
      entranceSettled: () => true,
      cameraOwed: () => false,
      onFullResolution: () => {},
    });
    vi.advanceTimersByTime(FULL_RESOLUTION_POLL_MS);
    disarm();
    runFrames();
    vi.advanceTimersByTime(FULL_RESOLUTION_CEILING_MS);
    runFrames();
    expect(torn.calls).toEqual([]);
  });
});
