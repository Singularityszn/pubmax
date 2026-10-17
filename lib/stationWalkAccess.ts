// Street-network walks from a rounded point to the stations around it.
//
// The Last Pint leave-by clock used to walk a drinker to the station along the
// straight line. Streets do not run straight: across Zone 1 the street walk is
// a median 1.35 times the straight line, and 1.73 times at the 90th
// percentile, so the card handed people time they did not have.
//
// `data/station_walk_access.json` is built offline by
// `scripts/build_station_walk_access.py` (city2graph over Overture Maps
// streets). It is keyed on the SAME 0.001-degree grid `coarsenViewerPoint`
// rounds a point to before it leaves the browser, so a lookup needs nothing
// finer than what the server is already sent.
//
// A station the builder could join to NaPTAN entrances carries them, and its
// walk ends at the nearest door on foot rather than at the station point.
//
// THE RULE. A street walk is only ever answered for a point the table covers
// AND a station the cell holds a walk to, once TfL's station is named as one
// of ours (see matchStation). Anything else is null, and the caller keeps the
// straight line and says so. A street walk is never shorter than the straight
// line.

import accessJson from "@/data/station_walk_access.json";
import { coarsenViewerPoint } from "@/lib/geo";
import { haversineMeters } from "@/lib/greatCircle.mjs";

type AccessStation = {
  name: string;
  lat: number;
  lng: number;
  /** [lat, lng] of each door the walk may end at; absent when it ends at the point. */
  entrances?: [number, number][];
};

export type StationWalkAccess = {
  stations: AccessStation[];
  /** "lat,lng" at three decimals -> [station index, street metres][], nearest first. */
  cells: Record<string, [number, number][]>;
};

/**
 * The furthest TfL's station point may sit from ours and still be the same
 * station. TfL places a hub and our source places a station point, so they
 * rarely coincide. Two of our stations can sit closer than this (Great
 * Portland Street and Regent's Park are 96 m apart, Tower Hill and Tower
 * Gateway 159 m), so the match is made over the whole station list, never
 * only the stations one cell happens to keep, and a name breaks the tie.
 */
const STATION_MATCH_M = 200;

/** "Tower Hill Underground Station" and "Tower Hill" both read "towerhill". */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(underground|dlr|rail|overground|elizabeth line)?\s*station\b/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z]/g, "");
}

/**
 * The index of our station that TfL's station is: of ours within
 * STATION_MATCH_M, the nearest whose name agrees with TfL's when one does,
 * else the nearest. Null when none is that close.
 */
function matchStation(
  station: { lat: number; lng: number; name?: string },
  access: StationWalkAccess,
): number | null {
  const theirs = station.name ? nameKey(station.name) : "";
  let near: { index: number; offset: number } | null = null;
  let named: { index: number; offset: number } | null = null;
  for (const [index, ours] of access.stations.entries()) {
    const offset = haversineMeters(ours.lat, ours.lng, station.lat, station.lng);
    if (offset > STATION_MATCH_M) continue;
    if (near === null || offset < near.offset) near = { index, offset };
    const mine = nameKey(ours.name);
    if (theirs && mine && (theirs.startsWith(mine) || mine.startsWith(theirs))) {
      if (named === null || offset < named.offset) named = { index, offset };
    }
  }
  return (named ?? near)?.index ?? null;
}

/**
 * The cell keeps each point's STATIONS_PER_CELL shortest street walks
 * (scripts/build_station_walk_access.py), so a station we can name that the
 * covered cell leaves out is known to be a longer walk than every one it
 * keeps. It has no number, but it never wins a comparison.
 */
const LONGER_THAN_KEPT = Number.POSITIVE_INFINITY;

function walkLookup(
  from: { lat: number; lng: number },
  station: { lat: number; lng: number; name?: string },
  access: StationWalkAccess,
): number | null {
  const walks = access.cells[cellKey(from.lat, from.lng)];
  if (!walks) return null;
  const index = matchStation(station, access);
  if (index === null) return null;
  const kept = walks.find(([walkIndex]) => walkIndex === index);
  if (!kept) return LONGER_THAN_KEPT;
  const ours = access.stations[index]!;
  // The floor is the straight line to where the walk ends: the nearest door
  // when the table routed to entrances, TfL's station point otherwise.
  const point = coarsenViewerPoint(from);
  const ends = ours.entrances ?? [[station.lat, station.lng]];
  const straight = Math.min(...ends.map(([lat, lng]) => haversineMeters(point.lat, point.lng, lat, lng)));
  return Math.max(kept[1], straight);
}

function isStation(value: unknown): value is AccessStation {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    typeof s.lat === "number" &&
    Number.isFinite(s.lat) &&
    typeof s.lng === "number" &&
    Number.isFinite(s.lng) &&
    (s.entrances === undefined ||
      (Array.isArray(s.entrances) &&
        s.entrances.length > 0 &&
        s.entrances.every(
          (door) =>
            Array.isArray(door) &&
            door.length === 2 &&
            door.every((n) => typeof n === "number" && Number.isFinite(n)),
        )))
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
  station: { lat: number; lng: number; name?: string },
  access: StationWalkAccess = bundledAccess(),
): number | null {
  const metres = walkLookup(from, station, access);
  return metres === LONGER_THAN_KEPT ? null : metres;
}

type CandidateStation = { lat?: number; lon?: number; commonName?: string };

/**
 * Pick the station a drinker reaches soonest on foot from TfL's candidates.
 *
 * TfL's StopPoint search lists stations nearest first along the straight
 * line, and the first is not always the shortest walk: across Zone 1, 904 of
 * 6,907 grid points and 73 of the 663 curated pubs inside it reach a
 * different station first on foot. Re-ranking
 * applies only when TfL's own first choice is a station the covered cell can
 * speak for: either a street walk, or one of ours the cell leaves out, which
 * is longer than every walk it keeps. So every comparison is street against
 * street. When TfL's first is a station we cannot name, TfL's order stands.
 */
export function chooseByStreetWalk<T extends CandidateStation>(
  from: { lat: number; lng: number },
  candidates: readonly T[],
  access: StationWalkAccess = bundledAccess(),
): T | null {
  const first = candidates[0];
  if (!first) return null;
  const walkTo = (candidate: T): number | null =>
    typeof candidate.lat === "number" && typeof candidate.lon === "number"
      ? walkLookup(from, { lat: candidate.lat, lng: candidate.lon, name: candidate.commonName }, access)
      : null;
  let best = first;
  let bestWalk = walkTo(first);
  if (bestWalk === null) return first;
  for (const candidate of candidates.slice(1)) {
    const walk = walkTo(candidate);
    if (walk !== null && walk < bestWalk) {
      best = candidate;
      bestWalk = walk;
    }
  }
  return best;
}
