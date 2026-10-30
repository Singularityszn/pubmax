#!/usr/bin/env node
// Build the two small packs Last orders reads on /tonight.
//
// WHY: Last orders answers "which pubs near me are still open, and for how
// long". The hours are OSM's own `opening_hours` tag (data/osm/facts), the
// positions are the OSM pub layer (data/osm/uk/uk_osm_pubs.json), and the
// price is the curated venue index's cheapest pint (public/data/venues_slim.json).
// The browser reads these packs only when a reader opens Last orders, so no
// page pays for them up front.
//
// LICENCE: `london_hours.json` holds OSM data and nothing else, so it is ODbL
// 1.0 and the share-alike stays inside it. The one non-OSM value it carries is
// the curated venue id a pub is linked to, so a row opens the same map pin.
// `london_prices.json` is the curated price beside it, a separate file keyed
// by that id, never merged into the OSM rows.
//
// HONESTY: a pub with no `opening_hours` tag is left out, never given hours. A
// pub Google verified as closed (data/places_verification/closed_pubs.json) is
// left out. The hours string is copied verbatim; lib/lastOrders.ts reads it.
//
// No network. Run after `npm run build:osm-pub-facts` or a venue index rebuild:
//   npm run build:last-orders

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACTS_PATH = path.join(ROOT, "data", "osm", "facts", "london_pub_facts.json");
const PUBS_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const CLOSED_PATH = path.join(ROOT, "data", "places_verification", "closed_pubs.json");
const OUT_DIR = path.join(ROOT, "public", "data", "last_orders");
export const LAST_ORDERS_HOURS_FILE = "london_hours.json";
export const LAST_ORDERS_PRICES_FILE = "london_prices.json";
const BUDGET_BYTES = 192 * 1024;

/** `node/123` → `n123`: the compaction the London venue shards use. */
function compactOsmRef(osmId) {
  const raw = String(osmId ?? "");
  if (raw.startsWith("node/")) return `n${raw.slice(5)}`;
  if (raw.startsWith("way/")) return `w${raw.slice(4)}`;
  if (raw.startsWith("relation/")) return `r${raw.slice(9)}`;
  return "";
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Both pack bodies. Pure, so the test can hand it small inputs.
 *
 * @param {{
 *   facts: { extractedAt?: string, rows: Array<{ osmId: string, openingHours?: string, hoursCheckDate?: string }> },
 *   pubs: Array<{ osmId?: string, name?: string, lat?: number, lng?: number, curatedRef?: { source?: string, id?: string } }>,
 *   slimRows: Array<{ id?: string, cheapestPrice?: number, priceObservedAt?: string }>,
 *   closed: { osmRefs?: string[], curatedVenueIds?: string[] },
 * }} input
 */
export function buildLastOrdersPacks({ facts, pubs, slimRows, closed }) {
  const closedRefs = new Set(closed.osmRefs ?? []);
  const closedIds = new Set(closed.curatedVenueIds ?? []);
  const slimById = new Map(slimRows.filter((row) => typeof row.id === "string").map((row) => [row.id, row]));
  const hoursByOsmId = new Map();
  for (const row of facts.rows) {
    if (typeof row.openingHours === "string" && row.openingHours.trim()) hoursByOsmId.set(row.osmId, row);
  }

  const rows = [];
  const prices = {};
  const seen = new Set();
  for (const pub of pubs) {
    const fact = hoursByOsmId.get(pub.osmId);
    if (!fact || seen.has(pub.osmId)) continue;
    if (typeof pub.name !== "string" || !pub.name.trim()) continue;
    if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lng)) continue;
    const ref = compactOsmRef(pub.osmId);
    if (!ref || closedRefs.has(ref)) continue;
    const curatedId = pub.curatedRef?.source === "curated-london-slim" && typeof pub.curatedRef.id === "string"
      && slimById.has(pub.curatedRef.id)
      ? pub.curatedRef.id
      : null;
    if (curatedId && closedIds.has(curatedId)) continue;
    const id = curatedId ?? `venue-osm-${ref}`;
    if (seen.has(id)) continue;
    seen.add(pub.osmId);
    seen.add(id);
    rows.push([id, pub.name.trim(), round5(pub.lat), round5(pub.lng), fact.openingHours.trim(), fact.hoursCheckDate ?? ""]);
    const slim = curatedId ? slimById.get(curatedId) : null;
    if (slim && typeof slim.cheapestPrice === "number" && Number.isFinite(slim.cheapestPrice)) {
      prices[id] = [slim.cheapestPrice, typeof slim.priceObservedAt === "string" ? slim.priceObservedAt : ""];
    }
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const readOn = typeof facts.extractedAt === "string" ? facts.extractedAt.slice(0, 10) : "";
  return {
    hours: {
      version: 1,
      license: "ODbL 1.0",
      source: "OpenStreetMap",
      attribution: "© OpenStreetMap contributors",
      readOn,
      columns: ["venueId", "name", "lat", "lng", "openingHours", "hoursCheckDate"],
      rows,
    },
    prices: {
      version: 1,
      source: "PUBMAXX curated venue index, cheapest listed pint",
      columns: ["priceGbp", "observedAt"],
      rows: Object.fromEntries(Object.entries(prices).sort(([a], [b]) => (a < b ? -1 : 1))),
    },
  };
}

async function writeAtomic(file, body) {
  const text = `${JSON.stringify(body)}\n`;
  if (Buffer.byteLength(text) > BUDGET_BYTES) {
    throw new Error(`${path.basename(file)} is ${Buffer.byteLength(text)} bytes, over the ${BUDGET_BYTES} budget.`);
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function main() {
  const [facts, pubsFile, slim, closed] = await Promise.all(
    [FACTS_PATH, PUBS_PATH, SLIM_PATH, CLOSED_PATH].map(async (file) => JSON.parse(await readFile(file, "utf8"))),
  );
  const slimRows = Array.isArray(slim) ? slim : slim.rows;
  const { hours, prices } = buildLastOrdersPacks({ facts, pubs: pubsFile.pubs, slimRows, closed });
  await mkdir(OUT_DIR, { recursive: true });
  await writeAtomic(path.join(OUT_DIR, LAST_ORDERS_HOURS_FILE), hours);
  await writeAtomic(path.join(OUT_DIR, LAST_ORDERS_PRICES_FILE), prices);
  console.log(`last orders: ${hours.rows.length} pubs with OSM hours, ${Object.keys(prices.rows).length} with a listed pint.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
