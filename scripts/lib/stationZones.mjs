// Nearest-station fare-zone assignment (build-time, pure JS). The rule itself
// is lib/nearestStationZone.mjs, shared with the landing hero; this module
// loads the table for the slim build.
//
// TfL fare zones are STATION-based, not area polygons, so there is no honest
// "zone polygon" to point-in-poly a venue against. Instead every venue is
// assigned the zone of its NEAREST station by great-circle distance — a
// documented approximation, labelled as such in the UI. The station table
// (data/tfl_station_zones.json) is TfL open data via Doogal; multi-zone
// stations are recorded as their LOWER zone (see that file's _provenance).
//
// Run indirectly by scripts/build_slim_index.mjs. Kept plain-JS + dependency
// free so the slim build has no import friction; __tests__/stationZones.test.ts
// exercises the same functions the build calls.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nearestStationZone } from "../../lib/nearestStationZone.mjs";
import { haversineKm } from "./geo.mjs";

export { haversineKm, nearestStationZone };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATION_ZONES_PATH = path.resolve(__dirname, "..", "..", "data", "tfl_station_zones.json");

let cachedStations = null;

/** Load the committed station-zone table (cached per process). */
export async function loadStationZones() {
  if (cachedStations) return cachedStations;
  const doc = JSON.parse(await readFile(STATION_ZONES_PATH, "utf8"));
  const stations = Array.isArray(doc?.stations) ? doc.stations : [];
  cachedStations = stations.filter(
    (s) =>
      s &&
      typeof s.name === "string" &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      Number.isInteger(s.zone),
  );
  return cachedStations;
}
