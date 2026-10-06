// The `venue-uk-*` ids a UK base refresh dropped, and what each one names now.
//
// A base id is the pub's OSM ref (`venue-uk-n251829660`), so it only moves
// when OSM deletes the object: the pub was redrawn as a new object (a node
// replaced by its building's way), or it left OSM. Pint drops, saved lists and
// crawl stories store the id they were written under, so every shard build
// records each dropped id here and lib/venueAliases.ts resolves it at read
// time: to the same pub's new id, to the curated venue that owned the row when
// that venue is still listed, or, when there is neither, to a RETIRED record
// with its name, address and last point. Nothing is ever dropped from this
// file: an id somebody stored stays resolvable, and a build that would leave a
// dropped id resolving to nothing fails.

import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  UK_BASE_VENUE_ALIASES_FILE,
  VENUE_ALIAS_FILES,
  flattenVenueAliasChains,
} from "../../lib/venueAliasesFile.mjs";
import {
  mergeCityVenueIdAliases,
  mergeRetiredCityVenues,
  venueIdDepartures,
} from "./cityVenueIdAliases.mjs";

// A re-mapped pub is the same pub only this close and under the same name.
// Wider than a city pack's 30 m because a node redrawn as a large building's
// way moves to the building's centre.
const SUCCESSOR_METERS = 50;

// The area a retired pub with no address is answered under.
const NO_ADDRESS_AREA = "United Kingdom";

/** A shard row `[osmRef, name, address, lat, lng, curatedVenueId, ...]` as the pub it names. */
function rowPub(row) {
  return {
    osmId: String(row[0]),
    name: String(row[1] ?? ""),
    address: String(row[2] ?? ""),
    lat: Number(row[3]),
    lng: Number(row[4]),
    curatedVenueId: String(row[5] ?? ""),
  };
}

function isResolvableRetired(record) {
  return (
    typeof record?.name === "string" &&
    record.name !== "" &&
    typeof record.area === "string" &&
    record.area !== "" &&
    Number.isFinite(record.lat) &&
    Number.isFinite(record.lng)
  );
}

function ukBaseIdOf(pub) {
  return `venue-uk-${pub.osmId}`;
}

/**
 * Throws when the aliases about to be written, read together with the London
 * and city alias files, send an id round a cycle. The runtime readers flatten
 * a chain to its end, so a cycle would leave them with no alias set at all.
 * A file the checkout does not carry holds no aliases.
 *
 * @param {string} root repo root
 * @param {Record<string, string>} ukAliases
 */
async function assertNoAliasCycle(root, ukAliases) {
  const pairs = [];
  for (const file of VENUE_ALIAS_FILES) {
    if (file === UK_BASE_VENUE_ALIASES_FILE) {
      pairs.push(...Object.entries(ukAliases));
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(await readFile(path.join(root, file), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const [from, to] of Object.entries(doc.aliases ?? {})) {
      if (typeof to === "string" && to) pairs.push([from, to]);
    }
  }
  flattenVenueAliasChains(pairs);
}

/**
 * Every base id the previous shard rows held and the next ones do not, with
 * the id the same pub carries now: its new base id, else the still-listed
 * curated venue that owned the row, else null when it left OSM.
 *
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} previousRows
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} nextRows
 * @param {ReadonlySet<string>} liveCuratedIds
 * @returns {Array<{ pub: { osmId: string, name: string, address: string, lat: number, lng: number, curatedVenueId: string }, from: string, to: string | null }>}
 */
export function ukBaseIdDepartures(previousRows, nextRows, liveCuratedIds) {
  return venueIdDepartures(
    ukBaseIdOf,
    previousRows.map(rowPub),
    nextRows.map(rowPub),
    SUCCESSOR_METERS,
  ).map((departure) =>
    departure.to === null && liveCuratedIds.has(departure.pub.curatedVenueId)
      ? { ...departure, to: departure.pub.curatedVenueId }
      : departure,
  );
}

/**
 * The committed alias file as it must read once the next rows are published.
 * An alias or retired record whose id the next rows serve again leaves the
 * file, so a live pub is never answered as another pub or as closed, and a
 * retired id that gains an alias leaves the retired records. `doc` is null
 * when the file needs no change. Throws when the file cannot be read or a
 * dropped id would resolve to neither an alias nor a readable retired record,
 * so a build plans this before it publishes anything.
 *
 * @param {string} root repo root
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} previousRows
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} nextRows
 * @param {ReadonlySet<string>} liveCuratedIds
 * @returns {Promise<{ superseded: Array<{ from: string, to: string }>, retired: Array<{ id: string }>, doc: Record<string, unknown> | null }>}
 */
export async function planUkBaseVenueIdAliases(root, previousRows, nextRows, liveCuratedIds) {
  const departed = ukBaseIdDepartures(previousRows, nextRows, liveCuratedIds);
  const superseded = departed.flatMap(({ from, to }) => (to ? [{ from, to }] : []));
  const retired = departed.flatMap(({ pub, from, to }) =>
    to
      ? []
      : [
          {
            id: from,
            name: pub.name.trim(),
            area: pub.address.trim() || NO_ADDRESS_AREA,
            lat: pub.lat,
            lng: pub.lng,
          },
        ],
  );
  const liveIds = new Set(nextRows.map((row) => ukBaseIdOf(rowPub(row))));
  const file = path.join(root, UK_BASE_VENUE_ALIASES_FILE);
  const doc = JSON.parse(await readFile(file, "utf8"));
  const heldAliases = doc.aliases ?? {};
  const heldRetired = doc.retired ?? {};
  if (
    superseded.length === 0 &&
    retired.length === 0 &&
    ![...Object.keys(heldAliases), ...Object.keys(heldRetired)].some((id) => liveIds.has(id))
  ) {
    return { superseded, retired, doc: null };
  }
  const aliases = Object.fromEntries(
    Object.entries(mergeCityVenueIdAliases(heldAliases, superseded)).filter(
      ([from]) => !liveIds.has(from),
    ),
  );
  const retiredRecords = Object.fromEntries(
    Object.entries(mergeRetiredCityVenues(heldRetired, retired, liveIds)).filter(
      ([id]) => !(id in aliases),
    ),
  );
  await assertNoAliasCycle(root, aliases);
  const unresolved = departed
    .map(({ from }) => from)
    .filter((id) => !(id in aliases) && !isResolvableRetired(retiredRecords[id]));
  if (unresolved.length > 0) {
    throw new Error(
      `${unresolved.length} dropped UK base id(s) would resolve to nothing: ${unresolved.join(", ")}`,
    );
  }
  return {
    superseded,
    retired,
    doc: { ...doc, aliasCount: Object.keys(aliases).length, aliases, retired: retiredRecords },
  };
}

/**
 * Stage a planned alias file beside its target, fully written, so the swap that
 * publishes it is a rename and cannot fail on the content: a disk-full or
 * serialisation error surfaces here, before anything is published.
 *
 * @param {string} root repo root
 * @param {Record<string, unknown>} doc
 * @returns {Promise<{ commit: () => Promise<void>, discard: () => Promise<void> }>}
 */
export async function stageUkBaseVenueIdAliases(root, doc) {
  const target = path.join(root, UK_BASE_VENUE_ALIASES_FILE);
  const staged = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(staged, `${JSON.stringify(doc, null, 2)}\n`);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
  return {
    commit: () => rename(staged, target),
    discard: () => rm(staged, { force: true }),
  };
}

/**
 * Publish the shards and the alias document as one step. The alias file is
 * staged first and swapped in only after `publishShards` has succeeded, so a
 * failed publish leaves both the old shards and the old aliases in place, and a
 * retry compares against the same old rows and plans the same departures. The
 * previous shard generation is the only record of what a refresh dropped, which
 * is why the alias file is never written ahead of, or apart from, the swap. A
 * null `doc` needs no alias change.
 *
 * @template T
 * @param {{ root: string, doc: Record<string, unknown> | null, publishShards: () => Promise<T> }} options
 * @returns {Promise<T>}
 */
export async function publishUkBaseWithAliases({ root, doc, publishShards }) {
  const staged = doc ? await stageUkBaseVenueIdAliases(root, doc) : null;
  let publication;
  try {
    publication = await publishShards();
  } catch (error) {
    await staged?.discard();
    throw error;
  }
  await staged?.commit();
  return publication;
}

/**
 * Write a planned alias file by itself, through the same stage and swap.
 *
 * @param {string} root repo root
 * @param {Record<string, unknown>} doc
 */
export async function writeUkBaseVenueIdAliases(root, doc) {
  await (await stageUkBaseVenueIdAliases(root, doc)).commit();
}
