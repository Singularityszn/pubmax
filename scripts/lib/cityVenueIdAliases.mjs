// The superseded city venue ids, and the current id each one now names.
//
// A city venue id is a hash of the pub's name, address and 5-dp point
// (lib/cityVenueId.mjs), so an OSM edit that fills in an address or nudges a
// node gives the SAME pub a new id. Pint drops, saved lists and crawl stories
// store the id they were written under, so every pack refresh records each
// superseded id here and lib/venueAliases.ts resolves it at read time. Nothing
// is ever dropped from this file: an id somebody stored stays resolvable.

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
 * the id the same pub carries now. The same pub is the same OSM object, or,
 * when OSM redrew it as a new object, the nearest pub under its name within
 * SUCCESSOR_METERS. A pub with neither is gone from OSM and has no successor.
 *
 * @param {string} cityId
 * @param {Array<Record<string, any>>} previousPubs
 * @param {Array<Record<string, any>>} nextPubs
 * @returns {Array<{ from: string, to: string }>}
 */
export function supersededCityVenueIds(cityId, previousPubs, nextPubs) {
  const nextIds = new Set(nextPubs.map((pub) => venueIdOf(cityId, pub)));
  const previousIds = new Set(previousPubs.map((pub) => venueIdOf(cityId, pub)));
  const nextByOsmId = new Map(nextPubs.map((pub) => [String(pub.osmId), pub]));
  // A redrawn object can only have become a pub the previous pack did not hold.
  const arrivals = nextPubs.filter((pub) => !previousIds.has(venueIdOf(cityId, pub)));

  const superseded = [];
  for (const pub of previousPubs) {
    const from = venueIdOf(cityId, pub);
    if (!from || nextIds.has(from)) continue;
    let successor = nextByOsmId.get(String(pub.osmId)) ?? null;
    if (!successor) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of arrivals) {
        const metres = haversineMeters(pub.lat, pub.lng, candidate.lat, candidate.lng);
        if (metres <= SUCCESSOR_METERS && metres < nearest && sameName(pub.name, candidate.name)) {
          nearest = metres;
          successor = candidate;
        }
      }
    }
    const to = successor ? venueIdOf(cityId, successor) : null;
    if (to && to !== from) superseded.push({ from, to });
  }
  return superseded;
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
 * Record the ids a city pack refresh superseded in the committed alias file.
 *
 * @param {string} root repo root
 * @param {string} cityId
 * @param {Array<Record<string, any>>} previousPubs
 * @param {Array<Record<string, any>>} nextPubs
 * @returns {Promise<Array<{ from: string, to: string }>>}
 */
export async function recordCityVenueIdAliases(root, cityId, previousPubs, nextPubs) {
  const superseded = supersededCityVenueIds(cityId, previousPubs, nextPubs);
  if (superseded.length === 0) return superseded;
  const file = path.join(root, CITY_VENUE_ALIASES_FILE);
  const doc = JSON.parse(await readFile(file, "utf8"));
  const aliases = mergeCityVenueIdAliases(doc.aliases ?? {}, superseded);
  await writeFile(
    file,
    `${JSON.stringify({ ...doc, aliasCount: Object.keys(aliases).length, aliases }, null, 2)}\n`,
  );
  return superseded;
}
