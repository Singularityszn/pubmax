#!/usr/bin/env node
// One-shot writer for the captain-chosen Pub Pal mascot (circuit robin).
// Source JPEG stays outside the repo. Run: node scripts/gen-pubpal-mascot.mjs <source.jpg>

import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SIZES = [32, 64, 128, 512];
const WEBP_512_BUDGET = 60 * 1024;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "pal");

function circleSvg(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
}

async function writeSquare(source, size) {
  const base = sharp(source).resize(size, size, { fit: "cover" });
  await base.clone().webp({ quality: size >= 512 ? 78 : 82, effort: 6 }).toFile(join(OUT_DIR, `circuit-robin-${size}.webp`));
  await base.clone().png({ compressionLevel: 9 }).toFile(join(OUT_DIR, `circuit-robin-${size}.png`));
}

async function writeAvatar(source, size) {
  const mask = circleSvg(size);
  const base = sharp(source)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }]);
  await base.clone().webp({ quality: size >= 512 ? 78 : 82, effort: 6 }).toFile(join(OUT_DIR, `circuit-robin-avatar-${size}.webp`));
  await base.clone().png({ compressionLevel: 9 }).toFile(join(OUT_DIR, `circuit-robin-avatar-${size}.png`));
}

async function main() {
  const source = argv[2];
  if (!source) {
    console.error("Usage: node scripts/gen-pubpal-mascot.mjs <source.jpg>");
    exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    await writeSquare(source, size);
    await writeAvatar(source, size);
  }
  const webp512 = join(OUT_DIR, "circuit-robin-512.webp");
  const bytes = (await stat(webp512)).size;
  if (bytes >= WEBP_512_BUDGET) {
    console.error(`${basename(webp512)} is ${bytes} bytes; budget is ${WEBP_512_BUDGET}`);
    exit(1);
  }
  console.log(`wrote ${OUT_DIR} (${basename(webp512)} ${bytes} bytes)`);
}

await main();
