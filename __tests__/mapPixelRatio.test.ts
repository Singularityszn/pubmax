import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_MAP_PIXEL_RATIO, mapPixelRatio } from "@/components/map/canvas/webgl";

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
