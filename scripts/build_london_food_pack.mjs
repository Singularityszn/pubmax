// Build the London FOOD pack: every `food` row of the published London venue
// shards (public/data/london_venues/), in one file.
//
// WHY. A London fast-food counter is a price target for ONE lane: a community
// soft-drink price (lib/londonFoodPlaces.ts owns the rule). Three readers need
// to know which `venue-osm-…` ids are such a counter: the price route, which
// must refuse an id it cannot place (lib/londonFoodIndex.server.ts), the map,
// which opens the counter's sheet for a `?sel=` link, and the soft drinks
// page, which lists London McDonald's under the Lucia lens. The `food` rows are
// a few KB, where the shards they sit in are several MB of cafes, so all three
// read this projection rather than the layer.
//
// WHY A PROJECTION OF THE SHARDS. The shards are the London layer. This pack
// takes their rows as published, so a counter here has the same `venue-osm-…`
// id, name, address and position as its shard row, and there is one rule
// about which counters count: the one `npm run build:london-venues` applies.
// `__tests__/londonFoodPack.test.ts` holds the committed pack to the committed
// shards.
//
// WHY ITS OWN DIRECTORY. The shard publisher deletes every *.json in its own
// root that is not manifest.json.
//
// Run: node scripts/build_london_food_pack.mjs   (`npm run build:london-food`)
// `npm run build:london-venues` runs it after every shard publish.
//
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boroughForPoint } from "./lib/boroughFromPoint.mjs";
import { kindRowsFromLayer } from "./build_london_restaurant_pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const FOOD_PACK_DIR_NAME = "london_food";
export const FOOD_PACK_FILE_NAME = "food.json";
export const FOOD_PACK_VERSION = 1;
const FOOD_KIND = "food";
const PUBLIC_DIR = path.join(ROOT, "public");
const LAYER_MANIFEST_PATH = path.join(PUBLIC_DIR, "data", "london_venues", "manifest.json");
const OUT_PATH = path.join(PUBLIC_DIR, "data", FOOD_PACK_DIR_NAME, FOOD_PACK_FILE_NAME);

// The price route reads this on a cold start, so a widening that grows it past
// a small file fails the build rather than slowing every write.
const BUDGET_BYTES = 64 * 1024;

/** The `food` rows of a published layer, in shard order then row order. */
export function foodRowsFromLayer(manifest, readShard) {
  return kindRowsFromLayer(manifest, readShard, FOOD_KIND);
}

/** The pack body: the layer generation it was cut from, and each row with its borough. */
export function foodPackBody(manifest, rows) {
  return {
    version: FOOD_PACK_VERSION,
    kind: FOOD_KIND,
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

export async function writeLondonFoodPack() {
  const manifest = JSON.parse(await readFile(LAYER_MANIFEST_PATH, "utf8"));
  const rows = await foodRowsFromLayer(manifest, async (url) =>
    JSON.parse(await readFile(publicPathFor(url), "utf8")),
  );
  if (rows.length === 0) {
    throw new Error("The London venue shards hold no food rows - rebuild them with `npm run build:london-venues`.");
  }
  const json = `${JSON.stringify(foodPackBody(manifest, rows))}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes > BUDGET_BYTES) {
    throw new Error(`Food pack is ${bytes} bytes, over the ${BUDGET_BYTES} byte budget.`);
  }
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, json);
  console.log(
    `London food → ${rows.length} rows (${(bytes / 1024).toFixed(1)} KB) in ${path.relative(ROOT, OUT_PATH)}`,
  );
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  writeLondonFoodPack().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
