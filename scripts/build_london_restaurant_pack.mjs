// Build the London RESTAURANT pack: every `restaurant` row of the published
// London venue shards (public/data/london_venues/), in one file the map can
// read once.
//
// WHY ONE FILE AND NOT THE SHARDS. The map draws these restaurants from zoom 12,
// and a phone at zoom 12 over central London covers about 48 of the 0.025°
// cells once the read is padded. Those cells are mostly cafes: the fattest is
// 84 KB, so reading them to draw a few restaurants would cost the map over a
// megabyte. The 1,094 restaurant rows alone are about 118 KB, or 37 KB on the
// wire, so the map reads them in one request.
//
// WHY A PROJECTION OF THE SHARDS. The shards are the London layer. This pack
// takes their rows as published, so a restaurant here has the same
// `venue-osm-…` id, name, address and position as its shard row, and there is
// one rule about which restaurants count: the one `npm run build:london-venues`
// applies. `__tests__/londonRestaurantPack.test.ts` holds the committed pack to
// the committed shards.
//
// WHY A BOROUGH. Map search finds a curated pin by its borough, so a search for
// Camden keeps Camden's pubs. A shard row names no borough, so each pack row
// gains one: the borough polygon its point falls in, by the same lookup that
// places curated pins (`scripts/lib/boroughFromPoint.mjs`), or "" outside
// every borough.
//
// WHY ITS OWN DIRECTORY. The shard publisher deletes every *.json in its own
// root that is not manifest.json (public/data/london_desks/README.md says the
// same about the desk pack).
//
// Run: node scripts/build_london_restaurant_pack.mjs   (`npm run build:london-restaurants`)
// `npm run build:london-venues` runs it after every shard publish.
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boroughForPoint } from "./lib/boroughFromPoint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const RESTAURANT_PACK_DIR_NAME = "london_restaurants";
export const RESTAURANT_PACK_FILE_NAME = "restaurants.json";
export const RESTAURANT_PACK_VERSION = 2;
const RESTAURANT_KIND = "restaurant";
const PUBLIC_DIR = path.join(ROOT, "public");
const LAYER_MANIFEST_PATH = path.join(PUBLIC_DIR, "data", "london_venues", "manifest.json");
const OUT_PATH = path.join(PUBLIC_DIR, "data", RESTAURANT_PACK_DIR_NAME, RESTAURANT_PACK_FILE_NAME);

// One read on a map open. A refresh that doubles the restaurants fails the
// build rather than doubling what every London reader downloads.
const BUDGET_BYTES = 192 * 1024;

/**
 * The restaurant rows of a published layer, in shard order then row order.
 * `readShard(url)` returns a shard body for a manifest URL. Throws when a shard
 * does not hold the row count its manifest entry promises, because a pack cut
 * from a half-written layer would drop restaurants with nothing saying so.
 */
export async function restaurantRowsFromLayer(manifest, readShard) {
  if (typeof manifest?.urlPrefix !== "string" || !Array.isArray(manifest?.shards)) {
    throw new Error("The London venue manifest is malformed.");
  }
  const rows = [];
  for (const shard of manifest.shards) {
    const body = await readShard(`${manifest.urlPrefix}${shard.id}.json`);
    const venues = Array.isArray(body?.venues) ? body.venues : [];
    if (venues.length !== shard.count) {
      throw new Error(
        `London venue shard ${shard.id} holds ${venues.length} rows, its manifest says ${shard.count}.`,
      );
    }
    for (const row of venues) {
      if (Array.isArray(row) && row[5] === RESTAURANT_KIND) rows.push(row);
    }
  }
  const expected = manifest.countsByKind?.[RESTAURANT_KIND];
  if (Number.isInteger(expected) && expected !== rows.length) {
    throw new Error(
      `The London venue shards hold ${rows.length} restaurants, the manifest counts ${expected}.`,
    );
  }
  return rows;
}

/**
 * The pack body: the layer generation it was cut from, and the rows, each the
 * shard row with its borough after it.
 */
export function restaurantPackBody(manifest, rows) {
  return {
    version: RESTAURANT_PACK_VERSION,
    kind: RESTAURANT_KIND,
    layer: manifest.urlPrefix,
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    count: rows.length,
    venues: rows.map((row) => [...row, boroughForPoint(row[3], row[4])]),
  };
}

function publicPathFor(url) {
  return path.join(PUBLIC_DIR, ...url.split("/").filter(Boolean));
}

export async function writeLondonRestaurantPack() {
  const manifest = JSON.parse(await readFile(LAYER_MANIFEST_PATH, "utf8"));
  const rows = await restaurantRowsFromLayer(manifest, async (url) =>
    JSON.parse(await readFile(publicPathFor(url), "utf8")),
  );
  if (rows.length === 0) {
    throw new Error("The London venue shards hold no restaurants - rebuild them with `npm run build:london-venues`.");
  }
  const json = `${JSON.stringify(restaurantPackBody(manifest, rows))}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes > BUDGET_BYTES) {
    throw new Error(`Restaurant pack is ${bytes} bytes, over the ${BUDGET_BYTES} byte budget.`);
  }
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, json);
  console.log(
    `London restaurants → ${rows.length} rows (${(bytes / 1024).toFixed(1)} KB) in ${path.relative(ROOT, OUT_PATH)}`,
  );
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  writeLondonRestaurantPack().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
