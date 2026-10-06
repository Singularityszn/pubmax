// The `venue-uk-*` ids a UK base refresh dropped, and what each one names now.
//
// A base id is the pub's OSM ref (`venue-uk-n251829660`), so it only moves
// when OSM deletes the object: the pub was redrawn as a new object (a node
// replaced by its building's way), or it left OSM. Pint drops, saved lists and
// crawl stories store the id they were written under, so every shard build
// records each dropped id here and lib/venueAliases.ts resolves it at read
// time: to the same pub's new id, or, when there is no successor, to a RETIRED
// record with its name, address and last point. Nothing is ever dropped from
// this file: an id somebody stored stays resolvable.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { UK_BASE_VENUE_ALIASES_FILE } from "../../lib/venueAliasesFile.mjs";
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

/** A shard row `[osmRef, name, address, lat, lng, ...]` as the pub it names. */
function rowPub(row) {
  return {
    osmId: String(row[0]),
    name: String(row[1] ?? ""),
    address: String(row[2] ?? ""),
    lat: Number(row[3]),
    lng: Number(row[4]),
  };
}

function ukBaseIdOf(pub) {
  return `venue-uk-${pub.osmId}`;
}

/**
 * Every base id the previous shard rows held and the next ones do not, with
 * the id the same pub carries now, or null when it left OSM.
 *
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} previousRows
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} nextRows
 * @returns {Array<{ pub: { osmId: string, name: string, address: string, lat: number, lng: number }, from: string, to: string | null }>}
 */
export function ukBaseIdDepartures(previousRows, nextRows) {
  return venueIdDepartures(
    ukBaseIdOf,
    previousRows.map(rowPub),
    nextRows.map(rowPub),
    SUCCESSOR_METERS,
  );
}

/**
 * Record the base ids a shard build dropped in the committed alias file. An
 * alias or retired record whose id the next rows serve again leaves the file,
 * so a live pub is never answered as another pub or as closed.
 *
 * @param {string} root repo root
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} previousRows
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} nextRows
 * @returns {Promise<{ superseded: Array<{ from: string, to: string }>, retired: Array<{ id: string }> }>}
 */
export async function recordUkBaseVenueIdAliases(root, previousRows, nextRows) {
  const departed = ukBaseIdDepartures(previousRows, nextRows);
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
    return { superseded, retired };
  }
  const aliases = Object.fromEntries(
    Object.entries(mergeCityVenueIdAliases(heldAliases, superseded)).filter(
      ([from]) => !liveIds.has(from),
    ),
  );
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...doc,
        aliasCount: Object.keys(aliases).length,
        aliases,
        retired: mergeRetiredCityVenues(heldRetired, retired, liveIds),
      },
      null,
      2,
    )}\n`,
  );
  return { superseded, retired };
}
