// The Pal's walk along a crawl route (palMarker.ts), as pure arithmetic: how
// long the route is, where along it each stop falls, and where the Pal is at a
// given moment of its walk. Nothing here touches the map or the DOM.

export type LngLat = [number, number];

export type PalWalkPlan = {
  path: LngLat[];
  /** Metres walked at each vertex of `path`. */
  cumulative: number[];
  total: number;
  /** Metres along `path` at which each stop falls, in route order. */
  stopsAt: number[];
  /** How long the walk takes, pauses included. */
  durationMs: number;
};

export type PalWalkMoment = {
  at: LngLat;
  /** Metres along the path. */
  metres: number;
  /** 1 walking east, -1 walking west. */
  heading: 1 | -1;
  /** The index of the stop the Pal is pausing at, or null while it walks. */
  pausedAt: number | null;
  done: boolean;
};

/** The pause at each stop between the first and the last. */
export const PAL_WALK_PAUSE_MS = 700;
const MS_PER_METRE = 6;
// A trip to a stop the reader tapped is brisker than the crawl walk.
const VISIT_MS_PER_METRE = 4;
const MIN_VISIT_MS = 600;
const MAX_VISIT_MS = 3_500;
const MIN_WALK_MS = 5_000;
const MAX_WALK_MS = 16_000;
const METRES_PER_DEGREE = 111_320;

function metresBetween(a: LngLat, b: LngLat): number {
  const latitude = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * METRES_PER_DEGREE * Math.cos(latitude);
  const dy = (b[1] - a[1]) * METRES_PER_DEGREE;
  return Math.hypot(dx, dy);
}

/** The walking time for a route of this length, before the pauses. */
export function palWalkMs(totalMetres: number): number {
  return Math.min(MAX_WALK_MS, Math.max(MIN_WALK_MS, totalMetres * MS_PER_METRE));
}

/** The time a trip of this many metres along the route takes. */
export function palVisitMs(metres: number): number {
  return Math.min(MAX_VISIT_MS, Math.max(MIN_VISIT_MS, Math.abs(metres) * VISIT_MS_PER_METRE));
}

/** Every LineString in a route FeatureCollection, joined in order. */
export function palWalkPathFrom(line: GeoJSON.FeatureCollection): LngLat[] {
  const path: LngLat[] = [];
  for (const feature of line.features) {
    const geometry = feature.geometry;
    const parts =
      geometry?.type === "LineString" ? [geometry.coordinates]
        : geometry?.type === "MultiLineString" ? geometry.coordinates
          : [];
    for (const part of parts) {
      for (const point of part) path.push([point[0]!, point[1]!]);
    }
  }
  return path;
}

/** The stops from the canvas's `lng,lat;lng,lat` route key. */
export function palWalkStopsFromKey(key: string): LngLat[] {
  return key
    .split(";")
    .map((pair) => pair.split(",").map(Number) as LngLat)
    .filter((point) => point.length === 2 && point.every(Number.isFinite));
}

export function palWalkPlan(path: LngLat[], stops: LngLat[]): PalWalkPlan | null {
  if (path.length < 2 || stops.length < 2) return null;
  const cumulative = [0];
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + metresBetween(path[index - 1]!, path[index]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (!(total > 0)) return null;
  // Each stop falls at its nearest vertex at or after the previous stop's, so
  // a road line that doubles back never sends the Pal backwards.
  let from = 0;
  const stopsAt = stops.map((stop, index) => {
    if (index === 0) return 0;
    if (index === stops.length - 1) return total;
    let best = from;
    let bestMetres = Infinity;
    for (let vertex = from; vertex < path.length; vertex += 1) {
      const away = metresBetween(stop, path[vertex]!);
      if (away < bestMetres) {
        bestMetres = away;
        best = vertex;
      }
    }
    from = best;
    return cumulative[best]!;
  });
  return {
    path,
    cumulative,
    total,
    stopsAt,
    durationMs: palWalkMs(total) + PAL_WALK_PAUSE_MS * (stops.length - 2),
  };
}

/** The point `metres` along the path, and which way that stretch runs. */
export function palWalkPointAt(plan: PalWalkPlan, metres: number): { at: LngLat; metres: number; heading: 1 | -1 } {
  const { path, cumulative } = plan;
  let segment = 1;
  while (segment < path.length - 1 && cumulative[segment]! < metres) segment += 1;
  const a = path[segment - 1]!;
  const b = path[segment]!;
  const span = cumulative[segment]! - cumulative[segment - 1]!;
  const t = span > 0 ? Math.min(1, Math.max(0, (metres - cumulative[segment - 1]!) / span)) : 1;
  return {
    at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    metres,
    heading: b[0] < a[0] ? -1 : 1,
  };
}

/** Where the Pal is `elapsedMs` into its walk. */
export function palWalkAt(plan: PalWalkPlan, elapsedMs: number): PalWalkMoment {
  const msPerMetre = palWalkMs(plan.total) / plan.total;
  let left = Math.max(0, elapsedMs);
  for (let leg = 0; leg < plan.stopsAt.length - 1; leg += 1) {
    const from = plan.stopsAt[leg]!;
    const to = plan.stopsAt[leg + 1]!;
    const legMs = (to - from) * msPerMetre;
    if (left < legMs) return { ...palWalkPointAt(plan, from + left / msPerMetre), pausedAt: null, done: false };
    left -= legMs;
    const last = leg + 1 === plan.stopsAt.length - 1;
    if (!last) {
      if (left < PAL_WALK_PAUSE_MS) return { ...palWalkPointAt(plan, to), pausedAt: leg + 1, done: false };
      left -= PAL_WALK_PAUSE_MS;
    }
  }
  return { ...palWalkPointAt(plan, plan.total), pausedAt: null, done: true };
}
