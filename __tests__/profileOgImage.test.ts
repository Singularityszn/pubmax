// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import Image, { size } from "@/app/u/[handle]/opengraph-image";
import { HANDLE_MAX } from "@/lib/profiles";
import { defined } from "@/__tests__/helpers/defined";

// The profile share card is the preview every /u/<handle> link unfurls to. It
// once threw on every handle: `@{handle}` renders two text children, and satori
// refuses a div with more than one child unless it is display:flex, so the
// route answered with an empty body. This drives the real ImageResponse render.

async function render(handle: string) {
  const response = await Image({ params: Promise.resolve({ handle }) });
  return { response, png: Buffer.from(await response.arrayBuffer()) };
}

type Box = { left: number; top: number; right: number; bottom: number };

// Decode the PNG and report which pixels in the top band (handle row and
// stamp) are near the handle's cream ink or the stamp's brass ink.
async function inkMap(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const near = ([r, g, b]: readonly (number | undefined)[], [R, G, B]: readonly number[]) =>
    Math.abs(defined(r) - defined(R)) + Math.abs(defined(g) - defined(G)) + Math.abs(defined(b) - defined(B)) < 60;
  const isCream = (x: number, y: number) => near(at(x, y), [0xec, 0xe3, 0xd2]);
  const isBrass = (x: number, y: number) => near(at(x, y), [0xd3, 0xa4, 0x4a]);
  return { width: info.width, isCream, isBrass };
}

async function stampBox(png: Buffer): Promise<Box | null> {
  const { width, isBrass } = await inkMap(png);
  let box: Box | null = null;
  for (let y = 0; y < 260; y++) {
    for (let x = width / 2; x < width; x++) {
      if (!isBrass(x, y)) continue;
      box = box
        ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) }
        : { left: x, top: y, right: x, bottom: y };
    }
  }
  return box;
}

describe("profile share card", () => {
  it("renders a PNG for a handle", async () => {
    const { response, png } = await render("karan");

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it.each([
    ["a realistic long handle", "the_marylebone_pint_hunter"],
    ["a maximum-length handle of wide letters", "w".repeat(HANDLE_MAX)],
  ])("keeps %s clear of the stamp and inside the card", async (_label, handle) => {
    const expected = await stampBox((await render("karan")).png);
    const { png } = await render(handle);
    const stamp = await stampBox(png);
    const { width, isCream } = await inkMap(png);

    // The stamp stays where a short handle leaves it.
    expect(expected).not.toBeNull();
    expect(stamp).toEqual(expected);

    // No handle ink reaches the stamp's column, which runs to the card edge.
    expect(width).toBe(size.width);
    const collisions: string[] = [];
    for (let y = 0; y < 260; y++) {
      for (let x = stamp!.left - 8; x < width; x++) {
        if (isCream(x, y)) collisions.push(`${x},${y}`);
      }
    }
    expect(collisions).toEqual([]);
  });
});
