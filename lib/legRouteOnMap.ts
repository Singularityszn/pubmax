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
