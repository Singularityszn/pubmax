// Sun Chaser: is a pub's garden likely in direct sun, now and for the next few
// hours? Pure maths over a sun angle and building footprints with heights. No
// fetch, no map, no React: the map layer hands in what its vector tiles hold.
//
// HONESTY RULES, because this is a computed figure and never a fact:
//   - Only a pub with a RECORDED garden or outdoor seating gets an estimate.
//   - No building data near the pub means "No sun estimate", never a guess.
//   - A building with no height in the ray's path makes that moment unknown.
//   - Every line says it is an estimate from building heights and sun angle,
//     not a weather report. Cloud is a separate, sourced reading.
//
// LIMITS, said once here and on the pull request: the test is cast from the
// pub's mapped point, not the garden's own outline (no source records where a
// garden is); the pub's own footprint is skipped because the garden is outside
// it on an unknown side; trees, awnings, walls and terrain are not modelled.

import { sunPosition } from "@/lib/weatherDaylight";
import { SUN_CHASER_HORIZON_MINUTES, SUN_CHASER_STEP_MINUTES } from "@/lib/sunChaserWindow";

export { SUN_CHASER_HORIZON_MINUTES, SUN_CHASER_STEP_MINUTES };

export type LngLat = readonly [number, number];

/** One building outline. `rings[0]` is the outer ring, the rest are courtyards. */
export type SunBuilding = {
  rings: ReadonlyArray<ReadonlyArray<LngLat>>;
  /** Roof height above the ground in metres, or null when the source has none. */
  heightM: number | null;
  /** Underside height in metres: a raised part (an overhang, a bridge) lets a low sun under it. */
  baseM?: number;
  /**
   * The source feature id. A tile edge cuts one building into several pieces
   * that share it, so every piece of the pub's own building is skipped, not
   * only the piece holding the pub's point.
   */
  id?: string | number;
};

/**
 * OpenMapTiles writes this roof height for a building with no recorded height
 * or levels (planetiler-openmaptiles fills it in). It is not a measurement, so
 * it is read as unknown rather than as a 5 m building.
 */
export const OPENMAPTILES_DEFAULT_HEIGHT_M = 5;

function finiteMetres(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * One basemap building feature as a sun test reads it, or null for a feature
 * the sun test must not use. `hide_3d` marks an outline whose `building:part`
 * pieces are drawn instead, so the parts answer for it.
 */
export function sunBuildingFromTile(
  properties: Record<string, unknown> | null | undefined,
  rings: ReadonlyArray<ReadonlyArray<LngLat>>,
  id?: string | number,
): SunBuilding | null {
  const props = properties ?? {};
  if (props.hide_3d === true) return null;
  const roof = finiteMetres(props.render_height);
  const heightM = roof === null || roof === OPENMAPTILES_DEFAULT_HEIGHT_M ? null : roof;
  const baseM = finiteMetres(props.render_min_height) ?? 0;
  return { rings, heightM, baseM, ...(id === undefined ? {} : { id }) };
}

export type SunState = "sun" | "shade" | "set" | "unknown";

/** A shadow can reach this far at most. Past it the low sun is near setting anyway. */
const MAX_SHADOW_REACH_M = 300;
/** The test point is a seated drinker's head, not the ground. */
const GARDEN_EYE_HEIGHT_M = 1.2;
/** With no building at all this close, the tiles are taken to hold no data here. */
const BUILDING_COVERAGE_RADIUS_M = 120;

const METRES_PER_DEG_LAT = 110_540;
const METRES_PER_DEG_LNG_AT_EQUATOR = 111_320;

type Point = { x: number; y: number };
type LocalBuilding = { rings: Point[][]; heightM: number | null; baseM: number; minDistM: number };

/** The surroundings of one pub, projected once and reused for every instant. */
export type SunSurroundings = {
  point: LngLat;
  buildings: LocalBuilding[];
};

function toLocal(origin: LngLat, cosLat: number, at: LngLat): Point {
  return {
    x: (at[0] - origin[0]) * METRES_PER_DEG_LNG_AT_EQUATOR * cosLat,
    y: (at[1] - origin[1]) * METRES_PER_DEG_LAT,
  };
}

/** Each wall of a ring as a pair of corners, closing the ring back to its start. */
function* walls(ring: readonly Point[]): Generator<readonly [Point, Point]> {
  let previous = ring[ring.length - 1];
  for (const corner of ring) {
    if (previous) yield [previous, corner];
    previous = corner;
  }
}

function ringContains(ring: readonly Point[], p: Point): boolean {
  let inside = false;
  for (const [a, b] of walls(ring)) {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Inside the outer ring and in no courtyard: the point stands in this building. */
function polygonContainsOrigin(rings: readonly Point[][]): boolean {
  const origin = { x: 0, y: 0 };
  let inside = false;
  for (const ring of rings) if (ringContains(ring, origin)) inside = !inside;
  return inside;
}

function nearestVertexDistance(rings: readonly Point[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (const [a, b] of walls(ring)) best = Math.min(best, segmentDistanceToOrigin(a, b));
  }
  return best;
}

function segmentDistanceToOrigin(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

/**
 * Every distance along the ray from the origin (unit direction `d`) where it
 * meets a wall, nearest first, up to `reach` metres. A corner the ray only
 * touches is in here too, so these are cut points, not enter and leave pairs.
 */
function wallCrossings(rings: readonly Point[][], d: Point, reach: number): number[] {
  const out: number[] = [];
  for (const ring of rings) {
    for (const [a, b] of walls(ring)) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = d.x * ey - d.y * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (a.x * ey - a.y * ex) / denom;
      const s = (a.x * d.y - a.y * d.x) / denom;
      if (t <= 0 || t > reach || s < 0 || s > 1) continue;
      out.push(t);
    }
  }
  return out.sort((x, y) => x - y);
}

/** Inside the outer ring and in no courtyard, for any point. */
function polygonContains(rings: readonly Point[][], p: Point): boolean {
  let inside = false;
  for (const ring of rings) if (ringContains(ring, p)) inside = !inside;
  return inside;
}

/**
 * The stretches of the ray, as [enter, leave] in metres, that lie inside the
 * building. The ray is cut at every wall it meets, and a stretch counts only
 * when its own midpoint is inside, so a corner touch or a courtyard never
 * flips inside and outside.
 */
export function occupiedStretches(rings: readonly Point[][], d: Point, reach: number): Array<[number, number]> {
  const cuts = [0, ...wallCrossings(rings, d, reach), reach];
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const from = cuts[i] ?? 0;
    const to = cuts[i + 1] ?? reach;
    if (to - from < 1e-9) continue;
    const mid = (from + to) / 2;
    if (!polygonContains(rings, { x: d.x * mid, y: d.y * mid })) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - from) < 1e-9) last[1] = to;
    else out.push([from, to]);
  }
  return out;
}

/**
 * Project the buildings around one pub into metres, dropping any that no
 * shadow could reach. Null when no building stands within the coverage
 * radius: the tiles then hold no data here, and the answer is no estimate.
 */
export function prepareSunSurroundings(
  point: LngLat,
  buildings: readonly SunBuilding[],
): SunSurroundings | null {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const cosLat = Math.cos((point[1] * Math.PI) / 180);
  const local: Array<LocalBuilding & { id?: string | number }> = [];
  const ownIds = new Set<string | number>();
  let covered = false;
  for (const building of buildings) {
    const rings = building.rings
      .map((ring) => ring.map((vertex) => toLocal(point, cosLat, vertex)))
      .filter((ring) => ring.length >= 3);
    if (rings.length === 0) continue;
    const inside = polygonContainsOrigin(rings);
    if (inside && building.id !== undefined) ownIds.add(building.id);
    const minDistM = inside ? 0 : nearestVertexDistance(rings);
    if (minDistM <= BUILDING_COVERAGE_RADIUS_M) covered = true;
    if (minDistM > MAX_SHADOW_REACH_M) continue;
    local.push({
      rings,
      heightM: finiteMetres(building.heightM),
      baseM: finiteMetres(building.baseM) ?? 0,
      minDistM,
      id: building.id,
    });
  }
  if (!covered) return null;
  // Every piece of the pub's own building is the pub's own, wherever a tile edge cut it.
  for (const building of local) {
    if (building.id !== undefined && ownIds.has(building.id)) building.minDistM = 0;
  }
  return { point, buildings: local };
}

/** Sun, shade, set or unknown for one pub point at one instant. */
export function sunStateAt(surroundings: SunSurroundings, at: Date): SunState {
  const sun = sunPosition(surroundings.point[1], surroundings.point[0], at);
  if (!sun) return "unknown";
  if (sun.altitudeDeg <= 0) return "set";
  const tanAlt = Math.tan((sun.altitudeDeg * Math.PI) / 180);
  const azimuth = (sun.azimuthDeg * Math.PI) / 180;
  const direction = { x: Math.sin(azimuth), y: Math.cos(azimuth) };
  let unknown = false;
  const rayHeightAt = (distance: number) => GARDEN_EYE_HEIGHT_M + distance * tanAlt;
  for (const building of surroundings.buildings) {
    // The pub's own footprint: the garden is outside it on a side no source records.
    if (building.minDistM === 0) continue;
    const roof = building.heightM;
    if (roof !== null && roof <= GARDEN_EYE_HEIGHT_M) continue;
    // A known roof bounds how far its shadow reaches. An unknown one could be
    // any height, so it is asked about across the whole reach.
    const reach = roof === null ? MAX_SHADOW_REACH_M : Math.min((roof - GARDEN_EYE_HEIGHT_M) / tanAlt, MAX_SHADOW_REACH_M);
    if (building.minDistM > reach) continue;
    for (const [enter, leave] of occupiedStretches(building.rings, direction, MAX_SHADOW_REACH_M)) {
      if (enter > reach) break;
      if (rayHeightAt(leave) <= building.baseM) continue;
      if (roof === null) {
        unknown = true;
        break;
      }
      if (rayHeightAt(enter) < roof) return "shade";
    }
  }
  return unknown ? "unknown" : "sun";
}

/** One stretch of the same state, from `start` up to (not including) `end`. */
export type SunSegment = { state: SunState; start: Date; end: Date };

export type SunTimeline = {
  from: Date;
  to: Date;
  segments: SunSegment[];
};

/**
 * Sample from `from` every step to the horizon, then find each change to the
 * minute by halving the gap between the two samples either side of it.
 */
export function buildSunTimeline(
  surroundings: SunSurroundings,
  from: Date,
  options: { stepMinutes?: number; horizonMinutes?: number } = {},
): SunTimeline {
  return timelineFromStates((ms) => sunStateAt(surroundings, new Date(ms)), from, options);
}

/** The timeline walk over any reading of the state at a minute, so its search can be tested on its own. */
export function timelineFromStates(
  stateAt: (ms: number) => SunState,
  from: Date,
  { stepMinutes = SUN_CHASER_STEP_MINUTES, horizonMinutes = SUN_CHASER_HORIZON_MINUTES } = {},
): SunTimeline {
  const stepMs = stepMinutes * 60_000;
  const start = from.getTime();
  const end = start + horizonMinutes * 60_000;
  const segments: SunSegment[] = [];
  let segmentStart = start;
  let state = stateAt(start);
  for (let t = start + stepMs; t <= end; t += stepMs) {
    const next = stateAt(t);
    // One step can hold more than one change (shade, a gap of sun, then
    // sunset), so keep finding the next change until the walk agrees with
    // the sample at the end of the step. Each pass starts where the state
    // is known to hold and ends where it is known not to.
    let lo = t - stepMs;
    while (state !== next) {
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (stateAt(mid) === state) lo = mid;
        else hi = mid;
      }
      segments.push({ state, start: new Date(segmentStart), end: new Date(hi) });
      segmentStart = hi;
      state = stateAt(hi);
      lo = hi;
    }
  }
  segments.push({ state, start: new Date(segmentStart), end: new Date(end) });
  return { from: new Date(start), to: new Date(end), segments };
}

/** The stretch holding `at`, or null outside the timeline. */
export function segmentAt(timeline: SunTimeline, at: Date): SunSegment | null {
  const t = at.getTime();
  return timeline.segments.find((segment) => t >= segment.start.getTime() && t < segment.end.getTime())
    ?? (t === timeline.to.getTime() ? timeline.segments.at(-1) ?? null : null);
}

/** Buildings bucketed by a coarse grid, so each pub only meets the ones a shadow could reach. */
export type SunBuildingIndex = {
  size: number;
  near: (point: LngLat) => SunBuilding[];
};

const GRID_DEG = 0.0025;

export function indexSunBuildings(buildings: readonly SunBuilding[]): SunBuildingIndex {
  const cells = new Map<string, SunBuilding[]>();
  const cellOf = (deg: number) => Math.floor(deg / GRID_DEG);
  for (const building of buildings) {
    const outer = building.rings[0];
    if (!outer || outer.length === 0) continue;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of outer) {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
    for (let cx = cellOf(minLng); cx <= cellOf(maxLng); cx += 1) {
      for (let cy = cellOf(minLat); cy <= cellOf(maxLat); cy += 1) {
        const key = `${cx}:${cy}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(building);
        else cells.set(key, [building]);
      }
    }
  }
  return {
    size: buildings.length,
    near(point) {
      const dLat = MAX_SHADOW_REACH_M / METRES_PER_DEG_LAT;
      const dLng = MAX_SHADOW_REACH_M / (METRES_PER_DEG_LNG_AT_EQUATOR * Math.cos((point[1] * Math.PI) / 180));
      const found = new Set<SunBuilding>();
      for (let cx = cellOf(point[0] - dLng); cx <= cellOf(point[0] + dLng); cx += 1) {
        for (let cy = cellOf(point[1] - dLat); cy <= cellOf(point[1] + dLat); cy += 1) {
          for (const building of cells.get(`${cx}:${cy}`) ?? []) found.add(building);
        }
      }
      return [...found];
    },
  };
}

export type SunEstimate =
  | { kind: "estimate"; timeline: SunTimeline }
  | { kind: "no-estimate"; reason: "no-outdoor-space" | "no-building-data" | "edge-of-view" };

/** The part of the map whose building tiles are loaded, in degrees. */
export type LoadedArea = { west: number; south: number; east: number; north: number };

/**
 * True when the whole disc a shadow could come from lies inside the loaded
 * area. A pub at the edge of the view may have a tall block just off screen,
 * in tiles that are not loaded, so it gets no estimate rather than a sunny one.
 */
export function shadowDiscLoaded(point: LngLat, area: LoadedArea): boolean {
  const dLat = MAX_SHADOW_REACH_M / METRES_PER_DEG_LAT;
  const dLng = MAX_SHADOW_REACH_M / (METRES_PER_DEG_LNG_AT_EQUATOR * Math.cos((point[1] * Math.PI) / 180));
  return point[0] - dLng >= area.west && point[0] + dLng <= area.east
    && point[1] - dLat >= area.south && point[1] + dLat <= area.north;
}

/** The whole answer for one pub, failing closed on any missing input. */
export function estimateSun(input: {
  point: LngLat;
  hasRecordedOutdoorSpace: boolean;
  /** Null when the map has no building data loaded at all. */
  buildings: readonly SunBuilding[] | null;
  from: Date;
  /** Where building tiles are loaded. Without it the caller vouches for full cover. */
  loadedArea?: LoadedArea;
}): SunEstimate {
  if (!input.hasRecordedOutdoorSpace) return { kind: "no-estimate", reason: "no-outdoor-space" };
  if (!input.buildings || input.buildings.length === 0) return { kind: "no-estimate", reason: "no-building-data" };
  if (input.loadedArea && !shadowDiscLoaded(input.point, input.loadedArea)) {
    return { kind: "no-estimate", reason: "edge-of-view" };
  }
  const surroundings = prepareSunSurroundings(input.point, input.buildings);
  if (!surroundings) return { kind: "no-estimate", reason: "no-building-data" };
  return { kind: "estimate", timeline: buildSunTimeline(surroundings, input.from) };
}

// ---------------------------------------------------------------------------
// Words. Every line is an estimate and says so through SUN_ESTIMATE_CAVEAT.

export const SUN_ESTIMATE_CAVEAT = "Estimate from building heights and sun angle, not a weather report.";

/**
 * "17:40" in London time. A change found to the minute is shown to five, and
 * the rounding always favours the cautious reading: the end of sun rounds down
 * (never claims sun for longer), the start of sun rounds up (never earlier).
 * A time the reader chose on the slider is shown exactly.
 */
export function formatSunClock(at: Date, round: "down" | "up" | "exact" = "down"): string {
  const step = 300_000;
  const ms = at.getTime();
  const shown = round === "exact" ? ms : round === "up" ? Math.ceil(ms / step) * step : Math.floor(ms / step) * step;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).format(new Date(shown));
}

/**
 * The weather feed's own condition word, as a short "now" phrase, or null for
 * one it does not know. The feed's "Cloudy" also covers mainly clear and
 * partly cloudy skies (lib/weatherProvider.ts), so it reads "some cloud".
 */
const SKY_NOW: Record<string, string> = {
  Cloudy: "some cloud",
  Fog: "fog",
  Drizzle: "drizzle",
  Rain: "rain",
  Snow: "snow",
  Thunderstorm: "storms",
};

/** One weather feed reading near the map: its condition word and when it was read. */
export type SkyReading = { condition: string; observedAtMs: number };

/**
 * A cloud note is offered for a reading at most this old. The feed is read
 * every six hours (vercel.json), so most of the day there is no note at all.
 */
export const SKY_READING_MAX_AGE_MS = 3 * 60 * 60_000;

/**
 * The cloud half, only for the present moment, only for a reading no older
 * than SKY_READING_MAX_AGE_MS, and only when that reading is not clear. It
 * names the time of the reading, because the feed reads the sky then, not now.
 * A future time gets no cloud claim at all.
 */
export function sunSkyNote(
  state: SunState,
  isNow: boolean,
  sky: SkyReading | null | undefined,
  nowMs: number,
): string | null {
  if (!isNow || state !== "sun" || !sky) return null;
  const age = nowMs - sky.observedAtMs;
  if (!Number.isFinite(age) || age < -5 * 60_000 || age > SKY_READING_MAX_AGE_MS) return null;
  const phrase = SKY_NOW[sky.condition];
  return phrase ? `Sunny spot, but ${phrase} at ${formatSunClock(new Date(sky.observedAtMs), "exact")} (Open-Meteo reading).` : null;
}

const NO_ESTIMATE_LINES: Record<Extract<SunEstimate, { kind: "no-estimate" }>["reason"], string> = {
  "no-outdoor-space": "No sun estimate: no recorded garden or outdoor seating.",
  "no-building-data": "No sun estimate: no building heights loaded here.",
  "edge-of-view": "No sun estimate: move the map so this pub is not at its edge.",
};

/**
 * The headline for one pub at one chosen moment. Every verdict says "likely":
 * the pub's own building is skipped and the garden's side is not recorded.
 */
export function sunHeadline(estimate: SunEstimate, at: Date, isNow: boolean): string {
  if (estimate.kind === "no-estimate") return NO_ESTIMATE_LINES[estimate.reason];
  const { timeline } = estimate;
  const segment = segmentAt(timeline, at);
  if (!segment) return "No sun estimate for this time.";
  const when = isNow ? "now" : `at ${formatSunClock(at, "exact")}`;
  const reachesEnd = segment.end.getTime() >= timeline.to.getTime();
  const index = timeline.segments.indexOf(segment);
  const next = timeline.segments[index + 1];
  switch (segment.state) {
    case "sun":
      return reachesEnd
        ? `Garden likely in sun until at least ${formatSunClock(timeline.to)}`
        : next?.state === "set"
          ? `Garden likely in sun until sunset, about ${formatSunClock(segment.end)}`
          : `Garden likely in sun until ${formatSunClock(segment.end)}`;
    case "shade": {
      const sunLater = timeline.segments.slice(index + 1).find((later) => later.state === "sun");
      return sunLater
        ? `Garden likely in shade ${when}. Sun likely from ${formatSunClock(sunLater.start, "up")}`
        : `Garden likely in shade ${when}, and no sun likely before ${formatSunClock(next?.state === "set" ? next.start : timeline.to)}`;
    }
    case "set":
      return "After sunset. No sun on the garden.";
    default:
      return `No sun estimate ${when}: a nearby building has no recorded height.`;
  }
}
