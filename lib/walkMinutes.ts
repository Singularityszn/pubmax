import { WALK_KMH } from "@/lib/routeLegs";

/**
 * Whole walking minutes for a straight-line distance at the shared pace.
 *
 * A real positive walk never reads 0 minutes. The empty case is the one
 * difference last-train still needs: a missing distance there is 0 so the
 * leave-by clock does not invent a walk, while near-me and tonight print 1
 * so a co-located pub never reads "0 min".
 */
export function walkMinutesFromKm(km: number, emptyMinutes = 1): number {
  if (!Number.isFinite(km) || km <= 0) return emptyMinutes;
  return Math.max(1, Math.round((km / WALK_KMH) * 60));
}
