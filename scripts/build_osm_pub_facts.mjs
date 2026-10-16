#!/usr/bin/env node
// Build the London OSM pub facts pack from the committed raw Overpass chunks.
//
// WHY: data/osm/uk/raw/ holds every tag OSM states for each London pub, and the
// pub normalizer keeps only the few a pin needs. This pack keeps the facts a
// pub sheet prints: opening hours, wheelchair access, live sport, outdoor
// seating, beer garden, real ale, dogs, the menu link, socials, and operator,
// brand and brewery. Each value is the verbatim tag (`readOsmPubFacts`).
//
// LICENCE: the pack is OSM-derived, so it is ODbL 1.0. It is its own file and
// holds nothing from another source, so the share-alike stays inside it. The
// venue routes join it at runtime by OSM id (lib/osmPubFacts.server.ts).
//
// DATES: each row carries `readOn`, the planet day of the chunk it came from,
// and the pack carries `extractedAt`, the oldest chunk stamp it covers. A
// mapper's own `check_date` rides on the row as a tag.
//
// No network. Run after `npm run fetch:uk-pubs` refreshes the raw chunks:
//   npm run build:osm-pub-facts

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OSM_PUB_FACTS_TRACING_INCLUDE } from "../lib/osmPubFactsFile.mjs";
import { GREATER_LONDON_BBOX } from "./fetch_uk_osm_venues.mjs";
import { coveringStamp } from "./lib/coveringStamp.mjs";
import { OSM_PUB_FACT_TAGS, readOsmPubFacts } from "./lib/osmPubNormalizer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "osm", "uk", "raw");
const OUT_PATH = path.join(ROOT, OSM_PUB_FACTS_TRACING_INCLUDE);
const BUDGET_BYTES = 768 * 1024;

export const OSM_PUB_FACTS_LICENCE = {
  name: "ODbL-1.0",
  url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "© OpenStreetMap contributors",
  copyrightUrl: "https://www.openstreetmap.org/copyright",
};

function inBbox(lat, lng, bbox) {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * The pack body for `chunks`, each `{ timestamp, elements }` as a raw Overpass
 * file holds them. Only `amenity=pub` elements inside `bbox` count. A pub two
 * chunks both hold (cells share edges) is kept once, from the first chunk.
 *
 * @param {ReadonlyArray<{ timestamp: unknown, elements: unknown[] }>} chunks
 * @param {readonly number[]} [bbox] south, west, north, east
 */
export function buildOsmPubFacts(chunks, bbox = GREATER_LONDON_BBOX) {
  const seen = new Set();
  const rows = [];
  const stamps = [];
  for (const chunk of chunks) {
    const readOn = typeof chunk.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(chunk.timestamp)
      ? chunk.timestamp.slice(0, 10)
      : null;
    let contributed = false;
    for (const element of chunk.elements) {
      const tags = element?.tags;
      if (tags?.amenity !== "pub") continue;
      const lat = Number(element.lat ?? element.center?.lat);
      const lng = Number(element.lon ?? element.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBbox(lat, lng, bbox)) continue;
      const osmId = `${element.type}/${element.id}`;
      if (seen.has(osmId)) continue;
      seen.add(osmId);
      const facts = readOsmPubFacts(tags);
      if (!facts) continue;
      // An undated chunk cannot date its facts, so it publishes none.
      if (!readOn) continue;
      rows.push({ osmId, readOn, ...facts });
      contributed = true;
    }
    if (contributed) stamps.push(chunk.timestamp);
  }
  rows.sort((a, b) => a.osmId.localeCompare(b.osmId));
  /** @type {Record<string, number>} */
  const fields = {};
  for (const [field] of OSM_PUB_FACT_TAGS) {
    fields[field] = rows.filter((row) => field in row).length;
  }
  return {
    version: 1,
    licence: OSM_PUB_FACTS_LICENCE,
    source: "data/osm/uk/raw (Overpass amenity=pub chunks)",
    bbox: [...bbox],
    extractedAt: coveringStamp(stamps),
    counts: { pubs: seen.size, withFacts: rows.length, fields },
    rows,
  };
}

async function readChunks() {
  const files = (await readdir(RAW_DIR))
    .filter((file) => file.startsWith("chunk_") && file.endsWith(".json"))
    .sort();
  const chunks = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(RAW_DIR, file), "utf8"));
    if (!Array.isArray(raw?.elements)) continue;
    chunks.push({ timestamp: raw?.osm3s?.timestamp_osm_base ?? null, elements: raw.elements });
  }
  return chunks;
}

async function main() {
  const pack = buildOsmPubFacts(await readChunks());
  if (!pack.extractedAt) throw new Error("OSM pub facts: no dated chunk holds a London pub fact.");
  const body = `${JSON.stringify(pack)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > BUDGET_BYTES) {
    throw new Error(`OSM pub facts pack is ${bytes} bytes, over the ${BUDGET_BYTES} budget.`);
  }
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  const tmp = `${OUT_PATH}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, OUT_PATH);
  console.log(
    `Wrote ${pack.counts.withFacts} of ${pack.counts.pubs} London pubs ` +
      `(${(bytes / 1024).toFixed(1)} KB) to ${path.relative(ROOT, OUT_PATH)}`,
  );
  console.log(`extractedAt ${pack.extractedAt}`);
  console.log(`fields ${JSON.stringify(pack.counts.fields)}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
