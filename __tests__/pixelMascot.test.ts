import { describe, expect, it } from "vitest";

import { MASCOT_GRID, MASCOT_SPRITES, mascotPaths, type MascotPose } from "@/lib/pixelMascot";

const POSES = Object.keys(MASCOT_SPRITES) as MascotPose[];
const INKS = "kadcwesgh";

/** Paint a pose's paths back onto a grid, one letter per pixel. */
function repaint(pose: MascotPose): string[] {
  const grid = Array.from({ length: MASCOT_GRID }, () => Array<string>(MASCOT_GRID).fill("."));
  for (const { ink, d } of mascotPaths(pose)) {
    for (const [, x, y, width] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let col = Number(x); col < Number(x) + Number(width); col += 1) {
        expect(grid[Number(y)]![col], `${pose} paints ${col},${y} once`).toBe(".");
        grid[Number(y)]![col] = ink;
      }
    }
  }
  return grid.map((row) => row.join(""));
}

describe("the pixel mascots", () => {
  it.each(POSES)("%s is a full grid of known inks", (pose) => {
    const rows = MASCOT_SPRITES[pose];
    expect(rows).toHaveLength(MASCOT_GRID);
    for (const row of rows) {
      expect(row).toHaveLength(MASCOT_GRID);
      expect([...row].filter((pixel) => pixel !== "." && !INKS.includes(pixel))).toEqual([]);
    }
  });

  it.each(POSES)("%s draws every pixel of its grid and no other", (pose) => {
    expect(repaint(pose)).toEqual([...MASCOT_SPRITES[pose]]);
  });
});
