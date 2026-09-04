#!/usr/bin/env node
// Fetch the OpenStreetMap place nodes that NAME the neighbourhoods of the
// cities that get derived Night Areas.
//
// Why a second observation rather than the base layer's own place index:
// public/data/uk_base/places.json is folded out of `addr:*` tags on pub rows, so
// it names a neighbourhood only where a pub happened to be tagged with it. Over
// the four cities here that is 242 statements in Bristol and eight in
// Birmingham, which would have published Bristol and left Birmingham with
// nothing while both cities have well-mapped neighbourhoods in OSM. A
// `place=suburb` node is the thing OSM keeps for exactly this question, so it is
// what we ask.
//
// One request per city, one node kind set, no tag inference: an element that
// does not state a name and one of PLACE_KINDS is dropped. Output is a
// provenance-stamped seed committed under data/osm/cities/, read by
// scripts/build_city_night_areas.mjs. Re-run with `npm run fetch:city-places`.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { CITY_BOUNDS } from "../lib/cityBounds.mjs";
import { fetchOverpass, INTER_CHUNK_DELAY_MS, QUERY_TIMEOUT_S, sleep, writePretty } from "./lib/overpassClient.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "osm", "cities", "place_nodes.json");

/**
 * The cities whose neighbourhoods we ask for, and so the cities that get areas.
 * `name` must be the city's own `displayName` in lib/cities.ts, because it is
 * how the city's OWN place node is told from its neighbours' inside one box.
 * __tests__/cityNightAreas.test.ts holds the two together.
 */
export const PLACE_NODE_CITIES = [
  { id: "manchester", name: "Manchester" },
  { id: "birmingham", name: "Birmingham" },
  { id: "leeds", name: "Leeds" },
  { id: "bristol", name: "Bristol" },
];

/** The place kinds that name a patch INSIDE a city. */
export const PLACE_KINDS = ["suburb", "neighbourhood", "quarter"];

/**
 * The kind that names the city itself. Asked for in the same request because a
 * city's densest pubs are its centre, and OSM names that centre reliably only
 * here: three of these four cities have no `place=suburb` node over their own
 * middle. It is kept apart from PLACE_KINDS, never treated as a neighbourhood.
 */
export const CENTRE_PLACE_KIND = "city";

export function buildPlaceQuery(bounds) {
  const box = `${bounds.latMin},${bounds.lonMin},${bounds.latMax},${bounds.lonMax}`;
  const kinds = [...PLACE_KINDS, CENTRE_PLACE_KIND].join("|");
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];(node["place"~"^(${kinds})$"](${box}););out body;`;
}

/**
 * Keep only elements that STATE a name, a kind we asked for and a point. A
 * `place=city` node is kept only where it names THIS city: inside one box it is
 * otherwise a neighbouring city (Salford and Stockport sit inside Manchester's).
 */
export function normalisePlaceElements(elements, city) {
  const cityId = city.id;
  const kinds = new Set(PLACE_KINDS);
  const byName = new Map();
  let dropped = 0;
  for (const element of elements ?? []) {
    const name = String(element?.tags?.name ?? "").trim();
    const kind = String(element?.tags?.place ?? "");
    const lat = Number(element?.lat);
    const lng = Number(element?.lon);
    const isOwnCentre = kind === CENTRE_PLACE_KIND && name === city.name;
    if (!name || !(kinds.has(kind) || isOwnCentre) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped += 1;
      continue;
    }
    // One name, one point. A duplicate node for the same neighbourhood is the
    // same place stated twice, not two places.
    if (byName.has(name)) {
      dropped += 1;
      continue;
    }
    byName.set(name, { cityId, name, kind, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  }
  const places = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  return { places, dropped };
}

async function main() {
  const places = [];
  let observedAt = "";
  let droppedTotal = 0;

  for (const [index, city] of PLACE_NODE_CITIES.entries()) {
    const bounds = CITY_BOUNDS[city.id];
    if (!bounds) throw new Error(`No bounds for city "${city.id}"`);
    if (index > 0) await sleep(INTER_CHUNK_DELAY_MS);
    console.log(`${city.id}: asking Overpass for ${PLACE_KINDS.join(", ")} nodes …`);
    const raw = await fetchOverpass(buildPlaceQuery(bounds));
    const stamp = String(raw?.osm3s?.timestamp_osm_base ?? "");
    if (stamp > observedAt) observedAt = stamp;
    const { places: cityPlaces, dropped } = normalisePlaceElements(raw.elements, city);
    droppedTotal += dropped;
    console.log(`  ${cityPlaces.length} place(s) kept, ${dropped} dropped`);
    places.push(...cityPlaces);
  }

  await writePretty(OUTPUT_PATH, {
    source: "OpenStreetMap Overpass",
    license: "ODbL 1.0",
    attribution:
      "© OpenStreetMap contributors, data licensed under the Open Database Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright",
    basis: `OSM nodes tagged place=${[...PLACE_KINDS, CENTRE_PLACE_KIND].join("|")} inside each city's own box (lib/cityBounds.mjs)`,
    generator: "scripts/fetch_city_place_nodes.mjs",
    observedAt: observedAt || null,
    cities: PLACE_NODE_CITIES.map((city) => city.id),
    droppedElements: droppedTotal,
    count: places.length,
    places,
  });
  console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)} (${places.length} places)`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
