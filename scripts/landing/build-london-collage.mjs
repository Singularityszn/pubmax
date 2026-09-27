#!/usr/bin/env node
// Encode the founder's London photographs for the landing collage.
//
// Run by hand when a photograph joins the set, never by a build: a picture of
// a place is a curation decision (the landing imagery rule in
// docs/rules/lib-venues-areas-listings-and-nights.md). Reads LONDON_COLLAGE_PHOTOS from lib/landingLondonCollage.ts, strips
// every byte of EXIF/GPS/device metadata, writes responsive AVIF/WebP under
// public/landing/london-collage/, and prints each photo's width, height and
// blurDataUrl to paste back into that list.
//
// Usage:
//   node scripts/landing/build-london-collage.mjs [--source-dir <dir>]
//
// Default source dir: the captain's hand-off folder beside the agent workspace.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

import {
  LONDON_COLLAGE_PHOTOS,
  LONDON_COLLAGE_WIDTHS,
  londonCollageSrc,
} from "../../lib/landingLondonCollage.ts";

const DEFAULT_SOURCE = path.join(
  process.env.HOME ?? "",
  "karan-agent-workspace/data/pubmax-landing-london-collage/photos",
);
const PUBLIC_DIR = path.join(process.cwd(), "public");

function parseArgs() {
  const argv = process.argv.slice(2);
  let sourceDir = DEFAULT_SOURCE;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source-dir" && argv[i + 1]) sourceDir = argv[++i];
  }
  return { sourceDir };
}

async function assertOutputClean(filePath) {
  const meta = await sharp(filePath).metadata();
  if (meta.exif && meta.exif.length > 0) {
    throw new Error(`${filePath}: EXIF block must be empty after encode`);
  }
}

function publicPath(src) {
  return path.join(PUBLIC_DIR, src.replace(/^\//, ""));
}

async function main() {
  const { sourceDir } = parseArgs();
  const manifest = [];

  for (const photo of LONDON_COLLAGE_PHOTOS) {
    const base = sharp(path.join(sourceDir, photo.source), { failOn: "none" }).rotate(); // auto-orient, then strip on write
    let encoded = null;

    for (const width of LONDON_COLLAGE_WIDTHS) {
      const pipeline = base.clone().resize({ width, withoutEnlargement: true });
      const avifPath = publicPath(londonCollageSrc(photo, width, "avif"));
      const webpPath = publicPath(londonCollageSrc(photo, width, "webp"));
      await mkdir(path.dirname(avifPath), { recursive: true });
      await pipeline.clone().avif({ quality: 50, effort: 6 }).toFile(avifPath);
      encoded = await pipeline.clone().webp({ quality: 72 }).toFile(webpPath);
      await assertOutputClean(avifPath);
      await assertOutputClean(webpPath);
    }

    const blur = await base
      .clone()
      .resize({ width: 24 })
      .webp({ quality: 40 })
      .toBuffer();

    manifest.push({
      id: photo.id,
      width: encoded.width,
      height: encoded.height,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    });
    console.error(`ok ${photo.id} (${encoded.width}x${encoded.height})`);
  }

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
