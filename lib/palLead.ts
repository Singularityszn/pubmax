import type { LegOption } from "@/lib/legOptions";

// Pal leads the way: when the reader chooses a way to the next stop in Night
// Mode ("Ways to get there", lib/legRouteOnMap.ts), their Pal walks that exact
// path on the map and says one short line about the choice. Every line reads
// a mark the list itself shows (fastest, cheapest, a fare TfL did not list, a
// straight-line estimate), so the Pal never claims anything the data does not.

type LngLat = [number, number];

/** The whole way as one path: each part's path in order, the shared joints once. */
export function palLeadPath(option: LegOption): LngLat[] {
  const path: LngLat[] = [];
  for (const part of option.parts) {
    for (const point of part.path) {
      const last = path.at(-1);
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      path.push(point);
    }
  }
  return path;
}

/** The Pal's one line about the way the reader chose. */
export function palLeadLine(option: LegOption): string {
  if (option.estimate) return "No street map for this one. I'll go straight-ish.";
  if (option.fastest && option.cheapest) return "Fastest and cheapest. We never get both.";
  if (option.cheapest) return option.farePence === 0 ? "Free and cheapest. Legs it is." : "Cheapest way. More coins for later.";
  if (option.fastest) return "Fastest way. Keep up.";
  if (option.farePence === null) return "TfL won't say the fare. Bold choice.";
  return "This way. Follow me.";
}

/**
 * The plan walk the Pal goes back to when it stops leading: the last plan walk,
 * only while it is still the walk of the route on the map (`routeKey`, the
 * map's own route identity). A plan that ended or changed meanwhile has no walk
 * to go back to, so the Pal keeps whatever the map now gives it: a perch beside
 * the open pub, or no Pal at all.
 */
export function planWalkAfterLead<Walk extends { key: string }>(planWalk: Walk | null, routeKey: string): Walk | null {
  return planWalk && routeKey !== "" && planWalk.key === routeKey ? planWalk : null;
}
