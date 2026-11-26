import { PEEK_AGING_SUFFIX } from "@/components/map/VenuePeekPintPrice";
import { comparableVenuePint, selectedComparableVenuePint, type PintCapSignals } from "@/lib/comparableVenuePint";
import type { CuratedWalk } from "@/lib/curatedWalk";
import { haversineKm } from "@/lib/haversine";
import { buildMapVenueListModel, type MapVenueListModel } from "@/lib/mapVenueList";
import { mapVenueListPriceEvidence } from "@/lib/mapVenueListPrice";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";
import { priceAgeFor } from "@/lib/priceTier";
import { venueBundlePrices, venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { distanceToPathMetres } from "@/lib/walkRoute";
import type { ZonePintIndex } from "@/lib/zones";

/** A pub is on the walk when it is this close to the walking line: about two minutes off it. */
export const WALK_PUB_REACH_METRES = 150;

type CuratedWalkPubRow = MapVenueListModel["rows"][number] & { priceQualification?: string };

export type CuratedWalkStopPubs = {
  rows: CuratedWalkPubRow[];
  /** The cheapest pint with complete evidence. An estimate never sets it. */
  cheapestGbp: number | null;
  cheapestEvidence: { venueName: string; source: string; observedAt: string } | null;
};

export type CuratedWalkPubs = CuratedWalkStopPubs & {
  /** One entry per stop, in walk order. A pub is listed once, under its nearest stop, nearest first. */
  byStop: Map<string, CuratedWalkStopPubs>;
  total: number;
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
  const nearby = new Map(walk.stops.map((stop) => [stop.id, { venues: [] as Venue[], cheapestGbp: null as number | null, cheapestEvidence: null as CuratedWalkStopPubs["cheapestEvidence"] }]));
  const reach = reachBox(walk);
  for (const venue of venues) {
    if (!isPubVenue(venue)) continue;
    const point: [number, number] = [venue.longitude, venue.latitude];
    if (!(point[0] >= reach.west && point[0] <= reach.east && point[1] >= reach.south && point[1] <= reach.north)) continue;
    if (!(distanceToPathMetres(point, walk.path) <= WALK_PUB_REACH_METRES)) continue;
    let nearestStop = walk.stops[0];
    let nearestKm = Number.POSITIVE_INFINITY;
    for (const stop of walk.stops) {
      const km = haversineKm([stop.longitude, stop.latitude], point);
      if (km < nearestKm) { nearestKm = km; nearestStop = stop; }
    }
    if (!nearestStop) continue;
    const group = nearby.get(nearestStop.id)!;
    group.venues.push(venue);
    const signal = venueSignals?.get(venue.id);
    const price = comparableVenuePint(venue, signal, false);
    if (price !== null && (group.cheapestGbp === null || price < group.cheapestGbp)) {
      const selected = selectedComparableVenuePint(venue, signal, false);
      group.cheapestGbp = price;
      group.cheapestEvidence = selected?.priceSource && selected.priceObservedAt
        ? { venueName: venue.name, source: selected.priceSource, observedAt: selected.priceObservedAt }
        : null;
    }
  }
  const byStop = new Map(walk.stops.map((stop) => {
    const group = nearby.get(stop.id)!;
    const { rows } = buildMapVenueListModel(
      group.venues, [stop.longitude, stop.latitude], undefined, null, "this view", "ready", "nearest", venueSignals, zoneIndex,
    );
    const venueById = new Map(group.venues.map((venue) => [venue.id, venue]));
    const qualifiedRows = rows.map((row): CuratedWalkPubRow => {
      const venue = venueById.get(row.id)!;
      // An anchor figure prints its own source and date.
      if (row.anchor) return row;
      const signal = venueSignals?.get(row.id);
      const evidence = mapVenueListPriceEvidence(venue, signal, null, zoneIndex);
      if (evidence) {
        return { ...row, priceQualification: `${evidence.sourceLabel} · ${evidence.dateKind} ${evidence.dateLabel}` };
      }
      const lane = venuePriceLane(venue, signal?.latestContributorPrice, venueSourcedPrice(venue), venueBundlePrices(venue, zoneIndex));
      if (lane?.lane !== "baseline") return row;
      const publisher = lane.publisher?.label ?? lane.listedIndex?.label ?? venue.priceSource ?? null;
      const observedOn = lane.observedOn ?? venue.priceObservedAt ?? null;
      const caption = nearPriceTrustLabel(
        publisher ? "named" : "unrecorded", publisher, observedOn,
      );
      return {
        ...row,
        priceQualification: caption + (priceAgeFor("published", observedOn) === "aging" ? PEEK_AGING_SUFFIX : ""),
      };
    });
    return [stop.id, { rows: qualifiedRows, cheapestGbp: group.cheapestGbp, cheapestEvidence: group.cheapestEvidence }];
  }));
  const groups = [...byStop.values()];
  return {
    byStop,
    rows: groups.flatMap((group) => group.rows),
    total: groups.reduce((sum, group) => sum + group.rows.length, 0),
    cheapestGbp: groups.reduce<number | null>((lowest, group) => cheaper(lowest, group.cheapestGbp), null),
    cheapestEvidence: groups.reduce<CuratedWalkStopPubs | null>((winner, group) => group.cheapestGbp !== null && (winner?.cheapestGbp == null || group.cheapestGbp < winner.cheapestGbp) ? group : winner, null)?.cheapestEvidence ?? null,
  };
}

function cheaper(current: number | null, candidate: number | null): number | null {
  if (candidate === null) return current;
  return current === null || candidate < current ? candidate : current;
}

/** The walk's bounds grown by the reach, so a pub across town never costs a pass over the line. */
function reachBox(walk: CuratedWalk) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lng, lat] of walk.path) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const latPad = WALK_PUB_REACH_METRES / 111_320;
  const lngPad = latPad / Math.cos(((south + north) / 2) * Math.PI / 180);
  return { west: west - lngPad, east: east + lngPad, south: south - latPad, north: north + latPad };
}
