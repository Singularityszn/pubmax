import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_MAP_PIXEL_RATIO,
  followMapPixelRatio,
  mapPixelRatio,
} from "@/components/map/canvas/webgl";

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

  it.each([
    "components/PubMapCanvas.tsx",
    "components/map/canvas/PlanCrawlRouteMapCanvas.tsx",
  ])("%s builds its map at the capped ratio", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/new maplibregl\.Map\(\{[\s\S]*?pixelRatio: mapPixelRatio\(\),/);
  });
});

describe("followMapPixelRatio", () => {
  function fakeWindow(start: number) {
    const listeners = new Map<string, Set<() => void>>();
    const win = {
      devicePixelRatio: start,
      matchMedia: (media: string) =>
        ({
          media,
          addEventListener: (_: string, cb: () => void) => {
            if (!listeners.has(media)) listeners.set(media, new Set());
            listeners.get(media)!.add(cb);
          },
          removeEventListener: (_: string, cb: () => void) => listeners.get(media)?.delete(cb),
        }) as unknown as MediaQueryList,
    };
    const moveTo = (ratio: number) => {
      const old = `(resolution: ${win.devicePixelRatio}dppx)`;
      win.devicePixelRatio = ratio;
      for (const cb of [...(listeners.get(old) ?? [])]) cb();
    };
    const live = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
    return { win, moveTo, live };
  }

  function fakeMap(ratio: number) {
    const set: number[] = [];
    return {
      set,
      getPixelRatio: () => ratio,
      setPixelRatio: (next: number) => {
        ratio = next;
        set.push(next);
      },
    };
  }

  it("follows browser zoom and a move to another screen, inside the cap", () => {
    const { win, moveTo } = fakeWindow(1);
    const map = fakeMap(1);
    followMapPixelRatio(map, win);
    moveTo(2);
    moveTo(1.25);
    moveTo(3);
    expect(map.set).toEqual([2, 1.25, 2]);
  });

  it("leaves the map alone when the capped ratio does not change", () => {
    const { win, moveTo } = fakeWindow(3);
    const map = fakeMap(2);
    followMapPixelRatio(map, win);
    moveTo(2.5);
    expect(map.set).toEqual([]);
  });

  it("holds one listener at a time and none after teardown", () => {
    const { win, moveTo, live } = fakeWindow(1);
    const stop = followMapPixelRatio(fakeMap(1), win);
    moveTo(2);
    moveTo(1);
    expect(live()).toBe(1);
    stop();
    expect(live()).toBe(0);
  });

  it.each([
    "components/PubMapCanvas.tsx",
    "components/map/canvas/PlanCrawlRouteMapCanvas.tsx",
  ])("%s follows the screen's ratio after it builds the map", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/followMapPixelRatio\(map\)/);
  });
});
