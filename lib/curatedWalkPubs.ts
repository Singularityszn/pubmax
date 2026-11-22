import { comparableVenuePint, type PintCapSignals } from "@/lib/comparableVenuePint";
import type { CuratedWalk } from "@/lib/curatedWalk";
import { haversineKm } from "@/lib/haversine";
import { buildMapVenueListModel, type MapVenueListModel } from "@/lib/mapVenueList";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { distanceToPathMetres } from "@/lib/walkRoute";
import type { ZonePintIndex } from "@/lib/zones";

/** A pub is on the walk when it is this close to the walking line: about two minutes off it. */
export const WALK_PUB_REACH_METRES = 150;

export type CuratedWalkPubRow = MapVenueListModel["rows"][number];

export type CuratedWalkPubs = {
  /** One entry per stop, in walk order. A pub is listed once, under its nearest stop, nearest first. */
  byStop: Map<string, CuratedWalkPubRow[]>;
  total: number;
  /** The cheapest pint with complete evidence. An estimate never sets it. */
  cheapestGbp: number | null;
};

/**
 * The pubs a walker passes. The list rows come from the map's own list model,
 * so a figure here is the same figure, with the same standing, as List view.
 */
export function curatedWalkPubs(
  walk: CuratedWalk,
  venues: readonly Venue[],
  venueSignals: PintCapSignals | null = null,
  zoneIndex: ZonePintIndex | null = null,
): CuratedWalkPubs {
  const nearby = new Map<string, Venue[]>(walk.stops.map((stop) => [stop.id, []]));
  let cheapestGbp: number | null = null;
  let total = 0;
  for (const venue of venues) {
    if (!isPubVenue(venue)) continue;
    const point: [number, number] = [venue.longitude, venue.latitude];
    if (!(distanceToPathMetres(point, walk.path) <= WALK_PUB_REACH_METRES)) continue;
    let nearestStop = walk.stops[0];
    let nearestKm = Number.POSITIVE_INFINITY;
    for (const stop of walk.stops) {
      const km = haversineKm([stop.longitude, stop.latitude], point);
      if (km < nearestKm) { nearestKm = km; nearestStop = stop; }
    }
    if (!nearestStop) continue;
    nearby.get(nearestStop.id)!.push(venue);
    total += 1;
    const pint = comparableVenuePint(venue, venueSignals?.get(venue.id), false);
    if (pint !== null && (cheapestGbp === null || pint < cheapestGbp)) cheapestGbp = pint;
  }
  const byStop = new Map(walk.stops.map((stop) => [stop.id, buildMapVenueListModel(
    nearby.get(stop.id)!, [stop.longitude, stop.latitude], undefined, null, "this view", "ready", "nearest", venueSignals, zoneIndex,
  ).rows]));
  return { byStop, total, cheapestGbp };
}
