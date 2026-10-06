// The superseded city venue ids, and the current id each one now names.
//
// A city venue id is a hash of the pub's name, address and 5-dp point
// (lib/cityVenueId.mjs), so an OSM edit that fills in an address or nudges a
// node gives the SAME pub a new id. Pint drops, saved lists and crawl stories
// store the id they were written under, so every pack refresh records each
// superseded id here and lib/venueAliases.ts resolves it at read time. A pub
// that left OSM with no successor is recorded as RETIRED, with its name, area
// and last point, so a reference to it still names that pub. Nothing is ever
// dropped from this file: an id somebody stored stays resolvable.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { cityVenueIdForPub } from "../../lib/cityVenueId.mjs";
import { CITY_VENUE_ALIASES_FILE } from "../../lib/venueAliasesFile.mjs";
import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
} from "./venueCanonicalization.mjs";

// A pub re-mapped as a different OSM object (a node redrawn as its building's
// way) is the same pub only this close and under the same name. The same
// radius fetch_city_osm_pubs.mjs uses to collapse two objects of one pub.
const SUCCESSOR_METERS = 30;

function venueIdOf(cityId, pub) {
  return cityVenueIdForPub(cityId, {
    name: String(pub.name ?? "").trim(),
    address: pub.address,
    lat: Number(pub.lat),
    lng: Number(pub.lng),
  });
}

function sameName(a, b) {
  const left = normalizeVenueIdentityName(a);
  const right = normalizeVenueIdentityName(b);
  if (!left || !right) return false;
  return namesLikelySamePub(left, right) || left.startsWith(right) || right.startsWith(left);
}

/**
 * Every pub of the previous pack whose id the next pack no longer serves, with
 * the id the same pub carries now, or null when it has none. The same pub is
 * the same OSM object, or, when OSM redrew it as a new object, the nearest pub
 * under its name within `successorMeters`. A pub with neither left OSM.
 *
 * @param {(pub: Record<string, any>) => string} idOf
 * @param {Array<Record<string, any>>} previousPubs
 * @param {Array<Record<string, any>>} nextPubs
 * @param {number} successorMeters
 * @returns {Array<{ pub: Record<string, any>, from: string, to: string | null }>}
 */
export function venueIdDepartures(idOf, previousPubs, nextPubs, successorMeters) {
  const nextIds = new Set(nextPubs.map(idOf));
  const previousIds = new Set(previousPubs.map(idOf));
  const nextByOsmId = new Map(nextPubs.map((pub) => [String(pub.osmId), pub]));
  // A redrawn object can only have become a pub the previous pack did not hold.
  const arrivals = nextPubs.filter((pub) => !previousIds.has(idOf(pub)));

  const departed = [];
  for (const pub of previousPubs) {
    const from = idOf(pub);
    if (!from || nextIds.has(from)) continue;
    let successor = nextByOsmId.get(String(pub.osmId)) ?? null;
    if (!successor) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of arrivals) {
        const metres = haversineMeters(pub.lat, pub.lng, candidate.lat, candidate.lng);
        if (metres <= successorMeters && metres < nearest && sameName(pub.name, candidate.name)) {
          nearest = metres;
          successor = candidate;
        }
      }
    }
    const to = successor ? idOf(successor) : null;
    if (to !== from) departed.push({ pub, from, to });
  }
  return departed;
}

function departures(cityId, previousPubs, nextPubs) {
  return venueIdDepartures((pub) => venueIdOf(cityId, pub), previousPubs, nextPubs, SUCCESSOR_METERS);
}

/**
 * Every pub of the previous pack whose id the next pack no longer serves, with
 * the id the same pub carries now.
 *
 * @returns {Array<{ from: string, to: string }>}
 */
export function supersededCityVenueIds(cityId, previousPubs, nextPubs) {
  return departures(cityId, previousPubs, nextPubs).flatMap(({ from, to }) =>
    to ? [{ from, to }] : [],
  );
}

/**
 * Every pub of the previous pack that left OSM with no successor, as the record
 * a reference to it is still answered with: its name, its area as the pack
 * labels it, and its last point.
 *
 * @param {{ id: string, displayName: string }} city
 * @returns {Array<{ id: string, name: string, area: string, lat: number, lng: number }>}
 */
export function retiredCityVenues(city, previousPubs, nextPubs) {
  return departures(city.id, previousPubs, nextPubs).flatMap(({ pub, from, to }) =>
    to
      ? []
      : [
          {
            id: from,
            name: String(pub.name ?? "").trim(),
            area: String(pub.locality ?? "").trim() || city.displayName,
            lat: Number(pub.lat),
            lng: Number(pub.lng),
          },
        ],
  );
}

/**
 * Fold newly retired pubs into the retired records. A retired id the next pack
 * serves again is live and leaves the records.
 *
 * @param {Record<string, { name: string, area: string, lat: number, lng: number }>} retired
 * @param {Array<{ id: string, name: string, area: string, lat: number, lng: number }>} departed
 * @param {Set<string>} liveIds
 */
export function mergeRetiredCityVenues(retired, departed, liveIds) {
  const merged = { ...retired };
  for (const { id, ...record } of departed) merged[id] = record;
  for (const id of Object.keys(merged)) {
    if (liveIds.has(id)) delete merged[id];
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Fold new supersessions into the alias map. An alias whose target is itself
 * superseded is re-pointed, so a reader never follows a chain.
 *
 * @param {Record<string, string>} aliases
 * @param {Array<{ from: string, to: string }>} superseded
 * @returns {Record<string, string>}
 */
export function mergeCityVenueIdAliases(aliases, superseded) {
  const successorOf = new Map(superseded.map(({ from, to }) => [from, to]));
  const merged = {};
  for (const [from, to] of Object.entries(aliases)) {
    merged[from] = successorOf.get(to) ?? to;
  }
  for (const { from, to } of superseded) merged[from] = to;
  for (const [from, to] of Object.entries(merged)) {
    if (from === to) delete merged[from];
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Record the ids a city pack refresh superseded, and the pubs it retired, in
 * the committed alias file.
 *
 * @param {string} root repo root
 * @param {{ id: string, displayName: string }} city
 * @param {Array<Record<string, any>>} previousPubs
 * @param {Array<Record<string, any>>} nextPubs
 * @returns {Promise<{ superseded: Array<{ from: string, to: string }>, retired: Array<{ id: string }> }>}
 */
export async function recordCityVenueIdAliases(root, city, previousPubs, nextPubs) {
  const superseded = supersededCityVenueIds(city.id, previousPubs, nextPubs);
  const retired = retiredCityVenues(city, previousPubs, nextPubs);
  const liveIds = new Set(nextPubs.map((pub) => venueIdOf(city.id, pub)));
  const file = path.join(root, CITY_VENUE_ALIASES_FILE);
  const doc = JSON.parse(await readFile(file, "utf8"));
  const heldRetired = doc.retired ?? {};
  if (
    superseded.length === 0 &&
    retired.length === 0 &&
    !Object.keys(heldRetired).some((id) => liveIds.has(id))
  ) {
    return { superseded, retired };
  }
  const aliases = mergeCityVenueIdAliases(doc.aliases ?? {}, superseded);
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
