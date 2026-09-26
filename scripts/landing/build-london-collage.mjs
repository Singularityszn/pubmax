#!/usr/bin/env node
// Encode the founder's London photographs for the landing collage.
//
// Run by hand when a photograph joins the set (scripts/AGENTS.md: curation, not
// build). Strips every byte of EXIF/GPS/device metadata, then writes responsive
// AVIF/WebP under public/landing/london-collage/.
//
// Usage:
//   node scripts/landing/build-london-collage.mjs [--source-dir <dir>] [--only <id>]
//
// Default source dir: the captain's hand-off folder beside the agent workspace.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

const DEFAULT_SOURCE = path.join(
  process.env.HOME ?? "",
  "karan-agent-workspace/data/pubmax-landing-london-collage/photos",
);
const OUT_DIR = path.join(process.cwd(), "public", "landing", "london-collage");
const WIDTHS = [640, 1280];

/** One row in lib/landingLondonCollage.ts — keep ids in sync. */
const PHOTOS = [
  {
    id: "southwark-shard",
    source: "london-1.jpg",
    caption: "Southwark",
    alt: "The Shard seen down a Southwark street under a mackerel sky, London",
    layout: "tall",
  },
  {
    id: "canary-wharf-night",
    source: "london-2.jpg",
    caption: "Canary Wharf",
    alt: "Canary Wharf at night with lit towers, the Caravan terrace and string lights, London",
    layout: "wide",
  },
  {
    id: "canary-wharf-rooftop",
    source: "london-3.jpg",
    caption: "Canary Wharf",
    alt: "Canary Wharf from a rooftop at golden hour over the Crossrail Place glass roof, London",
    layout: "hero",
  },
  {
    id: "crown-tavern",
    source: "london-4.jpg",
    caption: "The Crown Tavern",
    alt: "A tree-lined London square with The Crown Tavern on the corner in summer",
    layout: "standard",
  },
  {
    id: "exhibition-road",
    source: "london-5.jpg",
    caption: "Exhibition Road",
    alt: "The Geological Museum entrance on Exhibition Road with people sitting outside, London",
    layout: "standard",
  },
];

function parseArgs() {
  const argv = process.argv.slice(2);
  let sourceDir = DEFAULT_SOURCE;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source-dir" && argv[i + 1]) sourceDir = argv[++i];
    else if (argv[i] === "--only" && argv[i + 1]) only = argv[++i];
  }
  return { sourceDir, only };
}

async function assertOutputClean(filePath) {
  const meta = await sharp(filePath).metadata();
  if (meta.exif && meta.exif.length > 0) {
    throw new Error(`${filePath}: EXIF block must be empty after encode`);
  }
}

async function main() {
  const { sourceDir, only } = parseArgs();
  const wanted = only ? PHOTOS.filter((p) => p.id === only) : PHOTOS;
  if (wanted.length === 0) throw new Error(`No collage photo with id ${only}`);

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];

  for (const photo of wanted) {
    const inputPath = path.join(sourceDir, photo.source);
    const bytes = await readFile(inputPath);

    const base = sharp(bytes, { failOn: "none" }).rotate(); // auto-orient, then strip on write
    const meta = await base.metadata();
    const srcW = meta.width ?? 1280;
    const srcH = meta.height ?? 720;

    for (const width of WIDTHS) {
      const scale = Math.min(1, width / srcW);
      const outW = Math.round(srcW * scale);
      const outH = Math.round(srcH * scale);
      const pipeline = base.clone().resize(outW, outH, { fit: "inside", withoutEnlargement: true });
      const avifPath = path.join(OUT_DIR, `${photo.id}-${width}.avif`);
      const webpPath = path.join(OUT_DIR, `${photo.id}-${width}.webp`);
      await pipeline.clone().avif({ quality: 50, effort: 6 }).toFile(avifPath);
      await pipeline.clone().webp({ quality: 72 }).toFile(webpPath);
      await assertOutputClean(avifPath);
      await assertOutputClean(webpPath);
    }

    const blur = await base
      .clone()
      .resize(24, Math.round(24 * (srcH / srcW)), { fit: "inside" })
      .webp({ quality: 40 })
      .toBuffer();

    const displayW = WIDTHS[WIDTHS.length - 1];
    const displayH = Math.round(displayW * (srcH / srcW));

    manifest.push({
      id: photo.id,
      caption: photo.caption,
      alt: photo.alt,
      layout: photo.layout,
      width: displayW,
      height: displayH,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    });
    console.error(`ok ${photo.id} (${srcW}x${srcH})`);
  }

  await writeFile(
    path.join(OUT_DIR, "README.md"),
    `# Founder London collage

Encoded by \`scripts/landing/build-london-collage.mjs\`. Metadata is stripped on
encode; originals never enter the repo. Manifest lives in
\`lib/landingLondonCollage.ts\`.
`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
