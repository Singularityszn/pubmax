#!/usr/bin/env node
/**
 * Bounded OSM -> curated promotion for London.
 *
 *   npm run promote:london-osm                  # up to 300 pubs
 *   npm run promote:london-osm -- --limit=50    # fewer; the cap cannot be raised
 *   npm run promote:london-osm -- --dry-run     # print the batch, write nothing
 *
 * Takes pubs out of the committed UK OSM pack (data/osm/uk/uk_osm_pubs.json),
 * so it spends no network and no API credit. Each promoted pub joins
 * public/data/pint_prices_app_dataset.json as an UNPRICED row, exactly as
 * scripts/merge_outer_london_osm.mjs does for the Outer London seed, and is
 * written to data/london_osm_promotion/ledger.json with the OSM id, its own
 * website and the read time, so every promoted pub keeps its evidence.
 *
 * After a promotion: `npm run build:slim` (canonicalize + slim index), then
 * `npm run fetch:uk-pubs -- --from-raw` and `npm run build:uk-base`, so the base
 * layer stops drawing a pub the curated layer now owns.
 *
 * Idempotent: a promoted pub is a duplicate on the next run, so a repeat run
 * moves the next batch rather than the same one.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { indexAppDataset, osmDatasetRow } from "./lib/londonOsmDatasetRows.mjs";
import { PROMOTION_BATCH_CAP, selectPromotions } from "./lib/londonOsmPromotion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UK_PACK_PATH = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const APP_PATH = path.join(ROOT, "public/data/pint_prices_app_dataset.json");
const BOUNDARIES_PATH = path.join(ROOT, "data/london_boroughs_simplified.json");
const LEDGER_PATH = path.join(ROOT, "data/london_osm_promotion/ledger.json");
const DATASET_TAG = "london_osm_promotion";

function readArg(argv, name) {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function atomicWriteJson(filePath, value, pretty) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temp, `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`, "utf8");
  renameSync(temp, filePath);
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const requested = readArg(argv, "--limit");

  const pack = JSON.parse(readFileSync(UK_PACK_PATH, "utf8"));
  const osmPubs = Array.isArray(pack.pubs) ? pack.pubs : [];
  const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
  if (!Array.isArray(app)) throw new Error("app dataset must be an array");
  const boundaries = JSON.parse(readFileSync(BOUNDARIES_PATH, "utf8"));

  const index = indexAppDataset(app);
  const { picked, eligible, limit } = selectPromotions(osmPubs, app, {
    boundaries,
    isDuplicate: index.isDuplicate,
    limit: requested,
  });

  const fetchedAt = typeof pack.fetchedAt === "string" ? pack.fetchedAt : new Date().toISOString();
  const attribution = pack.attribution || "© OpenStreetMap contributors";
  const promotedAt = new Date().toISOString();
  const ledger = existsSync(LEDGER_PATH)
    ? JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
    : { version: 1, source: "OpenStreetMap", licence: "ODbL 1.0", promotions: [] };

  const byBorough = {};
  let added = 0;
  for (const { pub, borough } of picked) {
    const name = String(pub.name).trim();
    const osmId = String(pub.osmId);
    // A pub in this batch that near-duplicates one just accepted is skipped.
    if (index.isDuplicate(osmId, name, Number(pub.lat), Number(pub.lng))) continue;
    index.add(osmId, name, Number(pub.lat), Number(pub.lng));
    index.seq += 1;
    const row = osmDatasetRow({
      seq: index.seq,
      pub,
      borough,
      fetchedAt,
      attribution,
      dataset: DATASET_TAG,
      label: "London OSM promotion.",
    });
    app.push(row);
    ledger.promotions.push({
      osmId,
      name,
      borough,
      lat: Number(pub.lat),
      lng: Number(pub.lng),
      website: String(pub.website).trim(),
      appPriceId: row.app_price_id,
      packFetchedAt: fetchedAt,
      promotedAt,
    });
    byBorough[borough] = (byBorough[borough] ?? 0) + 1;
    added += 1;
  }

  console.log(
    `london OSM promotion: ${eligible} eligible, batch cap ${PROMOTION_BATCH_CAP}, limit ${limit}, ` +
      `${added} promoted${dryRun ? " (dry run, nothing written)" : ""}.`,
  );
  console.log("by borough:", byBorough);
  if (dryRun || added === 0) return;

  atomicWriteJson(APP_PATH, app, false);
  atomicWriteJson(LEDGER_PATH, ledger, true);
  console.log(`app rows now: ${app.length}; ledger rows: ${ledger.promotions.length}`);
}

main();
