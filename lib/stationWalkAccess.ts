// Street-network walks from a rounded point to the stations around it.
//
// The Last Pint leave-by clock used to walk a drinker to the station along the
// straight line. Streets do not run straight: in the West End pilot the street
// walk is a median 1.37 times the straight line, and 1.71 times at the 90th
// percentile, so the card handed people time they did not have.
//
// `data/station_walk_access.json` is built offline by
// `scripts/build_station_walk_access.py` (city2graph over Overture Maps
// streets). It is keyed on the SAME 0.001-degree grid `coarsenViewerPoint`
// rounds a point to before it leaves the browser, so a lookup needs nothing
// finer than what the server is already sent.
//
// THE RULE. A street walk is only ever answered for a point the table covers
// AND a station the table can name within STATION_MATCH_M of the station TfL
// chose. Anything else is null, and the caller keeps the straight line and
// says so. A street walk is never shorter than the straight line.

import accessJson from "@/data/station_walk_access.json";
import { coarsenViewerPoint } from "@/lib/geo";
import { haversineMeters } from "@/lib/greatCircle.mjs";

type AccessStation = { name: string; lat: number; lng: number };

export type StationWalkAccess = {
  stations: AccessStation[];
  /** "lat,lng" at three decimals -> [station index, street metres][], nearest first. */
  cells: Record<string, [number, number][]>;
};

/**
 * The furthest TfL's station point may sit from ours and still be the same
 * station. TfL places a hub and our source places a station point, so they
 * rarely coincide. Two of our stations can sit closer than this (Great
 * Portland Street and Regent's Park are 96 m apart), so of the cell's
 * stations inside it, the closest to TfL's point is the match.
 */
const STATION_MATCH_M = 200;

function isStation(value: unknown): value is AccessStation {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    typeof s.lat === "number" &&
    Number.isFinite(s.lat) &&
    typeof s.lng === "number" &&
    Number.isFinite(s.lng)
  );
}

/** Parse the committed table, dropping any cell that does not hold its shape. */
export function parseStationWalkAccess(raw: unknown): StationWalkAccess {
  const empty: StationWalkAccess = { stations: [], cells: {} };
  if (!raw || typeof raw !== "object") return empty;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.stations) || !record.stations.every(isStation)) return empty;
  const stations = record.stations as AccessStation[];
  const cellsRaw = record.cells;
  if (!cellsRaw || typeof cellsRaw !== "object") return { stations, cells: {} };
  const cells: StationWalkAccess["cells"] = {};
  for (const [key, value] of Object.entries(cellsRaw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const walks = value.filter(
      (entry): entry is [number, number] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        Number.isInteger(entry[0]) &&
        entry[0] >= 0 &&
        entry[0] < stations.length &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]) &&
        entry[1] >= 0,
    );
    if (walks.length > 0) cells[key] = walks;
  }
  return { stations, cells };
}

export function cellKey(lat: number, lng: number): string {
  const point = coarsenViewerPoint({ lat, lng });
  return `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
}

let bundled: StationWalkAccess | null = null;

function bundledAccess(): StationWalkAccess {
  bundled ??= parseStationWalkAccess(accessJson);
  return bundled;
}

/**
 * Street metres from the (rounded) point to the station TfL chose, or null
 * when the table does not cover that point or cannot name that station.
 */
export function streetWalkMetres(
  from: { lat: number; lng: number },
  station: { lat: number; lng: number },
  access: StationWalkAccess = bundledAccess(),
): number | null {
  const walks = access.cells[cellKey(from.lat, from.lng)];
  if (!walks) return null;
  let best: { metres: number; offset: number } | null = null;
  for (const [index, metres] of walks) {
    const ours = access.stations[index];
    if (!ours) continue;
    const offset = haversineMeters(ours.lat, ours.lng, station.lat, station.lng);
    if (offset <= STATION_MATCH_M && (best === null || offset < best.offset)) {
      best = { metres, offset };
    }
  }
  if (!best) return null;
  const point = coarsenViewerPoint(from);
  const straight = haversineMeters(point.lat, point.lng, station.lat, station.lng);
  return Math.max(best.metres, straight);
}
