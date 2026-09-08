import "server-only";

import { CITIES } from "@/lib/cities";
import { cultureWaypointPois } from "@/lib/cultureCrawl.server";
import { readCityVenueIndex } from "@/lib/venueIndex";

export type PlanGroupOutcomeScope = "london" | "other_city" | "mixed" | "unknown";

/** Route evidence only. An approved cohort specification must interpret it. */
export async function planGroupOutcomeScope(
  stops: readonly { venueId: string }[],
): Promise<PlanGroupOutcomeScope> {
  if (stops.length === 0) return "unknown";
  try {
    const cities = Object.values(CITIES);
    const indexes = await Promise.all(cities.map(city => readCityVenueIndex(city)));
    // A failed pack could contain a conflicting ID. Never assume London by default.
    if (indexes.some(index => index === null)) return "unknown";
    const routeCities = new Set<string>();
    for (const stop of stops) {
      const matches = cities.filter((city, index) => stop.venueId.startsWith("place:")
        ? cultureWaypointPois(city.id).some(poi => `place:${poi.id}` === stop.venueId)
        : indexes[index]?.has(stop.venueId));
      if (matches.length !== 1) return "unknown";
      routeCities.add(matches[0].id);
    }
    if (routeCities.size !== 1) return "mixed";
    return routeCities.has("london") ? "london" : "other_city";
  } catch {
    return "unknown";
  }
}
