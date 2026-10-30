import { haversineKm } from "@/lib/haversine";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";
import { WALK_KMH } from "@/lib/routeLegs";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

// THE PINT COMPASS, AS ARITHMETIC. `/compass` points a needle at the cheapest
// listed pint inside a short walk. Everything it decides lives here, pure, so
// the page only reads sensors and paints: the bearing to a pub, the walk, the
// ranking, the words for a direction, the turn the needle makes and when the
// needle counts as lined up.
//
// THREE RULES ride with it.
//
// 1. A TARGET IS A PRICED PUB, AND ITS LABEL IS ITS OWN ROW'S. The bar is the
//    one /near uses (a public pub with a finite listed price), and the source
//    line is the /near card's own words (`nearPriceTrustLabel`), read off the
//    slim index's `priceSource` and `priceObservedAt`. No price is made here.
// 2. NOTHING LEAVES THE PHONE. These functions take a point and return a
//    point's answer. The page reads the slim index, which is the same public
//    file for every reader, so no request ever carries where somebody stands.
// 3. A THIN WALK WIDENS ONCE, AND SAYS SO. When no priced pub sits inside the
//    chosen walk, the answer is read again at `WIDEN_FACTOR` times the walk and
//    is marked `widened`. A second miss is an honest empty answer.

/** The walks a reader can choose, in minutes. */
export const COMPASS_WALK_MINUTES = [5, 10, 15] as const;
export type CompassWalkMinutes = (typeof COMPASS_WALK_MINUTES)[number];
export const DEFAULT_COMPASS_WALK_MINUTES: CompassWalkMinutes = 10;

/** One widening, to twice the walk. */
export const WIDEN_FACTOR = 2;

/** The most pubs the needle can step through. */
export const MAX_COMPASS_TARGETS = 8;

/**
 * Inside this many degrees either side, the reader is facing the pub. It is
 * wide on purpose: a phone compass wanders by ten degrees or more indoors, and
 * a needle that never settles never says yes.
 */
export const ALIGNED_ENTER_DEGREES = 12;
/** The needle leaves the aligned state only past this, so it does not flicker. */
export const ALIGNED_LEAVE_DEGREES = 20;

/** The minimal venue shape the compass needs. `SlimVenue` satisfies it. */
export type CompassVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  kind?: VenueKind;
  priceSource?: string;
  priceObservedAt?: string;
};

export type CompassPoint = { lat: number; lng: number };

export type CompassTarget = {
  id: string;
  name: string;
  borough: string;
  lat: number;
  lng: number;
  /** Always finite and positive: a target exists only for a priced pub. */
  price: number;
  /** The /near card's own source line for this row. */
  priceLabel: string;
  distanceKm: number;
  walkMinutes: number;
  /** Degrees clockwise from true north, from the origin to the pub. */
  bearing: number;
};

export type CompassAnswer = {
  targets: CompassTarget[];
  /** The walk the answer was read at, in minutes (twice the choice when widened). */
  minutes: number;
  widened: boolean;
};

/** The radius a walk of this many minutes covers, at the shared pace. */
export function walkRadiusKm(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return (minutes / 60) * WALK_KMH;
}

/** Any angle as degrees in [0, 360). */
export function normaliseDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const turned = degrees % 360;
  return turned < 0 ? turned + 360 : turned + 0;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * The initial great-circle bearing from one point to another, in degrees
 * clockwise from true north. At walking distance it is the straight line a
 * person would point along.
 */
export function bearingDegrees(from: CompassPoint, to: CompassPoint): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  if (y === 0 && x === 0) return 0;
  return normaliseDegrees(toDegrees(Math.atan2(y, x)));
}

/** Straight-line kilometres between two points. */
export function distanceKm(from: CompassPoint, to: CompassPoint): number {
  return haversineKm([from.lng, from.lat], [to.lng, to.lat]);
}

/**
 * The signed turn from where the phone faces to the pub, in (-180, 180].
 * Negative is to the left. This is the angle the needle is drawn at.
 */
export function relativeBearing(bearing: number, heading: number): number {
  const turn = normaliseDegrees(bearing - heading);
  return turn > 180 ? turn - 360 : turn;
}

/**
 * Whether the needle counts as lined up, with a gap between the way in and the
 * way out so a wobbling hand does not flick the state on and off.
 */
export function isAligned(relative: number, wasAligned: boolean): boolean {
  const off = Math.abs(relative);
  return wasAligned ? off <= ALIGNED_LEAVE_DEGREES : off <= ALIGNED_ENTER_DEGREES;
}

/**
 * The needle's next drawn rotation. It is cumulative rather than wrapped, so a
 * turn from 350 to 10 degrees is a 20 degree step clockwise, never a 340
 * degree spin back the long way round.
 */
export function nextNeedleRotation(previous: number, target: number): number {
  if (!Number.isFinite(previous)) return normaliseDegrees(target);
  const delta = relativeBearing(target, previous);
  return previous + delta;
}

const COMPASS_POINTS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

/** The eight-wind name for a bearing, for a phone with no compass. */
export function compassPointName(bearing: number): (typeof COMPASS_POINTS)[number] {
  const index = Math.round(normaliseDegrees(bearing) / 45) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? "north";
}

/** The text a reader without a compass sensor walks by: "north-east, 6 min". */
export function bearingText(target: Pick<CompassTarget, "bearing" | "walkMinutes">): string {
  return `${compassPointName(target.bearing)}, ${target.walkMinutes} min`;
}

/** The whole turn instruction for a phone that does know which way it faces. */
export function turnText(relative: number, aligned: boolean): string {
  if (aligned) return "You are facing it.";
  const off = Math.round(Math.abs(relative));
  if (off >= 150) return "It is behind you. Turn round.";
  return relative < 0 ? `Turn left ${off}°.` : `Turn right ${off}°.`;
}

/**
 * A phone's heading from one orientation event, in degrees clockwise from
 * north, or null when the event cannot say. iOS gives `webkitCompassHeading`
 * directly. Elsewhere `alpha` counts anticlockwise and means north only on an
 * ABSOLUTE event; a relative alpha is measured from wherever the phone was at
 * load, so it is refused rather than read as north. The screen's own rotation
 * is added back, because the reader looks along the top of the screen.
 */
export function headingFromOrientation(
  event: {
    alpha?: number | null;
    absolute?: boolean;
    webkitCompassHeading?: number | null;
  },
  screenAngle = 0,
): number | null {
  const angle = Number.isFinite(screenAngle) ? screenAngle : 0;
  const ios = event.webkitCompassHeading;
  if (typeof ios === "number" && Number.isFinite(ios) && ios >= 0) {
    return normaliseDegrees(ios + angle);
  }
  if (event.absolute === true && typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
    return normaliseDegrees(360 - event.alpha + angle);
  }
  return null;
}

function priceOf(venue: CompassVenue): number | null {
  const price = venue.cheapestPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

function qualifies(venue: CompassVenue): boolean {
  return (
    isPublicRankablePub(venue) &&
    priceOf(venue) !== null &&
    Number.isFinite(venue.lat) &&
    Number.isFinite(venue.lng)
  );
}

/** The /near card's source line for this pub's cheapest listed price. */
export function compassPriceLabel(venue: Pick<CompassVenue, "priceSource" | "priceObservedAt">): string {
  const source = venue.priceSource?.trim() || null;
  return source
    ? nearPriceTrustLabel("named", source, venue.priceObservedAt ?? null)
    : nearPriceTrustLabel("unrecorded", null, venue.priceObservedAt ?? null);
}

function targetsWithin(
  origin: CompassPoint,
  venues: readonly CompassVenue[],
  radiusKm: number,
  max: number,
): CompassTarget[] {
  const targets: CompassTarget[] = [];
  for (const venue of venues) {
    if (!qualifies(venue)) continue;
    const km = distanceKm(origin, venue);
    if (km > radiusKm) continue;
    targets.push({
      id: venue.id,
      name: venue.name,
      borough: venue.borough,
      lat: venue.lat,
      lng: venue.lng,
      price: priceOf(venue) as number,
      priceLabel: compassPriceLabel(venue),
      distanceKm: km,
      walkMinutes: walkMinutesFromKm(km),
      bearing: bearingDegrees(origin, venue),
    });
  }
  // Cheapest first; the nearer pub wins a tie, then the id keeps it stable.
  targets.sort(
    (a, b) => a.price - b.price || a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
  );
  return targets.slice(0, max);
}

/**
 * The compass's answer: the cheapest priced pubs inside the walk, cheapest
 * first. With none inside it, the walk is widened ONCE and the answer says so.
 */
export function rankCompassTargets(
  origin: CompassPoint,
  venues: readonly CompassVenue[],
  minutes: number = DEFAULT_COMPASS_WALK_MINUTES,
  max: number = MAX_COMPASS_TARGETS,
): CompassAnswer {
  const take = Math.max(1, Math.floor(max));
  const near = targetsWithin(origin, venues, walkRadiusKm(minutes), take);
  if (near.length > 0) return { targets: near, minutes, widened: false };
  const wider = minutes * WIDEN_FACTOR;
  return {
    targets: targetsWithin(origin, venues, walkRadiusKm(wider), take),
    minutes: wider,
    widened: true,
  };
}

/**
 * The same target measured again from where the reader stands now. The list is
 * ranked from one fix and kept while they walk, so the pub they chose does not
 * swap under them; only its bearing and its walk follow the newest fix.
 */
export function remeasureTarget(origin: CompassPoint, target: CompassTarget): CompassTarget {
  const km = distanceKm(origin, target);
  return {
    ...target,
    distanceKm: km,
    walkMinutes: walkMinutesFromKm(km),
    bearing: bearingDegrees(origin, target),
  };
}

/**
 * Whether the reader has moved far enough from the fix the list was ranked at
 * for the list itself to be read again.
 */
export const RERANK_AFTER_KM = 0.25;
export function shouldRerank(rankedAt: CompassPoint | null, now: CompassPoint): boolean {
  return rankedAt === null || distanceKm(rankedAt, now) > RERANK_AFTER_KM;
}

/**
 * One step of smoothing for a jittery heading, along the short way round. A
 * factor of 1 takes the new reading as it is; smaller follows it more slowly.
 */
export function smoothHeading(previous: number | null, next: number, factor = 0.35): number {
  if (previous === null || !Number.isFinite(previous)) return normaliseDegrees(next);
  const weight = Math.min(1, Math.max(0, factor));
  return normaliseDegrees(previous + relativeBearing(next, previous) * weight);
}

/** The next index when the reader steps through the targets, wrapping round. */
export function stepTarget(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  const from = Number.isInteger(index) ? index : 0;
  return (((from + direction) % count) + count) % count;
}
