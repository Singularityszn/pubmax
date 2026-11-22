// A phone photo is stored the way the composer previewed it: upright.
//
// The EXIF strip removes the orientation tag with the GPS, so a pipeline that
// asks sharp to auto-turn the STRIPPED bytes gets nothing to act on and stores
// a portrait bill on its side. The oracle here is sharp's own auto-turn of the
// ORIGINAL bytes, which is what the browser shows.

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { preparePhoto } from "@/lib/pintDropsStore";
import { prepareUploadedImage } from "@/lib/uploadedImage.server";

const WIDTH = 40;
const HEIGHT = 20;
const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Four flat quadrants, so each of the eight turns gives a different layout. */
function quadrants(): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const top = y < HEIGHT / 2;
      const left = x < WIDTH / 2;
      const rgb = left ? (top ? [255, 0, 0] : [0, 255, 0]) : top ? [0, 0, 255] : [255, 255, 0];
      pixels.set(rgb, (y * WIDTH + x) * 3);
    }
  }
  return pixels;
}

async function taggedPhoto(orientation: number, format: "jpeg" | "png" | "webp"): Promise<Buffer> {
  const image = sharp(quadrants(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } });
  const encoded = format === "jpeg" ? image.jpeg({ quality: 95 }) : format === "png" ? image.png() : image.webp({ lossless: true });
  return encoded.withMetadata({ orientation }).toBuffer();
}

/** The box, then the colour at the centre of each quadrant, read left to right, top to bottom. */
async function layout(bytes: Buffer): Promise<string> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (fx: number, fy: number) => {
    const offset = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * info.channels;
    return [0, 1, 2].map((c) => (data[offset + c]! > 127 ? "1" : "0")).join("");
  };
  return `${info.width}x${info.height} ${[at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)].join(",")}`;
}

async function upright(original: Buffer): Promise<string> {
  return layout(await sharp(original).rotate().toBuffer());
}

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

function asFile(bytes: Buffer, format: "jpeg" | "png" | "webp"): File {
  return new File([new Uint8Array(bytes)], `photo.${format}`, { type: MIME[format] });
}

const CASES = [
  ...ORIENTATIONS.map((orientation) => ["jpeg", orientation] as const),
  ["png", 6] as const,
  ["webp", 6] as const,
];

describe("a pint drop photo is stored upright", () => {
  it.each(CASES)("%s tagged orientation %i", async (format, orientation) => {
    const original = await taggedPhoto(orientation, format);
    const stored = await preparePhoto("receipt", "venue-1", "drop-1", asFile(original, format));
    expect(await layout(stored)).toBe(await upright(original));
  });
});

describe("an owned image is stored upright", () => {
  it.each(CASES)("%s tagged orientation %i", async (format, orientation) => {
    const original = await taggedPhoto(orientation, format);
    const prepared = await prepareUploadedImage(asFile(original, format), {
      noun: "Photo",
      outputWidth: 512,
      outputHeight: 512,
      fail: (_code, message) => new Error(message),
    });
    expect(await layout(prepared.bytes)).toBe(await upright(original));
    expect(`${prepared.width}x${prepared.height}`).toBe((await upright(original)).split(" ")[0]);
  });
});
