// The Pub Pal's draft crawl: which of its ranked pubs it proposes, and in
// what order.
//
// A draft is a promise that Plan can keep it. Plan refuses a route with a leg
// over 1.6 km or a walk over 3 km (lib/planRouteOptimizer.ts), so the Pal asks
// that same rule (`straightLineWalkableKm`) before it proposes anything. It
// used to take the top three ranked pubs as they came, and in Clapham that put
// The Pheonix 2.8 km from the other two: a crawl Plan could never walk.
//
// Pure: no I/O, no clock. The order of the ranking is the order of preference.

import { straightLineWalkableKm } from "@/lib/planRouteOptimizer";

export type DraftCandidate<T> = {
  value: T;
  lat: number;
  lng: number;
  /** Higher is better. The caller's own ranking score. */
  score: number;
};

/** Every ordered pick of `size` items from `pool` (pool order kept per pick). */
function orderedPicks<T>(pool: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const picks: T[][] = [];
  pool.forEach((item, index) => {
    const rest = [...pool.slice(0, index), ...pool.slice(index + 1)];
    for (const tail of orderedPicks(rest, size - 1)) picks.push([item, ...tail]);
  });
  return picks;
}

/**
 * The best walkable crawl of `size` stops from a ranked list, or null.
 *
 * The highest-ranked pub that can start a walkable crawl is Stop 1. Its
 * companions are the pair (or more) with the highest combined score that
 * keeps the whole route walkable, ordered for the shortest walk; ties go to
 * the shorter walk, then to the ranking order. A draft that cannot be walked
 * is never returned, whatever the scores.
 */
export function walkableDraftRoute<T>(ranked: readonly DraftCandidate<T>[], size = 3): T[] | null {
  if (size < 1 || ranked.length < size) return null;
  for (let first = 0; first < ranked.length; first += 1) {
    const start = ranked[first]!;
    const others = ranked.filter((_, index) => index !== first);
    let best: { route: DraftCandidate<T>[]; score: number; km: number } | null = null;
    for (const tail of orderedPicks(others, size - 1)) {
      const route = [start, ...tail];
      const km = straightLineWalkableKm(route);
      if (km === null) continue;
      const score = tail.reduce((total, stop) => total + stop.score, 0);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && km < best.km - 1e-9)) {
        best = { route, score, km };
      }
    }
    if (best) return best.route.map((stop) => stop.value);
  }
  return null;
}

/**
 * The crawl for an ask whose best pubs are spread out (no area named, so the
 * ranking spans London): start at each ranked pub in turn and take its best
 * companions from `companionsOf`, the caller's own ranking of pubs near it.
 * The first seed that can start a walkable crawl starts the draft, so the
 * Pal's top pick still leads whenever it can.
 */
export function walkableDraftAround<T>(
  seeds: readonly DraftCandidate<T>[],
  companionsOf: (seed: DraftCandidate<T>) => readonly DraftCandidate<T>[],
  size = 3,
): T[] | null {
  for (const seed of seeds) {
    const route = walkableDraftRoute([seed, ...companionsOf(seed).filter((stop) => stop.value !== seed.value)], size);
    if (route && route[0] === seed.value) return route;
  }
  return null;
}
