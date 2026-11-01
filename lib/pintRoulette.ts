// PINT ROULETTE: "Just pick one." (launch review D2, launch plan section 3).
//
// One tap on /near picks ONE pub at random from the pubs within a 15 minute
// walk that carry a listed pint, under the reader's fair pint when they set
// one. "Spin again" picks again. The card says it is random, so nobody reads
// the pick as a recommendation or a rank.
//
// FOUR RULES, and every one of them is a test in __tests__/pintRoulette.test.ts.
//
// 1. ONLY A LISTED PINT. A pub joins the wheel only when its cheapest figure
//    carries the publisher of that exact row and the day it was read
//    (`priceSource` and `priceObservedAt` on the slim index, the same evidence
//    the share card and the /near rows print). A figure with no source or no
//    day never spins, because the card prints both beside the price.
// 2. THE WALK IS A LIMIT, NOT A PREFERENCE. Nothing past 15 minutes at the
//    shared pace (lib/walkMinutes.ts) is on the wheel, and nothing over the
//    reader's cap is either. There is no weighting: every pub on the wheel has
//    the same chance, so "random" means random.
// 3. THE RANDOM SOURCE IS HANDED IN. `seededRouletteRandom` makes a spin
//    repeatable for a test; the surface hands in Math.random. The pool is put
//    in id order first, so the same seed lands on the same pub whatever order
//    the index arrived in.
// 4. THE DRY LINE IS ONLY WHAT IS STORED. A listed-building grade from the
//    Historic England match (public/data/heritage_listings.json), a dated line
//    from the cited historic index (public/data/historic_pubs.json, only when
//    the date is evidence of age), and a beer garden the venue record holds.
//    Nothing else, nothing inferred, and no line at all when none is stored.
//
// No alcohol-quantity reward: a spin is one pub, never a count of drinks.
//
// Pure and browser-safe: no React, no fetch, no storage.

import { haversineKm } from "@/lib/haversine";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

/** The walk the wheel spins inside, in whole minutes. */
export const PINT_ROULETTE_WALK_MINUTES = 15;

/** A source of numbers in [0, 1), like Math.random. */
export type RouletteRandom = () => number;

/**
 * A repeatable random source (mulberry32). The same seed answers the same
 * sequence on every machine, which is what a test of "random" needs.
 */
export function seededRouletteRandom(seed: number): RouletteRandom {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The slim-index fields the wheel reads. SlimVenue satisfies it directly. */
export type PintRoulettePoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  borough: string;
  cheapestPrice: number | null;
  /** Publisher of the exact row the cheapest figure came from. */
  priceSource?: string;
  /** `YYYY-MM-DD` that row was last read. */
  priceObservedAt?: string;
  kind?: VenueKind;
  filterHints?: { amenities?: { beerGarden?: boolean } };
};

/**
 * One pub's stored facts, as the server hands them over: the venue id, its
 * Historic England grade (or null) and its dated label from the cited historic
 * index (or null).
 */
export type PintRouletteFact = readonly [venueId: string, grade: string | null, dateLabel: string | null];

/** The grades a statutory listing can carry. Anything else is not a grade. */
const LISTED_GRADES: ReadonlySet<string> = new Set(["I", "II*", "II"]);

/**
 * The dated labels the historic index writes when the date is evidence of the
 * pub's age (lib/heritageDate.mjs): "Built 1846", "Founded 18th century". A
 * "Linked to 1701" names something else's year and never reaches this line.
 */
const DATE_LABEL = /^(Built|Founded) \S/;
const DATE_LABEL_MAX = 48;

export type PintRouletteOptions = {
  random: RouletteRandom;
  /** The reader's fair pint in pounds, or null for no cap. */
  priceCapGbp?: number | null;
  maxWalkMinutes?: number;
  /** The pub already on the card. Spin again lands elsewhere when it can. */
  excludeId?: string | null;
};

export type PintRouletteCandidate = {
  point: PintRoulettePoint;
  priceGbp: number;
  publisher: string;
  observedAt: string;
  walkMinutes: number;
};

export type PintRoulettePick = {
  id: string;
  name: string;
  borough: string;
  priceGbp: number;
  /** Publisher of the exact row the price came from. */
  publisher: string;
  /** The day that row was read, `YYYY-MM-DD`. */
  observedAt: string;
  walkMinutes: number;
  /** The one dry line, or null when nothing is stored for this pub. */
  factLine: string | null;
  /** How many pubs were on the wheel for this spin. */
  poolSize: number;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function listedPrice(point: PintRoulettePoint): number | null {
  const price = point.cheapestPrice;
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Every pub the wheel may land on from (lat, lng): a public pub with a listed
 * pint, its publisher and its read day, inside the walk and under the cap, in
 * id order.
 */
export function pintRoulettePool(
  lat: number,
  lng: number,
  venues: readonly PintRoulettePoint[],
  options: Pick<PintRouletteOptions, "priceCapGbp" | "maxWalkMinutes"> = {},
): PintRouletteCandidate[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const maxWalk = options.maxWalkMinutes ?? PINT_ROULETTE_WALK_MINUTES;
  const cap = typeof options.priceCapGbp === "number" && Number.isFinite(options.priceCapGbp)
    ? options.priceCapGbp
    : null;
  const seen = new Set<string>();
  const pool: PintRouletteCandidate[] = [];
  for (const point of venues) {
    if (!point || typeof point.id !== "string" || seen.has(point.id)) continue;
    if (!isPublicRankablePub(point)) continue;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const priceGbp = listedPrice(point);
    const publisher = cleanText(point.priceSource);
    const observedAt = cleanText(point.priceObservedAt);
    if (priceGbp === null || !publisher || !Number.isFinite(Date.parse(observedAt))) continue;
    if (cap !== null && priceGbp > cap) continue;
    const walkMinutes = walkMinutesFromKm(haversineKm([lng, lat], [point.lng, point.lat]));
    if (walkMinutes > maxWalk) continue;
    seen.add(point.id);
    pool.push({ point, priceGbp, publisher, observedAt, walkMinutes });
  }
  return pool.sort((left, right) => (left.point.id < right.point.id ? -1 : left.point.id > right.point.id ? 1 : 0));
}

/**
 * The one dry line, from stored facts only: "Grade II listed, built 18th
 * century, beer garden." Null when nothing is stored.
 */
export function pintRouletteFactLine(
  fact: PintRouletteFact | undefined,
  beerGarden: boolean,
): string | null {
  const parts: string[] = [];
  const grade = cleanText(fact?.[1]);
  if (LISTED_GRADES.has(grade)) parts.push(`Grade ${grade} listed`);
  const dateLabel = cleanText(fact?.[2]);
  if (dateLabel && dateLabel.length <= DATE_LABEL_MAX && DATE_LABEL.test(dateLabel)) {
    parts.push(parts.length > 0 ? dateLabel.charAt(0).toLowerCase() + dateLabel.slice(1) : dateLabel);
  }
  if (beerGarden) parts.push(parts.length > 0 ? "beer garden" : "Beer garden");
  return parts.length > 0 ? `${parts.join(", ")}.` : null;
}

function pickIndex(random: RouletteRandom, length: number): number {
  const draw = random();
  const unit = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 1 - Number.EPSILON) : 0;
  return Math.min(length - 1, Math.floor(unit * length));
}

/**
 * Spin once. Null when the wheel is empty, so the surface says so rather than
 * widening the walk or dropping the cap behind the reader's back.
 */
export function spinPintRoulette(
  lat: number,
  lng: number,
  venues: readonly PintRoulettePoint[],
  facts: readonly PintRouletteFact[],
  options: PintRouletteOptions,
): PintRoulettePick | null {
  const pool = pintRoulettePool(lat, lng, venues, options);
  if (pool.length === 0) return null;
  const wheel = options.excludeId && pool.length > 1
    ? pool.filter((candidate) => candidate.point.id !== options.excludeId)
    : pool;
  const chosen = wheel[pickIndex(options.random, wheel.length)]!;
  const fact = facts.find((entry) => entry[0] === chosen.point.id);
  return {
    id: chosen.point.id,
    name: chosen.point.name,
    borough: chosen.point.borough,
    priceGbp: chosen.priceGbp,
    publisher: chosen.publisher,
    observedAt: chosen.observedAt,
    walkMinutes: chosen.walkMinutes,
    factLine: pintRouletteFactLine(fact, chosen.point.filterHints?.amenities?.beerGarden === true),
    poolSize: pool.length,
  };
}
