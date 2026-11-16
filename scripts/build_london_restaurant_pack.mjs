// Project the London venue shards into restaurant-only response chunks.
// Tags come from the same OSM snapshot that supplies the restaurant rows.
// Run: npm run build:london-restaurants (also run by build:london-venues).
// OSM data is © OpenStreetMap contributors, ODbL 1.0.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publishStagedDirectory } from "./lib/atomicDirectoryPublish.mjs";
import { boroughForPoint } from "./lib/boroughFromPoint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const RESTAURANT_PACK_DIR_NAME = "london_restaurants";
export const RESTAURANT_PACK_FILE_NAME = "manifest.json";
export const RESTAURANT_PACK_VERSION = 3;
const RESTAURANT_KIND = "restaurant";
const PUBLIC_DIR = path.join(ROOT, "public");
const LAYER_MANIFEST_PATH = path.join(PUBLIC_DIR, "data", "london_venues", "manifest.json");
const OUT_DIR = path.join(PUBLIC_DIR, "data", RESTAURANT_PACK_DIR_NAME);

// Keep each response within the existing restaurant response budget.
const BUDGET_BYTES = 192 * 1024;

/**
 * The restaurant rows of a published layer, in shard order then row order.
 * `readShard(url)` returns a shard body for a manifest URL.
 */
export function restaurantRowsFromLayer(manifest, readShard) {
  return kindRowsFromLayer(manifest, readShard, RESTAURANT_KIND);
}

/**
 * The rows of one kind in a published layer, in shard order then row order.
 * Throws when a shard does not hold the row count its manifest entry promises,
 * or when the kind's total disagrees with `countsByKind`, because a pack cut
 * from a half-written layer would drop places with nothing saying so.
 */
export async function kindRowsFromLayer(manifest, readShard, kind) {
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
      if (Array.isArray(row) && row[5] === kind) rows.push(row);
    }
  }
  const expected = manifest.countsByKind?.[kind];
  if (Number.isInteger(expected) && expected !== rows.length) {
    throw new Error(
      `The London venue shards hold ${rows.length} ${kind} rows, the manifest counts ${expected}.`,
    );
  }
  return rows;
}

/**
 * The pack body: the layer generation it was cut from, and the rows, each the
 * shard row with its borough after it.
 */
export function restaurantPackBody(manifest, rows, facts = new Map()) {
  return {
    version: RESTAURANT_PACK_VERSION,
    kind: RESTAURANT_KIND,
    layer: manifest.urlPrefix,
    license: "ODbL",
    attribution: "© OpenStreetMap contributors",
    observedAt: manifest.restaurantSnapshot?.fetchedAt ?? null,
    count: rows.length,
    venues: [...rows].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map((row) => {
      const tags = facts.get(row[0]);
      return [...row, boroughForPoint(row[3], row[4]), tags?.cuisine ?? "", tags?.openingHours ?? ""];
    }),
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
  const snapshot = JSON.parse(await readFile(path.join(ROOT, "data", "osm", "uk", "london_osm_restaurants.json"), "utf8"));
  if (snapshot.fetchedAt !== manifest.restaurantSnapshot?.fetchedAt || rows.length !== snapshot.venues.length) {
    throw new Error("The restaurant snapshot changed - run npm run build:london-venues first.");
  }
  const facts = new Map(snapshot.venues.map((venue) => [
    venue.osmId.replace("node/", "n").replace("way/", "w").replace("relation/", "r"), venue,
  ]));
  if (rows.some((row) => facts.get(row[0])?.amenity !== "restaurant")) {
    throw new Error("A restaurant row has no matching OSM amenity=restaurant snapshot record.");
  }
  await mkdir(path.dirname(OUT_DIR), { recursive: true });
  const stagedDir = await mkdtemp(path.join(path.dirname(OUT_DIR), ".london-restaurants-stage-"));
  try {
    const { venues, ...header } = restaurantPackBody(manifest, rows, facts);
    const shards = [];
    const overhead = Buffer.byteLength(JSON.stringify({ ...header, venues: [] })) + 32;
    let bytes = overhead;
    let chunk = [];
    async function writeChunk() {
      const id = String(shards.length);
      const json = JSON.stringify({ ...header, count: chunk.length, venues: chunk });
      if (Buffer.byteLength(json) > BUDGET_BYTES) throw new Error("Restaurant chunk exceeds its response budget.");
      await writeFile(path.join(stagedDir, `${id}.json`), json);
      shards.push({ id, count: chunk.length, firstId: chunk[0][0], lastId: chunk.at(-1)[0] });
      chunk = [];
      bytes = overhead;
    }
    for (const row of venues) {
      const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (bytes + rowBytes > BUDGET_BYTES) {
        if (!chunk.length) throw new Error("One restaurant exceeds the response budget.");
        await writeChunk();
      }
      chunk.push(row);
      bytes += rowBytes;
    }
    if (chunk.length) await writeChunk();
    await writeFile(path.join(stagedDir, "manifest.json"), JSON.stringify({
      ...header, urlPrefix: "/data/london_restaurants/", shards,
    }));
    const publication = await publishStagedDirectory({
      stagedDir, targetDir: OUT_DIR, urlPrefix: "/data/london_restaurants/",
      manifestBudgetBytes: 64 * 1024, totalBudgetBytes: 5 * 1024 * 1024,
    });
    console.log(`London restaurants → ${rows.length} OSM rows, ${shards.length} chunks, ${publication.totalBytes} bytes`);
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  writeLondonRestaurantPack().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
