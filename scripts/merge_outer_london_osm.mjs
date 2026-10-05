#!/usr/bin/env node
/**
 * Cycle-4 `data/outer-london-osm` — merge the keyless OSM/Overpass seed pack
 * (`data/osm/outer_london_osm_pubs.json`, produced by
 * `scripts/fetch_city_osm_pubs.mjs --london`) into the app dataset JSON, then
 * callers rebuild the slim index (canonicalize:venues → build:slim).
 *
 * Mission: venue PRESENCE for the worst-covered Outer London boroughs. These
 * rows are UNPRICED on purpose — `price_gbp: null` renders an honest pin with no
 * price. Inventing a price is forbidden; a real pub with no price beats no pin.
 *
 * Provenance: every row is stamped source=OpenStreetMap Overpass, the OSM id,
 * and the seed's fetched-at date, mirroring the gazetteer seed conventions.
 *
 * Dedupe: an OSM element already stamped on a row is never added again, because
 * canonicalize:venues later snaps a row's coordinates onto the priced row it
 * merges with, so neither the exact key nor the distance check can see it from
 * the seed's raw OSM point. A cheap name+coord key then blocks re-adding the
 * exact same OSM row, and a strengthened distance + name-similarity check
 * (shared with the canonicalize step) skips an OSM pub that already exists in
 * the dataset under a matching-ish name within a few metres — so a re-fetch
 * never doubles a pin. canonicalize is still the backstop for anything that
 * slips through.
 *
 * Idempotent: re-running with the same seed adds 0 rows. Safe no-op when the
 * seed is missing or empty (e.g. Overpass was unreachable at fetch time).
 *
 * Usage: node scripts/merge_outer_london_osm.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  indexAppDataset,
  inGreaterLondon,
  osmDatasetRow,
} from "./lib/londonOsmDatasetRows.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = join(ROOT, "data/osm/outer_london_osm_pubs.json");
const APP_PATH = join(ROOT, "public/data/pint_prices_app_dataset.json");

function main() {
  if (!existsSync(SEED_PATH)) {
    console.log(`no OSM seed at ${relative(ROOT, SEED_PATH)} — nothing to merge (no-op).`);
    console.log("run `npm run fetch:london-pubs` first (needs Overpass network access).");
    return;
  }
  const seed = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  const pubs = Array.isArray(seed.pubs) ? seed.pubs : [];
  const fetchedAt = typeof seed.fetchedAt === "string" ? seed.fetchedAt : new Date().toISOString();
  const attribution = seed.attribution || "© OpenStreetMap contributors";

  const app = JSON.parse(readFileSync(APP_PATH, "utf8"));
  if (!Array.isArray(app)) throw new Error("app dataset must be an array");

  const index = indexAppDataset(app);
  let added = 0;
  let skippedDup = 0;
  const byBorough = {};

  for (const pub of pubs) {
    const lat = Number(pub.lat ?? pub.latitude);
    const lng = Number(pub.lng ?? pub.longitude);
    const name = String(pub.name ?? pub.pub_name ?? "").trim();
    const borough = String(pub.primary_borough ?? "").trim();
    if (!name || !borough || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!inGreaterLondon(lat, lng)) continue;

    const osmId = String(pub.osmId ?? "");
    if (index.isDuplicate(osmId, name, lat, lng)) {
      skippedDup += 1;
      continue;
    }
    index.add(osmId, name, lat, lng);
    index.seq += 1;
    added += 1;
    byBorough[borough] = (byBorough[borough] ?? 0) + 1;
    app.push(
      osmDatasetRow({
        seq: index.seq,
        pub,
        borough,
        fetchedAt,
        attribution,
        dataset: "outer_london_osm",
        label: "Outer London OSM presence (Cycle 4).",
      }),
    );
  }

  if (added > 0) writeFileSync(APP_PATH, `${JSON.stringify(app)}\n`, "utf8");
  console.log(`merged ${added} OSM pubs into ${relative(ROOT, APP_PATH)} (${skippedDup} skipped as duplicates)`);
  console.log("by borough:", byBorough);
  console.log(`app rows now: ${app.length}`);
}

main();
