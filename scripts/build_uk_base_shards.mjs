// Build the UK BASE-PUB shards the map streams per viewport, from the UK-wide
// OSM seed pack (data/osm/uk/uk_osm_pubs.json — see its README).
//
// WHY SHARDS AND NOT THE SLIM INDEX. The slim index (venues_slim*.json) is the
// CURATED experience: priced pins, search, filters, crawl routing. Folding
// ~35k unpriced OSM pubs into it would ship ~20 MB to every phone to render a
// layer nobody has priced yet. So the base layer is a SEPARATE, second-class
// dataset with its own delivery: a tiny manifest plus one small file per grid
// cell, fetched only for the cells the camera is actually over, and only once
// the camera is zoomed in far enough for individual pins to exist at all
// (lib/ukBasePubs.ts owns the client half; UK_BASE_MIN_ZOOM owns the gate).
//
// WHAT IS DROPPED. Every pub carrying `curatedRef` — the pack's own record that
// the venue is already in venues_slim / a city pack. Curated wins: a deduped
// pub must exist on the map exactly once, as its curated pin.
//
// PRICES. None. OSM is not a price source (data/osm/uk/README.md). A base pub
// has no price by construction; it is the canvas the community prices in.
//
// Run: node scripts/build_uk_base_shards.mjs   (wired into `npm run prebuild`)

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHARD_DIR_NAME,
  UK_BASE_GRID,
  UK_BASE_SHARD_VERSION,
  cellIndexFor,
  cellKey,
  cellBbox,
  shardUrlForCell,
} from "./lib/ukBaseGrid.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const OUT_DIR = path.join(ROOT, "public", "data", SHARD_DIR_NAME);
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

// Per-shard ceiling. A cell is one viewport-triggered fetch, so a fat cell is
// felt directly as a stall while panning. The densest cell today (central
// London) sits well under this; a refresh that crosses it means the grid needs
// splitting, not a bigger allowance.
const SHARD_BUDGET_BYTES = 150 * 1024;
// Whole-layer ceiling, so a refresh that doubles the dataset fails CI rather
// than quietly doubling the repository and the cache footprint.
const TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
// The manifest is fetched in full the first time the camera crosses the zoom
// gate, so it is a real (if deferred) payload line and gets its own budget.
const MANIFEST_BUDGET_BYTES = 64 * 1024;

/** OSM "node/123" → the compact "n123" the shard rows carry. */
export function compactOsmRef(osmId) {
  const [type, id] = String(osmId ?? "").split("/");
  if (!id) return "";
  if (type === "node") return `n${id}`;
  if (type === "way") return `w${id}`;
  if (type === "relation") return `r${id}`;
  return "";
}

/** 5 dp ≈ 1.1 m — finer than the building the pub sits in, and 6 bytes shorter. */
function round5(value) {
  return Math.round(value * 1e5) / 1e5;
}

function isRenderablePub(pub) {
  return (
    typeof pub?.name === "string" &&
    pub.name.trim().length > 0 &&
    Number.isFinite(pub?.lat) &&
    Number.isFinite(pub?.lng) &&
    compactOsmRef(pub?.osmId) !== ""
  );
}

/** One shard row: [osmRef, name, address, lat, lng] — see lib/ukBasePubs.ts. */
function toRow(pub) {
  return [
    compactOsmRef(pub.osmId),
    pub.name.trim(),
    typeof pub.address === "string" ? pub.address.trim() : "",
    round5(pub.lat),
    round5(pub.lng),
  ];
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  const pubs = Array.isArray(pack?.pubs) ? pack.pubs : [];
  if (pubs.length === 0) {
    throw new Error(`${PACK_PATH} has no pubs — refresh it with npm run fetch:uk-pubs`);
  }

  // Curated wins, always: a pub the pack already matched to venues_slim or a
  // city pack renders as its curated pin and must not gain a second, dimmer one.
  const deduped = pubs.filter((pub) => !pub.curatedRef);
  const renderable = deduped.filter(isRenderablePub);
  const skipped = deduped.length - renderable.length;

  /** @type {Map<string, {latIndex: number, lonIndex: number, rows: unknown[][]}>} */
  const cells = new Map();
  for (const pub of renderable) {
    const { latIndex, lonIndex } = cellIndexFor(pub.lat, pub.lng);
    const key = cellKey(latIndex, lonIndex);
    let cell = cells.get(key);
    if (!cell) {
      cell = { latIndex, lonIndex, rows: [] };
      cells.set(key, cell);
    }
    cell.rows.push(toRow(pub));
  }

  // A stale cell from an earlier, denser refresh would keep being fetched and
  // would keep painting pubs the pack no longer has. Clear every generated body
  // first — but only the JSON, so the directory's README (hand-written, not
  // generated) survives a rebuild.
  await mkdir(OUT_DIR, { recursive: true });
  for (const file of await readdir(OUT_DIR)) {
    if (file.endsWith(".json")) await rm(path.join(OUT_DIR, file));
  }

  const shards = [];
  const shardBytes = [];
  let totalBytes = 0;
  let fattest = { id: "", bytes: 0, count: 0 };

  // Sorted so the manifest (and the diff of every refresh) is deterministic.
  for (const key of [...cells.keys()].sort()) {
    const cell = cells.get(key);
    // Within a cell, south→north keeps rows in a stable, reviewable order.
    cell.rows.sort((a, b) => a[3] - b[3] || a[4] - b[4] || String(a[0]).localeCompare(String(b[0])));
    const body = JSON.stringify({
      version: UK_BASE_SHARD_VERSION,
      cell: key,
      pubs: cell.rows,
    });
    const bytes = Buffer.byteLength(body);
    totalBytes += bytes;
    shardBytes.push(bytes);
    if (bytes > fattest.bytes) fattest = { id: key, bytes, count: cell.rows.length };
    if (bytes > SHARD_BUDGET_BYTES) {
      throw new Error(
        `Shard ${key} is ${formatBytes(bytes)} (${cell.rows.length} pubs), over the ` +
          `${formatBytes(SHARD_BUDGET_BYTES)} per-viewport budget. Split UK_BASE_GRID rather than raising it.`,
      );
    }
    await writeFile(path.join(OUT_DIR, `${key}.json`), body);
    shards.push({
      id: key,
      // Every base shard is lazy — there is no eager "core" in this layer, which
      // is exactly what keeps the curated first paint unchanged. The field is
      // kept so the manifest parses as the shared ShardManifest (lib/slimShards).
      core: false,
      url: shardUrlForCell(key),
      count: cell.rows.length,
      bbox: cellBbox(cell.latIndex, cell.lonIndex),
    });
  }

  const manifestBody = JSON.stringify({
    version: UK_BASE_SHARD_VERSION,
    grid: UK_BASE_GRID,
    generatedFrom: { fetchedAt: pack.fetchedAt ?? null, count: pack.count ?? pubs.length },
    shards,
  });
  const manifestBytes = Buffer.byteLength(manifestBody);
  if (manifestBytes > MANIFEST_BUDGET_BYTES) {
    throw new Error(
      `Manifest is ${formatBytes(manifestBytes)}, over the ${formatBytes(MANIFEST_BUDGET_BYTES)} budget.`,
    );
  }
  if (totalBytes > TOTAL_BUDGET_BYTES) {
    throw new Error(
      `UK base shards total ${formatBytes(totalBytes)}, over the ${formatBytes(TOTAL_BUDGET_BYTES)} budget.`,
    );
  }
  await writeFile(MANIFEST_PATH, manifestBody);

  console.log(
    [
      `UK base pubs → ${shards.length} shards in public/data/${SHARD_DIR_NAME}/`,
      `  pack ................ ${pubs.length} pubs`,
      `  curated (dropped) ... ${pubs.length - deduped.length}`,
      `  unusable (dropped) .. ${skipped}`,
      `  shipped ............. ${renderable.length}`,
      `  manifest ............ ${formatBytes(manifestBytes)} (deferred until the zoom gate)`,
      `  shards total ........ ${formatBytes(totalBytes)}`,
      `  fattest shard ....... ${fattest.id} — ${formatBytes(fattest.bytes)} (${fattest.count} pubs)`,
      `  median shard ........ ${formatBytes(median(shardBytes))}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
