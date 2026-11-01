// THE LIST BESIDE THE MAP (launch plan 1 Nov 2026, section 5: "Desktop list
// and map side by side"). From 1024px Explore shows the pubs in the current
// map view in a column on the left, and the map on the right, and the two move
// together. This module is the pure half: which venues the column lists, how
// each row is priced and dated, and in which order.
//
// It reads no data of its own. Membership is the map's own projection of the
// venues on screen (`projectedItemIdsInViewport`, the same one List view
// reads), and the price on a row is the venue sheet's own reading: the ONE
// precedence in lib/venuePriceLane.ts, worded by the phone peek's chip
// (`peekPriceChip`) and aged by the peek's own rule (`peekPriceAging`). Nothing
// here decides a price, a standing or a trust state.

import type { VenueSignal } from "@/components/map/canvas/types";
import { peekPriceAging } from "@/components/map/VenuePeekPintPrice";
import { haversineKm } from "@/lib/haversine";
import {
  drinkLensUnknownRowLabel,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import { MAP_PEEK_MAX_WALK_MINUTES } from "@/lib/mapPeek";
import type {
  LondonRestaurantListModel,
  UkBasePubListModel,
} from "@/lib/mapVenueList";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";
import { dropLaneInputsFor, type PintTrustState } from "@/lib/pintTrust";
import { priceAgeFor } from "@/lib/priceTier";
import { peekPriceChip } from "@/lib/pubMap";
import { formatTrustDay } from "@/lib/trustPill";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { isPubVenueKind, venueKindLabel } from "@/lib/venueKindFilters";
import {
  venueBundlePrices,
  venuePriceLane,
  venueSourcedPrice,
  type VenuePriceLane,
} from "@/lib/venuePriceLane";
import { filterVenues, formatPrice, initialFilters, type Filters, type Venue } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

/** The list waits this long after the map settles before it re-reads the view. */
export const MAP_SPLIT_LIST_DEBOUNCE_MS = 250;

/** Rows drawn at once. "Show more" adds this many again, so every venue stays reachable. */
export const MAP_SPLIT_LIST_PAGE_SIZE = 40;

/** How the column orders the venues it lists. No score, no rating: a price or a distance. */
export type MapSplitListSort = "cheapest" | "nearest";

/** The words a row prints when the map holds no price for the venue at all. */
export const MAP_SPLIT_LIST_NO_PRICE = "No price on the map yet";

export type MapSplitListPrice = {
  /** The printed figure, or null when this reading holds none. */
  figure: string | null;
  /** The figure a band is read from, or null when the reading withholds a band. */
  bandGbp: number | null;
  /** A figure somebody observed wears the price badge; an estimate stays plain. */
  observed: boolean;
  /** The trust wording, from the sheet's own reading. */
  caption: string;
  /** The day the figure was read or logged, when the caption does not already say it. */
  day: string | null;
  /** The published figure is past its window and says so. */
  aging: boolean;
  /** The drop lane's trust state, carried the way the peek chip carries it. */
  trust: PintTrustState | null;
  /**
   * The figure the cheapest order ranks on, or null when this row may not lead
   * a cheapest list. Only a figure the map itself paints may: a drinker's
   * report waiting for a second drinker, a split, an aged report and a
   * modelled estimate follow every ranked row (launch plan 1 Nov 2026: an
   * estimate is never called cheapest).
   */
  rankGbp: number | null;
};

export type MapSplitListRow = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** A curated venue opens the venue sheet; the other two groups carry no price. */
  group: "venue" | "base" | "restaurant";
  /** Straight-line distance from the reader, else from the middle of the map. */
  distanceKm: number | null;
  /** Minutes on foot from the reader's own fix, or null when there is none. */
  walkMinutes: number | null;
  /** The sheet's reading for a curated venue; null for the unpriced groups. */
  price: MapSplitListPrice | null;
  /** What an unpriced row says instead ("Other pub · no listed price"). */
  unpricedLabel: string | null;
  venue: Venue | null;
  basePub: UkBasePub | null;
};

type Point = { lng: number; lat: number };

const NO_PRICE: MapSplitListPrice = {
  figure: null,
  bandGbp: null,
  observed: false,
  caption: MAP_SPLIT_LIST_NO_PRICE,
  day: null,
  aging: false,
  trust: null,
  rankGbp: null,
};

/** The lanes whose figure the map paints on the pin, and so may lead a cheapest list. */
const RANKED_LANES: ReadonlySet<VenuePriceLane["lane"]> = new Set([
  "contributor",
  "sourced",
  "listed",
  "baseline",
]);

/** A day the way every trust caption prints one ("12 Oct"), or null when unreadable. */
export function mapSplitListDay(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms =
    typeof value === "number"
      ? value
      : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value);
  return Number.isFinite(ms) ? formatTrustDay(ms) : null;
}

/** The instant the lane's own figure was read or logged, from the lane's own fields. */
function laneObservedAt(
  lane: VenuePriceLane,
  signal: VenueSignal | undefined,
  venue: Venue,
): string | number | null {
  switch (lane.lane) {
    case "contributor":
      return signal?.latestContributorAt ?? null;
    case "sourced":
      return lane.sourcedPrice.observedAt ?? null;
    case "listed":
      return lane.listed.observedAt;
    case "provisional":
    case "aged":
    case "disputed":
      return lane.observedAt;
    case "anchor":
      return venue.anchorObservedAt ?? null;
    // The baseline caption already carries its own collected day when it can
    // claim one, and an estimate is a model, not a reading.
    case "baseline":
    case "estimate":
      return null;
  }
}

/**
 * One curated venue's price, as the venue sheet would print it.
 *
 * The lane, the figure, the caption and the aging are the peek's own
 * (`renderVenuePeekSummary` in components/PubMap.tsx): the same drop signal,
 * the same bundle and sourced inputs, the same chip. Two things are added and
 * neither decides anything. The day the lane's own figure was read rides
 * beside the caption. And a baseline figure on a slim map pin, whose price rows
 * the map has not loaded, is worded by the dataset reading the pub list
 * already prints for exactly that evidence (`nearPriceTrustLabel`: the
 * publisher the slim index names and the day it read the row), because the
 * sheet's own caption would say "publisher not recorded" about a publisher the
 * index does record.
 */
export function mapSplitListPrice(
  venue: Venue,
  signal: VenueSignal | undefined,
  lens: {
    prices: ReadonlyMap<string, MapLensPrice> | null;
    noun: string | null;
    status: CategoryPriceIndexStatus;
  } = { prices: null, noun: null, status: "ready" },
): MapSplitListPrice {
  if (lens.prices !== null) {
    const lensPrice = lens.prices.get(venue.id) ?? null;
    if (!lensPrice) {
      return {
        ...NO_PRICE,
        caption: drinkLensUnknownRowLabel(
          lens.noun?.toLowerCase() ?? "this view",
          lens.status,
        ),
      };
    }
    return {
      figure: formatPrice(lensPrice.priceGbp),
      // A pint lens wears its band; any other drink's figure is not a pint.
      bandGbp: lensPrice.category === "beer" ? lensPrice.priceGbp : null,
      observed: true,
      caption: lensPrice.categoryLabel,
      day: mapSplitListDay(lensPrice.observedAt ?? lensPrice.submittedAt ?? null),
      aging: false,
      trust: null,
      rankGbp: lensPrice.priceGbp,
    };
  }

  const bundle = venueBundlePrices(venue);
  const dropLanes = dropLaneInputsFor(signal);
  const lane = venuePriceLane(
    venue,
    signal?.latestContributorPrice,
    venueSourcedPrice(venue),
    bundle,
    dropLanes.provisional,
    dropLanes.aged,
    dropLanes.disputed,
  );
  const chip = peekPriceChip(lane, bundle, signal?.pintTrust ?? null);
  if (!lane || !chip) return NO_PRICE;

  const slimBaseline =
    lane.lane === "baseline" && lane.publisher === null && venue.prices.length === 0;
  return {
    figure: chip.figure,
    bandGbp: chip.priceGbp,
    observed: chip.observed,
    caption: slimBaseline
      ? nearPriceTrustLabel(
          venue.priceSource ? "named" : "unrecorded",
          venue.priceSource ?? null,
          venue.priceObservedAt ?? null,
        )
      : chip.caption,
    day: slimBaseline ? null : mapSplitListDay(laneObservedAt(lane, signal, venue)),
    // A slim pin's read day is the one its own pin ages on (pinPriceAging).
    aging: slimBaseline
      ? priceAgeFor("published", venue.priceObservedAt ?? null) === "aging"
      : peekPriceAging(lane),
    trust: chip.trust,
    rankGbp: RANKED_LANES.has(lane.lane) ? chip.priceGbp : null,
  };
}

/** The Filters panel's own feature words, read by the map's own filter rules. */
const FEATURE_FACTS: ReadonlyArray<readonly [keyof Filters, string]> = [
  ["requireBeerGarden", "Beer garden"],
  ["requireOutdoorSeating", "Outdoor seating"],
  ["requireDogFriendly", "Dogs welcome"],
  ["requireLiveSports", "Live sport"],
];

/**
 * One or two facts a row can stand behind: what the place is when it is not a
 * pub, where it is, and the first recorded feature the map's own filters would
 * match it on. Never a score and never a guess: a feature is listed only when
 * the Filters panel would keep this venue for it.
 */
export function mapSplitListFacts(venue: Venue): string[] {
  const facts: string[] = [];
  if (!isPubVenueKind(venue.kind)) facts.push(venueKindLabel(venue.kind));
  const area = venue.locality?.trim() || venue.primaryBorough?.trim();
  if (area) facts.push(area);
  if (facts.length < 2) {
    for (const [key, label] of FEATURE_FACTS) {
      const filters = { ...initialFilters, maxPrice: Number.POSITIVE_INFINITY, [key]: true };
      if (filterVenues([venue], filters).length === 1) {
        facts.push(label);
        break;
      }
    }
  }
  return facts.slice(0, 2);
}

function distanceFrom(origin: Point | null, lng: number, lat: number): number | null {
  if (!origin || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return haversineKm([origin.lng, origin.lat], [lng, lat]);
}

function walkFrom(reader: Point | null, lng: number, lat: number): number | null {
  const km = distanceFrom(reader, lng, lat);
  if (km === null) return null;
  const minutes = walkMinutesFromKm(km);
  return minutes <= MAP_PEEK_MAX_WALK_MINUTES ? minutes : null;
}

function validPoint(point: Point | null | undefined): Point | null {
  return point && Number.isFinite(point.lng) && Number.isFinite(point.lat) ? point : null;
}

function byDistance(left: MapSplitListRow, right: MapSplitListRow): number {
  return (
    (left.distanceKm ?? Number.POSITIVE_INFINITY) -
      (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The column's order. "cheapest" ranks every row whose figure the map paints,
 * lowest first, then lists the rest nearest first; "nearest" is distance
 * alone. The distance is from the reader when the map knows where they are,
 * else from the middle of the map, the way List view measures it.
 */
export function sortMapSplitListRows(
  rows: readonly MapSplitListRow[],
  sort: MapSplitListSort,
): MapSplitListRow[] {
  if (sort === "nearest") return [...rows].sort(byDistance);
  return [...rows].sort((left, right) => {
    const leftRank = left.price?.rankGbp ?? null;
    const rightRank = right.price?.rankGbp ?? null;
    if (leftRank !== null && rightRank !== null) {
      return (
        leftRank - rightRank ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
      );
    }
    if (leftRank !== null) return -1;
    if (rightRank !== null) return 1;
    return byDistance(left, right);
  });
}

export type MapSplitListInput = {
  /** The curated venues to list, already inside the view and through every map filter. */
  venues: readonly Venue[];
  /** The unpriced OSM pubs in view, as List view holds them. */
  basePubs: UkBasePubListModel["rows"];
  /** The London restaurants in view, as List view holds them. */
  restaurants: LondonRestaurantListModel["rows"];
  /** The UNMERGED Pint Drop signal the venue sheet reads (components/PubMap.tsx). */
  dropSignals: ReadonlyMap<string, VenueSignal>;
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  lensNoun?: string | null;
  lensStatus?: CategoryPriceIndexStatus;
  /** The middle of the map, [lng, lat]. */
  viewportCenter: [number, number] | null;
  /** Where the reader is, when they have shared it. */
  reader: Point | null;
  sort: MapSplitListSort;
};

export type MapSplitListGroups = {
  venues: MapSplitListRow[];
  basePubs: MapSplitListRow[];
  restaurants: MapSplitListRow[];
  total: number;
};

/**
 * Every row the column can list, in the column's order, in three groups: the
 * curated venues the sheet prices, then the pubs and restaurants the map draws
 * with no listed price. Pure and deterministic, and safe on empty input.
 */
export function buildMapSplitListGroups(input: MapSplitListInput): MapSplitListGroups {
  const reader = validPoint(input.reader);
  const center = input.viewportCenter
    ? validPoint({ lng: input.viewportCenter[0], lat: input.viewportCenter[1] })
    : null;
  const origin = reader ?? center;
  const lens = {
    prices: input.lensPrices ?? null,
    noun: input.lensNoun ?? null,
    status: input.lensStatus ?? "ready",
  };
  const venueRows = input.venues.map<MapSplitListRow>((venue) => ({
    id: venue.id,
    name: venue.name,
    lng: venue.longitude,
    lat: venue.latitude,
    group: "venue",
    distanceKm: distanceFrom(origin, venue.longitude, venue.latitude),
    walkMinutes: walkFrom(reader, venue.longitude, venue.latitude),
    price: mapSplitListPrice(venue, input.dropSignals.get(venue.id), lens),
    unpricedLabel: null,
    venue,
    basePub: null,
  }));
  const baseRows = input.basePubs.map<MapSplitListRow>((row) => ({
    id: row.id,
    name: row.name,
    lng: row.pub.lng,
    lat: row.pub.lat,
    group: "base",
    distanceKm: distanceFrom(origin, row.pub.lng, row.pub.lat),
    walkMinutes: walkFrom(reader, row.pub.lng, row.pub.lat),
    price: null,
    unpricedLabel: row.priceLabel,
    venue: null,
    basePub: row.pub,
  }));
  const restaurantRows = input.restaurants.map<MapSplitListRow>((row) => ({
    id: row.id,
    name: row.name,
    lng: row.lng ?? Number.NaN,
    lat: row.lat ?? Number.NaN,
    group: "restaurant",
    distanceKm: distanceFrom(origin, row.lng ?? Number.NaN, row.lat ?? Number.NaN),
    walkMinutes: walkFrom(reader, row.lng ?? Number.NaN, row.lat ?? Number.NaN),
    price: null,
    unpricedLabel: row.priceLabel,
    venue: null,
    basePub: null,
  }));
  return {
    venues: sortMapSplitListRows(venueRows, input.sort),
    // The unpriced groups have nothing to rank, so they are always nearest first.
    basePubs: [...baseRows].sort(byDistance),
    restaurants: [...restaurantRows].sort(byDistance),
    total: venueRows.length + baseRows.length + restaurantRows.length,
  };
}

/**
 * The rows drawn now: the groups in order, cut at `limit` rows in all, so
 * "Show more" reveals the next page without hiding a venue for good.
 */
export function pageMapSplitListGroups(
  groups: MapSplitListGroups,
  limit: number,
): MapSplitListGroups & { shown: number; more: number } {
  let budget = Math.max(0, Math.floor(limit));
  const take = (rows: MapSplitListRow[]) => {
    const page = rows.slice(0, budget);
    budget -= page.length;
    return page;
  };
  const venues = take(groups.venues);
  const basePubs = take(groups.basePubs);
  const restaurants = take(groups.restaurants);
  const shown = venues.length + basePubs.length + restaurants.length;
  return { venues, basePubs, restaurants, total: groups.total, shown, more: groups.total - shown };
}

/**
 * What the column lists, by id: the live view while it follows the map, and
 * the view it last searched while "Search as I move the map" is off. A held
 * view still goes through every live filter, so a reader who narrows the
 * filters sees the held list narrow with them.
 */
export function mapSplitListVenues(input: {
  followMap: boolean;
  visible: readonly Venue[];
  filtered: readonly Venue[];
  heldIds: ReadonlySet<string> | null;
}): readonly Venue[] {
  if (input.followMap || input.heldIds === null) return input.visible;
  const held = input.heldIds;
  return input.filtered.filter((venue) => held.has(venue.id));
}

/** One string for a membership, so the column can tell when the map shows something new. */
export function mapSplitListMembershipKey(ids: {
  venueIds: readonly string[];
  basePubIds: readonly string[];
  restaurantIds: readonly string[];
}): string {
  return [ids.venueIds, ids.basePubIds, ids.restaurantIds]
    .map((group) => [...group].sort().join("\u0000"))
    .join("\u0001");
}
