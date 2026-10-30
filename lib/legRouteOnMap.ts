// The way to the next stop the reader chose in Night Mode ("Ways to get there",
// components/night/NightWaysThere.tsx), held for the map to draw
// (components/PubMapCanvas.tsx). One chosen option at a time, in this tab's
// memory only: it is the reader's own pick for tonight, never stored or sent.

import type { LegOption } from "@/lib/legOptions";

export type LegRouteOnMap = {
  /** The leg it belongs to: "<from venue id>><to venue id>". */
  legKey: string;
  option: LegOption;
};

let current: LegRouteOnMap | null = null;
const listeners = new Set<() => void>();

export function readLegRouteOnMap(): LegRouteOnMap | null {
  return current;
}

/** Draw this option on the map, or clear it with null. */
export function showLegRouteOnMap(next: LegRouteOnMap | null): void {
  current = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeLegRouteOnMap(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function legKeyFor(fromVenueId: string, toVenueId: string): string {
  return `${fromVenueId}>${toVenueId}`;
}

/**
 * The chosen way, only while its leg is tonight's current leg on the map: from
 * the stop before tonight's next stop to that next stop, in the order the map
 * draws the plan (`routeIds`). Anything else draws nothing: a way kept from a
 * leg the night has left, after the final stop (no next stop), with no plan,
 * or on a crawl the reader built (the map then has no next stop for tonight).
 */
export function legRouteForCurrentLeg(
  choice: LegRouteOnMap | null,
  routeIds: readonly string[],
  nextVenueId: string,
): LegRouteOnMap | null {
  if (!choice || !nextVenueId) return null;
  const at = routeIds.indexOf(nextVenueId);
  if (at < 1) return null;
  return choice.legKey === legKeyFor(routeIds[at - 1]!, nextVenueId) ? choice : null;
}
