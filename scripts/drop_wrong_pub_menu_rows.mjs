#!/usr/bin/env node
/**
 * Drop every published drink price row whose menu page belongs to another pub.
 *
 *   npm run prices:drop-wrong-pub            # rewrite latest.json
 *   npm run prices:drop-wrong-pub -- --check # exit 1 if any row would go
 *
 * The owner of a page is the pub that states it as its own website (OSM or
 * Google Places, see scripts/lib/menuPageOwners.mjs). A row is dropped only when
 * that owner is known and stands more than MENU_OWNER_MAX_METRES from the pub the
 * row was matched to. It fetches nothing and keeps `generatedAt`, because
 * removing a row observes nothing new. Rebuild the bundle after a rewrite:
 * `npm run build:uk-price-bundle`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MENU_OWNER_MAX_METRES,
  menuOwnerVerdict,
  readMenuPageOwners,
  venueKeyPoint,
} from "./lib/menuPageOwners.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LATEST = join(ROOT, "public", "data", "drink_price_updates", "latest.json");

const check = process.argv.includes("--check");
const payload = JSON.parse(readFileSync(LATEST, "utf8"));
const owners = readMenuPageOwners(ROOT);

const kept = [];
const dropped = new Map();
for (const row of payload.updates ?? []) {
  const verdict = menuOwnerVerdict(row.source?.url, venueKeyPoint(row.venueKey), owners);
  if (verdict.verdict !== "other-pub") {
    kept.push(row);
    continue;
  }
  const line = `${row.venueKey.split("|")[0]} <- ${row.source.url} (${verdict.owner.name}, ${verdict.metres} m)`;
  dropped.set(line, (dropped.get(line) ?? 0) + 1);
}

const droppedRows = [...dropped.values()].reduce((sum, n) => sum + n, 0);
for (const [line, n] of dropped) console.log(`${String(n).padStart(4)} ${line}`);
console.log(
  `${droppedRows} rows on ${dropped.size} pubs carry a menu whose own pub is over ${MENU_OWNER_MAX_METRES} m away.`,
);

if (check) {
  process.exit(droppedRows ? 1 : 0);
} else if (droppedRows) {
  writeFileSync(LATEST, `${JSON.stringify({ ...payload, updates: kept }, null, 2)}\n`);
  console.log(`Wrote ${kept.length} rows to public/data/drink_price_updates/latest.json.`);
}
