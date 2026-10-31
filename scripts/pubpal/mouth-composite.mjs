#!/usr/bin/env node
// Lay ONLY the mouth of an edited Pal portrait onto the original master.
//
// An image model asked to "open the mouth and change nothing else" still
// drifts: a little colour, a fur strand, a shifted circuit line. Blending two
// frames that differ outside the mouth would make the whole Pal shimmer as it
// talks, so the edit is never shipped as it came back. This cuts a soft oval
// around the mouth out of the edit and composites it over the original, so
// every pixel outside the oval IS the original.
//
// Run:
//   node scripts/pubpal/mouth-composite.mjs <original.png> <edited.png> <out.png> <cx> <cy> <rx> <ry>
// The oval is in the ORIGINAL's pixel space; the edit is resized to match first.
import { argv, exit } from "node:process";

import sharp from "sharp";

const [original, edited, out, ...oval] = argv.slice(2);
const [cx, cy, rx, ry] = oval.map(Number);
if (!original || !edited || !out || [cx, cy, rx, ry].some((value) => !Number.isFinite(value))) {
  console.error("Usage: mouth-composite.mjs <original.png> <edited.png> <out.png> <cx> <cy> <rx> <ry>");
  exit(2);
}

const { width, height } = await sharp(original).metadata();
if (!width || !height) throw new Error(`Cannot read the size of ${original}`);

// Solid in the middle, feathered over the outer 45% so no edge shows.
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><radialGradient id="m" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.55" stop-color="#fff" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient></defs>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#m)"/>
  </svg>`,
);

const mouth = await sharp(edited)
  .resize(width, height, { fit: "cover" })
  .ensureAlpha()
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

await sharp(original).composite([{ input: mouth }]).png().toFile(out);
console.log(`wrote ${out}`);
