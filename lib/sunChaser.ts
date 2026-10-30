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

export type LngLat = readonly [number, number];

/** One building outline. `rings[0]` is the outer ring, the rest are courtyards. */
export type SunBuilding = {
  rings: ReadonlyArray<ReadonlyArray<LngLat>>;
  /** Roof height above the ground in metres, or null when the source has none. */
  heightM: number | null;
};

export type SunState = "sun" | "shade" | "set" | "unknown";

/** A shadow can reach this far at most. Past it the low sun is near setting anyway. */
export const MAX_SHADOW_REACH_M = 300;
/** The test point is a seated drinker's head, not the ground. */
export const GARDEN_EYE_HEIGHT_M = 1.2;
/** A building with no recorded height is assumed this tall when asking whether it COULD shade. */
export const UNKNOWN_HEIGHT_REACH_M = 30;
/** With no building at all this close, the tiles are taken to hold no data here. */
export const BUILDING_COVERAGE_RADIUS_M = 120;
export const SUN_CHASER_STEP_MINUTES = 30;
export const SUN_CHASER_HORIZON_MINUTES = 6 * 60;

const METRES_PER_DEG_LAT = 110_540;
const METRES_PER_DEG_LNG_AT_EQUATOR = 111_320;

type Point = { x: number; y: number };
type LocalBuilding = { rings: Point[][]; heightM: number | null; minDistM: number };

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
 * Distance along the ray from the origin (unit direction `d`) to the first
 * wall it crosses, or null when it crosses none within `reach` metres.
 */
function firstWallHit(rings: readonly Point[][], d: Point, reach: number): number | null {
  let best: number | null = null;
  for (const ring of rings) {
    for (const [a, b] of walls(ring)) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = d.x * ey - d.y * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (a.x * ey - a.y * ex) / denom;
      const s = (a.x * d.y - a.y * d.x) / denom;
      if (t <= 0 || t > reach || s < 0 || s > 1) continue;
      if (best === null || t < best) best = t;
    }
  }
  return best;
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
  const local: LocalBuilding[] = [];
  let covered = false;
  for (const building of buildings) {
    const rings = building.rings
      .map((ring) => ring.map((vertex) => toLocal(point, cosLat, vertex)))
      .filter((ring) => ring.length >= 3);
    if (rings.length === 0) continue;
    const minDistM = polygonContainsOrigin(rings) ? 0 : nearestVertexDistance(rings);
    if (minDistM <= BUILDING_COVERAGE_RADIUS_M) covered = true;
    if (minDistM > MAX_SHADOW_REACH_M) continue;
    const heightM = typeof building.heightM === "number" && Number.isFinite(building.heightM) && building.heightM >= 0
      ? building.heightM
      : null;
    local.push({ rings, heightM, minDistM });
  }
  return covered ? { point, buildings: local } : null;
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
  for (const building of surroundings.buildings) {
    // The pub's own footprint: the garden is outside it on a side no source records.
    if (building.minDistM === 0) continue;
    const roofAboveEye = (building.heightM ?? UNKNOWN_HEIGHT_REACH_M) - GARDEN_EYE_HEIGHT_M;
    if (roofAboveEye <= 0) continue;
    const reach = Math.min(roofAboveEye / tanAlt, MAX_SHADOW_REACH_M);
    if (building.minDistM > reach) continue;
    const hit = firstWallHit(building.rings, direction, reach);
    if (hit === null) continue;
    if (building.heightM === null) {
      unknown = true;
      continue;
    }
    return "shade";
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
  { stepMinutes = SUN_CHASER_STEP_MINUTES, horizonMinutes = SUN_CHASER_HORIZON_MINUTES } = {},
): SunTimeline {
  const stepMs = stepMinutes * 60_000;
  const start = from.getTime();
  const end = start + horizonMinutes * 60_000;
  const segments: SunSegment[] = [];
  let segmentStart = start;
  let state = sunStateAt(surroundings, new Date(start));
  for (let t = start + stepMs; t <= end; t += stepMs) {
    const next = sunStateAt(surroundings, new Date(t));
    if (next === state) continue;
    let lo = t - stepMs;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (sunStateAt(surroundings, new Date(mid)) === state) lo = mid;
      else hi = mid;
    }
    segments.push({ state, start: new Date(segmentStart), end: new Date(hi) });
    segmentStart = hi;
    state = sunStateAt(surroundings, new Date(hi));
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

export type SunEstimate =
  | { kind: "estimate"; timeline: SunTimeline }
  | { kind: "no-estimate"; reason: "no-outdoor-space" | "no-building-data" };

/** The whole answer for one pub, failing closed on either missing input. */
export function estimateSun(input: {
  point: LngLat;
  hasRecordedOutdoorSpace: boolean;
  /** Null when the map has no building data loaded at all. */
  buildings: readonly SunBuilding[] | null;
  from: Date;
}): SunEstimate {
  if (!input.hasRecordedOutdoorSpace) return { kind: "no-estimate", reason: "no-outdoor-space" };
  if (!input.buildings || input.buildings.length === 0) return { kind: "no-estimate", reason: "no-building-data" };
  const surroundings = prepareSunSurroundings(input.point, input.buildings);
  if (!surroundings) return { kind: "no-estimate", reason: "no-building-data" };
  return { kind: "estimate", timeline: buildSunTimeline(surroundings, input.from) };
}

// ---------------------------------------------------------------------------
// Words. Every line is an estimate and says so through SUN_ESTIMATE_CAVEAT.

export const SUN_ESTIMATE_CAVEAT = "Estimate from building heights and sun angle, not a weather report.";

/** "17:40" in London time. A change found to the minute is shown to five. */
export function formatSunClock(at: Date): string {
  const rounded = new Date(Math.floor(at.getTime() / 300_000) * 300_000);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).format(rounded);
}

/** The weather feed's own condition word, as a short "now" phrase, or null for one it does not know. */
const SKY_NOW: Record<string, string> = {
  Cloudy: "cloudy",
  Fog: "foggy",
  Drizzle: "drizzling",
  Rain: "raining",
  Snow: "snowing",
  Thunderstorm: "stormy",
};

/**
 * The cloud half, only for the present moment and only when the weather feed
 * gave a fresh reading that is not clear. A future time gets no cloud claim:
 * the feed reads the sky now, not later.
 */
export function sunSkyNote(state: SunState, isNow: boolean, skyCondition: string | null | undefined): string | null {
  if (!isNow || state !== "sun" || !skyCondition) return null;
  const word = SKY_NOW[skyCondition];
  return word ? `Sunny spot, but ${word} now (Open-Meteo).` : null;
}

/** The headline for one pub at one chosen moment. */
export function sunHeadline(estimate: SunEstimate, at: Date, isNow: boolean): string {
  if (estimate.kind === "no-estimate") {
    return estimate.reason === "no-outdoor-space"
      ? "No sun estimate: no recorded garden or outdoor seating."
      : "No sun estimate: no building heights loaded here.";
  }
  const { timeline } = estimate;
  const segment = segmentAt(timeline, at);
  if (!segment) return "No sun estimate for this time.";
  const when = isNow ? "now" : `at ${formatSunClock(at)}`;
  const reachesEnd = segment.end.getTime() >= timeline.to.getTime();
  const index = timeline.segments.indexOf(segment);
  const next = timeline.segments[index + 1];
  switch (segment.state) {
    case "sun":
      return reachesEnd
        ? `Sun on the garden until at least ${formatSunClock(timeline.to)}`
        : next?.state === "set"
          ? `Sun on the garden until sunset, about ${formatSunClock(segment.end)}`
          : `Sun on the garden until ${formatSunClock(segment.end)}`;
    case "shade": {
      const sunLater = timeline.segments.slice(index + 1).find((later) => later.state === "sun");
      return sunLater
        ? `Garden in shade ${when}. Sun from ${formatSunClock(sunLater.start)}`
        : `Garden in shade ${when}, and no sun before ${formatSunClock(next?.state === "set" ? next.start : timeline.to)}`;
    }
    case "set":
      return "After sunset. No sun on the garden.";
    default:
      return `No sun estimate ${when}: a nearby building has no recorded height.`;
  }
}
