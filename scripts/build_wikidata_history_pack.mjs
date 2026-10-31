// Build public/data/wikidata_history/london.json from the Wikidata Query
// Service (https://query.wikidata.org/sparql). Wikidata is CC0 1.0. The query
// service asks every client for a descriptive User-Agent, which this sends,
// and is read one batch at a time, one second apart. Every read goes through
// `wikidataSparqlRead` (scripts/lib/wikidataHistoryPack.mjs): the endpoint
// comes from the `wikidata-query-service` row in lib/harvest/sourceRegistry.ts, a
// redirect is refused, and a 429 or 5xx is retried a bounded number of times.
//
// What it does:
//   1. Reads the QIDs public/data/osm_wikidata/london.json names.
//   2. Asks for their history statements in batches of 100
//      (scripts/lib/wikidataHistoryPack.mjs owns the query and its fences:
//      a pub, never a brand; best and normal rank only).
//   3. Writes the compact pack. A failed batch stops the run and writes
//      nothing, so a partial read never ships as a thin pack.
//
// Run: npm run build:wikidata-history [-- --dry-run]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildWikidataHistoryPack, historyQuery, wantedQids, wikidataSparqlRead } from "./lib/wikidataHistoryPack.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINKS_PATH = path.join(ROOT, "public", "data", "osm_wikidata", "london.json");
const OUT_PATH = path.join(ROOT, "public", "data", "wikidata_history", "london.json");
const BATCH = 100;
const DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const wanted = wantedQids(JSON.parse(await readFile(LINKS_PATH, "utf8")));
  const qids = [...wanted].sort();
  const retrievedAt = new Date().toISOString();
  const bindings = [];
  for (let start = 0; start < qids.length; start += BATCH) {
    if (start > 0) await sleep(DELAY_MS);
    bindings.push(...(await wikidataSparqlRead(historyQuery(qids.slice(start, start + BATCH)), { sleep })));
    console.log(`read ${Math.min(start + BATCH, qids.length)} of ${qids.length} items`);
  }
  const pack = buildWikidataHistoryPack({ wanted, bindings, retrievedAt });
  console.log(JSON.stringify(pack.counts));
  if (process.argv.includes("--dry-run")) return;
  await writeFile(OUT_PATH, `${JSON.stringify(pack, null, 1)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${pack.counts.withHistory} items)`);
}

await main();
