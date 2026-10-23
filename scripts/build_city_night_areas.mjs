#!/usr/bin/env node
// Derive Night Areas for the non-London cities from the committed UK base layer.
//
// London's areas are hand-curated in lib/nightAreas.ts, from years of reviewed
// evidence. These four cities have no such review, so their areas are DERIVED
// and may claim only what OpenStreetMap already states: a locality name, the
// pubs that sit around it, and where those pubs are. Nothing here reads a price,
// an opening hour or a station, because the base layer holds none of the three,
// and an area that named one would be inventing it.
//
// Two committed inputs, both ODbL and both already in the tree:
//   public/data/uk_base/packs/<hash>/*.json  the base layer, pub rows only
//   data/osm/cities/place_nodes.json         OSM place=suburb nodes per city
//
// The names come from the place nodes rather than the base layer's own
// places.json, which is folded out of `addr:*` tags on pub rows and so names a
// neighbourhood only where a pub happened to carry it: eight statements across
// the whole of Birmingham. scripts/fetch_city_place_nodes.mjs owns that fetch.
//
// Output: public/data/night_areas/uk_cities.json, read by lib/nightAreas.ts.
// Regenerate with `npm run build:city-night-areas`.
//
// The pub COUNT and the RADIUS are one promise: every pub counted for an area
// sits inside that area's own radius, because the members outside the final
// radius are dropped from the count rather than the radius stretched to reach
// them. __tests__/cityNightAreas.test.ts re-derives that promise from the base
// layer, city by city.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CITY_BOUNDS } from "../lib/cityBounds.mjs";
import { haversineKm as sharedHaversineKm } from "./lib/geo.mjs";
import { CENTRE_PLACE_KIND, PLACE_NODE_CITIES } from "./fetch_city_place_nodes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const UK_BASE_DIR = path.join(ROOT, "public", "data", "uk_base");
const PLACE_NODES_PATH = path.join(ROOT, "data", "osm", "cities", "place_nodes.json");
const OUT_PATH = path.join(ROOT, "public", "data", "night_areas", "uk_cities.json");

/** The cities that get derived areas, in the order they are published. */
export const DERIVED_AREA_CITIES = PLACE_NODE_CITIES.map((city) => city.id);

/** How far from a locality's own point a pub may sit and still belong to it. */
export const MAX_AREA_RADIUS_KM = 1.8;
/** Two areas closer than this are one patch wearing two names, so the smaller goes. */
export const MIN_AREA_SEPARATION_KM = 1.6;
/** Below this a patch is a handful of pubs rather than somewhere to spend a night. */
export const MIN_AREA_PUBS = 10;
/** Fewer than this and the city is not published at all; more than this is a list nobody reads. */
export const MIN_AREAS_PER_CITY = 4;
export const MAX_AREAS_PER_CITY = 8;

/** Great-circle kilometres between two `{ lat, lng }` points. The formula has
 * ONE owner in scripts/, scripts/lib/geo.mjs; this only names its arguments. */
export function haversineKm(a, b) {
  return sharedHaversineKm(a.lat, a.lng, b.lat, b.lng);
}

/**
 * `Moseley` in Birmingham becomes `birmingham-moseley`, and `Birmingham city
 * centre` becomes `birmingham-city-centre` rather than saying it twice. The city
 * prefix is what keeps these apart from London's own hand-curated slugs.
 */
export function nightAreaSlug(cityId, name) {
  const tail = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return tail === cityId || tail.startsWith(`${cityId}-`) ? tail : `${cityId}-${tail}`;
}

/** `suburb` outranks every other patch kind; the centre is ranked apart. */
export function placeKindRank(place) {
  return place.kind === "suburb" ? 0 : 1;
}

function inBox(lat, lng, box) {
  return lat >= box.latMin && lat <= box.latMax && lng >= box.lonMin && lng <= box.lonMax;
}

/**
 * Whether a base-layer row is a PUB. A seventh element says "bar"
 * (public/data/uk_base/README.md). A Night Area is derived from where the pubs
 * are, so a bar is not a member: folding one in would move a published area's
 * centre, radius and count with nobody asking for a new area.
 */
export function isBasePubRow(row) {
  // An unnamed pub (name "") is a bare pin, not a member of a named area.
  return Array.isArray(row) && row.length === 6 && String(row[1]) !== "";
}

async function loadBasePubs() {
  const manifest = JSON.parse(await readFile(path.join(UK_BASE_DIR, "manifest.json"), "utf8"));
  const prefix = String(manifest.urlPrefix ?? "");
  const packDir = path.join(UK_BASE_DIR, "packs", path.basename(prefix.replace(/\/+$/, "")));
  const files = (await readdir(packDir)).filter((file) => file.endsWith(".json"));
  const pubs = [];
  for (const file of files) {
    const shard = JSON.parse(await readFile(path.join(packDir, file), "utf8"));
    for (const row of shard.pubs ?? []) {
      if (!isBasePubRow(row)) continue;
      pubs.push({ osmId: String(row[0]), name: String(row[1]), lat: Number(row[3]), lng: Number(row[4]) });
    }
  }
  return pubs;
}

async function loadPlaceNodes() {
  const seed = JSON.parse(await readFile(PLACE_NODES_PATH, "utf8"));
  if (!Array.isArray(seed?.places) || seed.places.length === 0) {
    throw new Error(
      `${path.relative(ROOT, PLACE_NODES_PATH)} names no places \u2014 run npm run fetch:city-places first`,
    );
  }
  return seed.places;
}

/**
 * Derive one city's areas.
 *
 * Exported whole so the test re-runs the real rule over the real base layer
 * rather than restating it, the way the shipped-CSS fences read their own file.
 */
export function deriveCityAreas(cityId, box, allPubs, allPlaces) {
  const pubs = allPubs.filter((pub) => inBox(pub.lat, pub.lng, box));
  const scored = allPlaces
    .filter((place) => place.cityId === cityId)
    .filter((place) => inBox(place.lat, place.lng, box))
    .map((place) => ({
      ...place,
      areaName: place.kind === CENTRE_PLACE_KIND ? `${place.name} city centre` : place.name,
      reach: pubs.filter((pub) => haversineKm(place, pub) <= MAX_AREA_RADIUS_KM).length,
    }))
    .filter((place) => place.reach >= MIN_AREA_PUBS);

  // The centre goes first, whatever its reach. A city's densest pubs ARE its
  // centre, and picking the densest NODE there instead named Manchester's
  // middle "Gay Village" and Birmingham's "Chinese Quarter": both real quarters
  // inside the centre, neither the name for the whole of it.
  const centre = scored.find((place) => place.kind === CENTRE_PLACE_KIND) ?? null;
  // A `suburb` is the level OSM keeps for a place people name; a
  // `neighbourhood` or a `quarter` is often a corner of one. Taking the suburb
  // first is why Leeds publishes Woodhouse rather than Woodhouse Carr.
  const rest = scored
    .filter((place) => place.kind !== CENTRE_PLACE_KIND)
    .sort(
      (left, right) =>
        placeKindRank(left) - placeKindRank(right) ||
        right.reach - left.reach ||
        left.name.localeCompare(right.name),
    );

  // Greedy, densest first: an area is taken only where no area already taken
  // covers the same ground, so one patch cannot be published under two names.
  const taken = centre ? [centre] : [];
  for (const candidate of rest) {
    if (taken.length >= MAX_AREAS_PER_CITY) break;
    const collides = taken.some((held) => haversineKm(held, candidate) < MIN_AREA_SEPARATION_KM);
    if (!collides) taken.push(candidate);
  }

  // One pub, one area: the nearest area whose radius reaches it, the same rule
  // nightAreaForPoint applies when it assigns a venue on the map.
  const members = new Map(taken.map((place) => [place.areaName, []]));
  for (const pub of pubs) {
    let best = null;
    let bestKm = Infinity;
    for (const place of taken) {
      const km = haversineKm(place, pub);
      if (km > MAX_AREA_RADIUS_KM) continue;
      if (km < bestKm || (km === bestKm && best && place.areaName < best.areaName)) {
        best = place;
        bestKm = km;
      }
    }
    if (best) members.get(best.areaName).push(pub);
  }

  const areas = [];
  for (const place of taken) {
    const held = members.get(place.areaName);
    if (held.length < MIN_AREA_PUBS) continue;
    // The centre is where the pubs ARE, not where the locality tag sits.
    const centre = {
      lat: Number((held.reduce((sum, pub) => sum + pub.lat, 0) / held.length).toFixed(5)),
      lng: Number((held.reduce((sum, pub) => sum + pub.lng, 0) / held.length).toFixed(5)),
    };
    const reach = Math.min(
      MAX_AREA_RADIUS_KM,
      Math.max(...held.map((pub) => haversineKm(centre, pub))),
    );
    const radiusKm = Number((Math.ceil(reach * 10) / 10).toFixed(1));
    // Recentring can push a pub past the capped radius. The count follows the
    // radius rather than the radius following the count.
    const inside = held.filter((pub) => haversineKm(centre, pub) <= radiusKm);
    if (inside.length < MIN_AREA_PUBS) continue;
    areas.push({
      slug: nightAreaSlug(cityId, place.areaName),
      cityId,
      name: place.areaName,
      centre,
      radiusKm,
      pubCount: inside.length,
    });
  }

  return areas.sort((left, right) => right.pubCount - left.pubCount || left.slug.localeCompare(right.slug));
}

async function main() {
  const pubs = await loadBasePubs();
  const places = await loadPlaceNodes();
  const areas = [];
  for (const cityId of DERIVED_AREA_CITIES) {
    const box = CITY_BOUNDS[cityId];
    if (!box) throw new Error(`No bounds for city "${cityId}"`);
    const cityAreas = deriveCityAreas(cityId, box, pubs, places);
    if (cityAreas.length < MIN_AREAS_PER_CITY) {
      throw new Error(
        `${cityId}: derived ${cityAreas.length} area(s), below the floor of ${MIN_AREAS_PER_CITY}`,
      );
    }
    console.log(
      `${cityId}: ${cityAreas.length} area(s), ${cityAreas.reduce((sum, area) => sum + area.pubCount, 0)} pub(s)`,
    );
    for (const area of cityAreas) console.log(`  ${area.name} — ${area.pubCount} pubs, ${area.radiusKm} km`);
    areas.push(...cityAreas);
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    `${JSON.stringify(
      {
        source: "OpenStreetMap via the committed UK base layer",
        license: "ODbL 1.0",
        attribution:
          "© OpenStreetMap contributors, data licensed under the Open Database Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright",
        basis: "Pub positions and locality names stated by OpenStreetMap. No price, hour or transport claim.",
        generator: "scripts/build_city_night_areas.mjs",
        areas,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)} (${areas.length} areas)`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
