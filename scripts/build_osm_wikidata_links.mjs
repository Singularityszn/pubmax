// Build public/data/osm_wikidata/london.json from the COMMITTED UK Overpass
// snapshot (data/osm/uk/raw/*.json). It fetches nothing: re-run it after
// `npm run fetch:uk-pubs` refreshes the snapshot. The rule is in
// scripts/lib/osmWikidataLinks.mjs; Wikidata's statements are their own pack.
//
// Run: npm run build:osm-wikidata-links [-- --dry-run]

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOsmWikidataLinks } from "./lib/osmWikidataLinks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "osm", "uk", "raw");
const CHUNKS_PATH = path.join(ROOT, "data", "osm", "uk", "chunks.json");
const SEED_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const OUT_PATH = path.join(ROOT, "public", "data", "osm_wikidata", "london.json");

async function main() {
  const files = (await readdir(RAW_DIR)).filter((file) => file.endsWith(".json")).sort();
  const chunks = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(RAW_DIR, file), "utf8"))));
  const manifest = JSON.parse(await readFile(CHUNKS_PATH, "utf8"));
  const seed = JSON.parse(await readFile(SEED_PATH, "utf8"));
  if (typeof manifest.generatedAt !== "string") throw new Error(`${CHUNKS_PATH} carries no generatedAt`);
  const pack = buildOsmWikidataLinks({ chunks, seedPubs: seed.pubs, fetchedAt: manifest.generatedAt });
  console.log(JSON.stringify(pack.counts));
  if (process.argv.includes("--dry-run")) return;
  // One link per line keeps the diff of a refresh readable.
  const { links, ...head } = pack;
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, "");
  const rows = links.map((link) => `    ${JSON.stringify(link)}`).join(",\n");
  await writeFile(OUT_PATH, `${body},\n  "links": [\n${rows}\n  ]\n}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${links.length} links)`);
}

await main();
