#!/usr/bin/env node
// Build the zoomed-out overview of the UK base layer: one point per published
// shard, at the mean position of the rows in it, with the row count.
//
// Below UK_BASE_MIN_ZOOM the map fetches no shard, so without this file the
// country reads as empty while it holds tens of thousands of pubs. The client
// clusters these points into count bubbles (lib/ukBaseOverview.ts). It reads
// the PUBLISHED shards rather than the OSM packs, so a bubble counts exactly
// the rows a reader finds after zooming in. No price is derived from it.
//
// Run after scripts/build_uk_base_shards.mjs (wired into `npm run build:uk-base`).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildUkBaseOverview, UK_BASE_OVERVIEW_BUDGET_BYTES } from "./lib/ukBaseOverview.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_DIR = path.join(ROOT, "public", "data", "uk_base");
const OUTPUT_PATH = path.join(BASE_DIR, "overview.json");

async function main() {
  const manifest = JSON.parse(await readFile(path.join(BASE_DIR, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.shards) {
    const file = path.join(ROOT, "public", `${manifest.urlPrefix}${shard.id}.json`);
    const body = JSON.parse(await readFile(file, "utf8"));
    shards.push({ id: shard.id, rows: body.pubs });
  }
  const overview = buildUkBaseOverview(manifest, shards);
  const body = `${JSON.stringify(overview)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > UK_BASE_OVERVIEW_BUDGET_BYTES) {
    throw new Error(
      `UK base overview is ${(bytes / 1024).toFixed(1)} KB, over the ` +
        `${UK_BASE_OVERVIEW_BUDGET_BYTES / 1024} KB budget`,
    );
  }
  await mkdir(BASE_DIR, { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporaryPath, body);
  await rename(temporaryPath, OUTPUT_PATH);
  console.log(
    `UK base overview → ${overview.cells.length} points, ${overview.count} venues, ${(bytes / 1024).toFixed(1)} KB`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
