// A named route (lib/namedRoutes.ts) as the plain crawl the two wild crawl
// surfaces draw (lib/wildPintLineCrawl.ts). Server side: the page that already
// renders the route builds this beside it, so every figure on the Pint Line
// and the receipt is the figure the stop list prints.
//
// The walk figures stay straight-line estimates at WALK_KMH, worked out the
// way `straightLineMinutesLabel` does, and the surfaces say "about" and
// "straight-line estimate" beside them.

import { formatObservedDate } from "@/lib/dataFreshness";
import type { NamedRoute } from "@/lib/namedRoutes";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { WALK_KMH } from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";
import type { WildCrawl, WildCrawlStop } from "@/lib/wildPintLineCrawl";
import { londonDayKey } from "@/lib/londonHour";

/** Whole minutes for a straight-line walk, never 0 (as `straightLineMinutesLabel`). */
export function straightLineMinutes(km: number): number {
  return Math.max(1, Math.ceil((km / WALK_KMH) * 60));
}

/** "2026-10-02" → "2 October 2026", or null for a day that is unreadable or still ahead. */
export function readDayLabel(readDay: string | null, now = Date.now()): string | null {
  if (!readDay || !/^\d{4}-\d{2}-\d{2}$/.test(readDay)) return null;
  // Noon UTC is the same calendar day in London in every season.
  const at = Date.parse(`${readDay}T12:00:00Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== readDay) return null;
  const today = londonDayKey(now);
  if (readDay > today) return null;
  return formatObservedDate(new Date(at));
}

export function wildCrawlFromNamedRoute(
  route: NamedRoute,
  venues: readonly Venue[],
  drinkName: (raw: string) => string = (raw) => raw,
  now = Date.now(),
): WildCrawl {
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const stops: WildCrawlStop[] = route.stops.map((stop) => {
    const venue = byId.get(stop.venueId);
    const point =
      venue && Number.isFinite(venue.longitude) && Number.isFinite(venue.latitude)
        ? ([venue.longitude, venue.latitude] as const)
        : null;
    const pint = stop.pint
      ? {
          priceGbp: stop.pint.priceGbp,
          drink: drinkName(stop.pint.drinkName),
          band: priceBand(stop.pint.priceGbp, priceBandAreaForVenue(stop.venueId)),
          source: stop.pint.source,
          readDay: stop.pint.readDay,
          readDayLabel: readDayLabel(stop.pint.readDay, now),
        }
      : null;
    return {
      position: stop.position,
      name: stop.name,
      point,
      pint,
      legMinutes: stop.legKm !== null ? straightLineMinutes(stop.legKm) : null,
    };
  });
  return {
    name: route.crawl.name,
    plannedStops: route.crawl.venueIds.length,
    stops,
    totalKm: route.totalKm,
    totalMinutes: route.totalKm !== null ? straightLineMinutes(route.totalKm) : null,
  };
}
