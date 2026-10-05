// Build the UK BASE shards the map streams per viewport, from the two UK-wide
// OSM seed packs: every `amenity=pub` (data/osm/uk/uk_osm_pubs.json) and every
// `amenity=bar` (the `bar` kind of data/osm/uk/uk_osm_venues_drink.json,
// see data/osm/uk/VENUES.md for what earns a row in each).
//
// A bar row carries "bar" as a seventh tuple element. A pub row carries six
// elements exactly as before, so folding bars in leaves every pub row's bytes
// untouched and no reader has to be taught a new shape to keep working.
//
// WHY SHARDS AND NOT THE SLIM INDEX. The slim index (venues_slim*.json) is the
// CURATED experience: priced pins, search, filters, crawl routing. Folding
// the country-wide unpriced OSM pack into it would impose that whole payload on
// every phone and leak unverified pubs into curated product systems. So the
// base layer is a separate dataset with its own delivery: a compact manifest
// plus one file per grid cell, fetched only for cells the camera is over and
// only once the camera is zoomed in far enough for individual pins to exist
// (lib/ukBasePubs.ts owns the client half; UK_BASE_MIN_ZOOM owns the gate).
//
// DEDUPE. A matched pub stays in its shard with the owning curated venue id.
// The client suppresses it only while that exact curated venue is drawable.
//
// Ownership is answered twice, in this order. First the `curatedRef` the UK
// seed pack carries, which is the only key that can reconcile datasets with no
// OSM ids at all (curated London) or two OSM objects for one pub. Then, for a
// city pack PROMOTED out of this same base layer, the pub's own OSM id — an
// exact identity, and the one that lets a new area ship without refetching the
// country to re-annotate it. Nothing is removed from the base layer either
// way, so a `venue-uk-…` id stays resolvable.
//
// REMOVAL. A refresh that drops an OSM object drops its `venue-uk-…` id. Each
// build compares the rows it publishes with the rows already published and
// records every dropped id in public/data/uk_base_venue_id_aliases.json: the
// same pub's new id, the still-listed curated venue that owned the row, or a
// retired record (scripts/lib/ukBaseVenueIdAliases.mjs). The record is planned
// before anything is published, so a dropped id left resolving to nothing, or
// an alias file that cannot be read, fails the build with the previous shards
// still in place.
//
// PRICES. None. OSM is not a price source (data/osm/uk/README.md). A base pub
// has no price by construction; it is the canvas the community prices in.
//
// Run: node scripts/build_uk_base_shards.mjs   (wired into `npm run build`)

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHARD_DIR_NAME,
  UK_BASE_GRID,
  UK_BASE_SHARD_VERSION,
  cellIndexFor,
  cellKey,
  cellBbox,
} from "./lib/ukBaseGrid.mjs";
import { outerLondonOwnerForPub } from "../lib/outerLondonOwnership.mjs";
import { publishStagedDirectory } from "./lib/atomicDirectoryPublish.mjs";
import {
  planUkBaseVenueIdAliases,
  publishUkBaseWithAliases,
} from "./lib/ukBaseVenueIdAliases.mjs";
import { cityVenueIdForPub } from "./build_city_slim_index.mjs";
import { CITIES } from "./fetch_city_osm_pubs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PACK_PATH = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const DRINK_PACK_PATH = path.join(
  ROOT,
  "data",
  "osm",
  "uk",
  "uk_osm_venues_drink.json",
);
const OUT_DIR = path.join(ROOT, "public", "data", SHARD_DIR_NAME);
const LONDON_SLIM_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const OUTER_LONDON_PATH = path.join(ROOT, "data", "osm", "outer_london_osm_pubs.json");
const LONDON_PROMOTION_LEDGER_PATH = path.join(ROOT, "data", "london_osm_promotion", "ledger.json");

// Per-shard ceiling. A cell is one viewport-triggered fetch, so a fat cell is
// felt directly as a stall while panning. The densest cell today (central
// London) sits well under this; a refresh that crosses it means the grid needs
// splitting, not a bigger allowance.
const SHARD_BUDGET_BYTES = 150 * 1024;
// A cell over the budget is CUT IN FOUR rather than shipped fat, and the cut
// repeats at most this many times (0.25° → 0.125° → 0.0625°). The client never
// derives a cell - it reads the manifest and intersects bboxes - so a cell may
// carry its own finer grid without shipping that maths to the phone. Central
// London is the one cell that needs it once bars join the layer.
const MAX_CELL_SPLITS = 2;
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

/**
 * One shard row: `[osmRef, name, address, lat, lng, curatedVenueId]`, plus
 * `"bar"` where OSM states a bar. A pub row stays six elements long.
 */
function toRow(pub, curatedVenueId, kind = "pub") {
  const row = [
    compactOsmRef(pub.osmId),
    pub.name.trim(),
    typeof pub.address === "string" ? pub.address.trim() : "",
    round5(pub.lat),
    round5(pub.lng),
    curatedVenueId,
  ];
  return kind === "bar" ? [...row, "bar"] : row;
}

function ownerKey(source, id) {
  return `${source}\0${id}`;
}

async function loadCuratedVenueOwners() {
  const owners = new Map();
  /** OSM id → curated venue id, for city packs cut out of this base layer. */
  const ownersByOsmId = new Map();
  /**
   * Every curated venue, for the one dataset that carries no `curatedRef` and
   * no city pack to key on: the bars. They are matched the way an outer-London
   * pub is - same name, within 150 m - so a curated bar keeps one pin.
   */
  const curatedVenues = [];
  const londonSlim = JSON.parse(await readFile(LONDON_SLIM_PATH, "utf8"));
  const londonVenues = Array.isArray(londonSlim)
    ? londonSlim
    : Array.isArray(londonSlim?.rows)
      ? londonSlim.rows
      : [];

  for (const venue of londonVenues) {
    owners.set(ownerKey("curated-london-slim", venue.id), venue.id);
  }
  curatedVenues.push(...londonVenues);

  const outerPack = JSON.parse(await readFile(OUTER_LONDON_PATH, "utf8"));
  for (const pub of Array.isArray(outerPack?.pubs) ? outerPack.pubs : []) {
    const venueId = outerLondonOwnerForPub(pub, londonVenues) ?? "";
    if (venueId) {
      owners.set(ownerKey("outer-london-osm-seed", pub.osmId), venueId);
    }
  }

  // Pubs promoted out of this same base layer into the London index
  // (scripts/promote_london_osm_pubs.mjs) are owned by their own OSM id, the
  // exact identity, so the seed pack never has to be re-annotated or refetched
  // to stop a promoted pub drawing twice. The curated row is found by the same
  // name-and-distance rule the outer-London seed uses.
  const ledger = await readFile(LONDON_PROMOTION_LEDGER_PATH, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  for (const entry of Array.isArray(ledger?.promotions) ? ledger.promotions : []) {
    const venueId = outerLondonOwnerForPub(entry, londonVenues) ?? "";
    if (venueId) ownersByOsmId.set(String(entry.osmId), venueId);
  }

  for (const [cityId, city] of Object.entries(CITIES)) {
    if (!city.enabled) continue;
    const cityPackPath = path.join(ROOT, "data", "cities", cityId, "osm_pubs.json");
    const citySlimPath = path.join(
      ROOT,
      "public",
      "data",
      "cities",
      cityId,
      "venues_slim.json",
    );
    const [cityPack, citySlim] = await Promise.all([
      readFile(cityPackPath, "utf8").then(JSON.parse),
      readFile(citySlimPath, "utf8").then(JSON.parse),
    ]);
    const cityRows = Array.isArray(citySlim)
      ? citySlim
      : Array.isArray(citySlim?.rows)
        ? citySlim.rows
        : [];
    const cityVenueIds = new Set(cityRows.map((venue) => venue.id));
    curatedVenues.push(...cityRows);
    for (const pub of Array.isArray(cityPack?.pubs) ? cityPack.pubs : []) {
      const venueId = cityVenueIdForPub(city, pub);
      if (cityVenueIds.has(venueId)) {
        owners.set(ownerKey(`city:${cityId}`, pub.osmId), venueId);
        ownersByOsmId.set(String(pub.osmId), venueId);
      }
    }
  }

  return { owners, ownersByOsmId, curatedVenues };
}

/**
 * The bars, from the drink pack's `bar` kind (`amenity=bar` and
 * `amenity=biergarten`, data/osm/uk/VENUES.md). A bar already in the pub pack
 * would be two pins for one place, so the pub pack wins on OSM id.
 */
function barsFromDrinkPack(drinkPack, pubOsmIds) {
  const venues = Array.isArray(drinkPack?.venues) ? drinkPack.venues : [];
  const bars = [];
  for (const venue of venues) {
    if (venue?.kind !== "bar") continue;
    if (pubOsmIds.has(String(venue.osmId))) continue;
    bars.push(venue);
  }
  return bars;
}

/**
 * Cut one over-budget cell into four on a grid of half the step. The parts nest
 * inside the parent because the origin is shared, and their ids carry one more
 * decimal (`51.500_-0.250`), so they can never collide with a whole cell's id.
 */
function splitCell(cell) {
  const grid = {
    ...cell.grid,
    latStep: cell.grid.latStep / 2,
    lonStep: cell.grid.lonStep / 2,
  };
  const parts = new Map();
  for (const row of cell.rows) {
    const { latIndex, lonIndex } = cellIndexFor(row[3], row[4], grid);
    const key = cellKey(latIndex, lonIndex, grid);
    let part = parts.get(key);
    if (!part) {
      part = { latIndex, lonIndex, rows: [], grid, splits: cell.splits + 1 };
      parts.set(key, part);
    }
    part.rows.push(row);
  }
  return [...parts.values()];
}

/**
 * Every row of the generation already published, or null when none is (a
 * fresh checkout before the first build).
 */
async function readPublishedRows() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(OUT_DIR, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const rows = [];
  for (const shard of manifest.shards) {
    const file = path.join(ROOT, "public", `${manifest.urlPrefix}${shard.id}.json`);
    rows.push(...JSON.parse(await readFile(file, "utf8")).pubs);
  }
  return rows;
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
  const drinkPack = JSON.parse(await readFile(DRINK_PACK_PATH, "utf8"));
  const pubOsmIds = new Set(pubs.map((pub) => String(pub.osmId)));
  const bars = barsFromDrinkPack(drinkPack, pubOsmIds);
  if (bars.length === 0) {
    throw new Error(
      `${DRINK_PACK_PATH} has no bars - refresh it with npm run fetch:uk-venues`,
    );
  }

  const { owners: curatedVenueOwners, ownersByOsmId, curatedVenues } =
    await loadCuratedVenueOwners();
  const renderable = pubs.filter(isRenderablePub);
  const renderableBars = bars.filter(isRenderablePub);
  const skipped =
    pubs.length - renderable.length + (bars.length - renderableBars.length);
  let matchedOwners = 0;

  /** @type {Map<string, {latIndex: number, lonIndex: number, rows: unknown[][]}>} */
  const cells = new Map();
  const addRow = (venue, row) => {
    const { latIndex, lonIndex } = cellIndexFor(venue.lat, venue.lng);
    const key = cellKey(latIndex, lonIndex);
    let cell = cells.get(key);
    if (!cell) {
      cell = { latIndex, lonIndex, rows: [] };
      cells.set(key, cell);
    }
    cell.rows.push(row);
  };

  for (const pub of renderable) {
    const source = pub.curatedRef?.source;
    const id = pub.curatedRef?.id;
    const curatedVenueId =
      (typeof source === "string" && typeof id === "string"
        ? curatedVenueOwners.get(ownerKey(source, id))
        : undefined) ??
      ownersByOsmId.get(String(pub.osmId)) ??
      "";
    if (curatedVenueId) matchedOwners += 1;
    addRow(pub, toRow(pub, curatedVenueId));
  }

  // A bar carries neither a `curatedRef` nor a city pack, so ownership is the
  // name-and-distance match the outer-London seed already uses. Without it a
  // curated cocktail bar would get a second, unpriced pin beside itself.
  for (const bar of renderableBars) {
    const curatedVenueId = outerLondonOwnerForPub(bar, curatedVenues) ?? "";
    if (curatedVenueId) matchedOwners += 1;
    addRow(bar, toRow(bar, curatedVenueId, "bar"));
  }

  const previousRows = await readPublishedRows();
  const nextRows = [...cells.values()].flatMap((cell) => cell.rows);
  const aliasPlan = previousRows
    ? await planUkBaseVenueIdAliases(
        ROOT,
        previousRows,
        nextRows,
        new Set(curatedVenues.map((venue) => venue.id)),
      )
    : { superseded: [], retired: [], doc: null };

  await mkdir(path.dirname(OUT_DIR), { recursive: true });
  const stagedDir = await mkdtemp(
    path.join(path.dirname(OUT_DIR), `.${SHARD_DIR_NAME}-stage-`),
  );

  try {
    const shards = [];
    const shardBytes = [];
    let totalBytes = 0;
    let fattest = { id: "", bytes: 0, count: 0 };

    const pending = [...cells.values()].map((cell) => ({
      ...cell,
      grid: UK_BASE_GRID,
      splits: 0,
    }));
    /** @type {Array<{key: string, body: string, bytes: number, cell: object}>} */
    const emitted = [];
    let splitCells = 0;
    while (pending.length > 0) {
      const cell = pending.pop();
      const key = cellKey(cell.latIndex, cell.lonIndex, cell.grid);
      cell.rows.sort((a, b) => a[3] - b[3] || a[4] - b[4] || String(a[0]).localeCompare(String(b[0])));
      const body = JSON.stringify({
        version: UK_BASE_SHARD_VERSION,
        cell: key,
        pubs: cell.rows,
      });
      const bytes = Buffer.byteLength(body);
      if (bytes <= SHARD_BUDGET_BYTES) {
        emitted.push({ key, body, bytes, cell });
        continue;
      }
      if (cell.splits >= MAX_CELL_SPLITS) {
        throw new Error(
          `Shard ${key} is ${formatBytes(bytes)} (${cell.rows.length} venues) after ` +
            `${cell.splits} splits, still over the ${formatBytes(SHARD_BUDGET_BYTES)} ` +
            `per-viewport budget. Cut the grid finer rather than raising it.`,
        );
      }
      splitCells += 1;
      pending.push(...splitCell(cell));
    }

    emitted.sort((a, b) => a.key.localeCompare(b.key));
    for (const { key, body, bytes, cell } of emitted) {
      totalBytes += bytes;
      shardBytes.push(bytes);
      if (bytes > fattest.bytes) fattest = { id: key, bytes, count: cell.rows.length };
      await writeFile(path.join(stagedDir, `${key}.json`), body);
      shards.push({
        id: key,
        core: false,
        count: cell.rows.length,
        bbox: cellBbox(cell.latIndex, cell.lonIndex, cell.grid),
      });
    }

    const manifestBody = JSON.stringify({
      version: UK_BASE_SHARD_VERSION,
      urlPrefix: `/data/${SHARD_DIR_NAME}/`,
      grid: UK_BASE_GRID,
      generatedFrom: {
        fetchedAt: pack.fetchedAt ?? null,
        barsFetchedAt: drinkPack.fetchedAt ?? null,
        count: renderable.length + renderableBars.length,
        pubs: renderable.length,
        bars: renderableBars.length,
      },
      shards,
    });
    await writeFile(path.join(stagedDir, "manifest.json"), manifestBody);

    const publication = await publishUkBaseWithAliases({
      root: ROOT,
      doc: aliasPlan.doc,
      publishShards: () =>
        publishStagedDirectory({
          stagedDir,
          targetDir: OUT_DIR,
          requiredFiles: ["manifest.json"],
          manifestBudgetBytes: MANIFEST_BUDGET_BYTES,
          totalBudgetBytes: TOTAL_BUDGET_BYTES,
        }),
    });

    console.log(
      [
        `UK base venues → ${shards.length} shards in public/data/${SHARD_DIR_NAME}/`,
        `  packs ............... ${pubs.length} pubs, ${bars.length} bars`,
        `  curated owners ...... ${matchedOwners}`,
        `  unusable (dropped) .. ${skipped}`,
        `  shipped ............. ${renderable.length} pubs, ${renderableBars.length} bars`,
        `  cells split ......... ${splitCells}`,
        `  manifest ............ ${formatBytes(publication.manifestBytes)} (deferred until the zoom gate)`,
        `  shards total ........ ${formatBytes(totalBytes)}`,
        `  fattest shard ....... ${fattest.id} - ${formatBytes(fattest.bytes)} (${fattest.count} venues)`,
        `  median shard ........ ${formatBytes(median(shardBytes))}`,
        `  dropped ids ......... ${aliasPlan.superseded.length} re-mapped, ${aliasPlan.retired.length} retired`,
      ].join("\n"),
    );
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
