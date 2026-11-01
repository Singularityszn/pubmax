// CHEAPEST ANYTHING on /near (launch plan section 3, launch review B3).
//
// A chip row under the pint answer: Pint, Guinness, House wine, Coke, Coffee,
// Alcohol-free. Each chip answers one question, "the cheapest one near you",
// within the same 15 minute walk the Guinness line already used, from the same
// centre the pint answer ranked from.
//
// FOUR RULES, each a test in __tests__/nearCheapestAnything.test.ts.
//
// 1. LISTED ROWS ONLY. Every row the server hands over is a figure a named
//    publisher printed (a pub's own menu, a chain's page, the reviewed drink
//    publish, the pint dataset), with the day it was read. An estimate is never
//    a row here, so an estimate can never be called the cheapest.
// 2. A MEASURE IS STATED OR IT IS "SIZE NOT STATED". The measure comes from the
//    source's own serving field (lib/drinkMeasure.ts#measureFromServingSize),
//    never from the drink's name. Each measure is its own answer: a 175 ml
//    glass is never compared with a 250 ml one, and a row with no stated size
//    is never compared with a measured one. Nothing is scaled.
// 3. THE ROW SAYS WHAT IT IS. A wine, coffee, cola or alcohol-free answer
//    prints the drink's own name from the source, so "House wine" can never
//    hide a prosecco and "Coke" can never hide a Pepsi.
// 4. AN EMPTY ANSWER SAYS SO. No priced row in the walk is a sentence, never a
//    zero, a dash or a figure from further away.
//
// Pure and browser-safe. The server half that builds the rows is
// lib/nearCheapestAnything.server.ts.

import { DRINK_MEASURES, DRINK_MEASURE_LABEL, type DrinkMeasure } from "@/lib/drinkMeasure";
import { haversineKm } from "@/lib/haversine";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

/** The walk every chip answers inside, in whole minutes. */
const NEAR_DRINK_WALK_MINUTES = 15;

export const NEAR_DRINK_CHIPS = [
  { id: "pint", label: "Pint", answerNoun: "pint" },
  { id: "guinness", label: "Guinness", answerNoun: "Guinness" },
  { id: "wine", label: "House wine", answerNoun: "red, white or rosé wine" },
  { id: "coke", label: "Coke", answerNoun: "Diet Coke or Coke Zero" },
  { id: "coffee", label: "Coffee", answerNoun: "coffee" },
  { id: "alcohol-free", label: "Alcohol-free", answerNoun: "alcohol-free drink" },
] as const;

export type NearDrinkChipId = (typeof NEAR_DRINK_CHIPS)[number]["id"];
/** The lanes the server builds. The pint lane is read off the slim index. */
export type NearDrinkLaneId = Exclude<NearDrinkChipId, "pint">;

/**
 * One listed figure at one pub: [venue id, price in pounds, the day it was
 * read as `YYYY-MM-DD` or null, the publisher or null, the drink's own name or
 * null, the measure the source stated or null].
 */
export type NearDrinkRow = readonly [
  venueId: string,
  priceGbp: number,
  observedOn: string | null,
  publisher: string | null,
  drinkLabel: string | null,
  measure: DrinkMeasure | null,
];

export type NearDrinkLanes = Partial<Record<NearDrinkLaneId, readonly NearDrinkRow[]>>;

/** The slim-index fields a chip answer reads. SlimVenue satisfies it. */
export type NearDrinkPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  borough: string;
  cheapestPrice: number | null;
  priceSource?: string;
  priceObservedAt?: string;
  kind?: VenueKind;
};

export type NearDrinkAnswer = {
  id: string;
  name: string;
  priceGbp: number;
  observedOn: string | null;
  publisher: string | null;
  drinkLabel: string | null;
  measure: DrinkMeasure | null;
  walkMinutes: number;
};

/** What a row with no stated serving prints in place of a measure. */
export const NEAR_DRINK_SIZE_NOT_STATED = "Size not stated";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The `YYYY-MM-DD` day of an ISO instant or day, or null when it does not parse. */
export function nearDrinkReadDay(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const day = value.trim().slice(0, 10);
  return DAY.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ? day : null;
}

/**
 * The pint lane, read off the slim index: a pub's cheapest pint, only where the
 * index names the publisher of that exact row and the day it was read.
 */
export function nearPintRows(venues: readonly NearDrinkPoint[]): NearDrinkRow[] {
  const rows: NearDrinkRow[] = [];
  for (const venue of venues) {
    const price = venue.cheapestPrice;
    const publisher = typeof venue.priceSource === "string" ? venue.priceSource.trim() : "";
    const observedOn = nearDrinkReadDay(venue.priceObservedAt);
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    if (!publisher || !observedOn) continue;
    rows.push([venue.id, price, observedOn, publisher, null, "pint"]);
  }
  return rows;
}

/**
 * The Guinness lane, from the rows the page already hands the Guinness line
 * (lib/nearGuinness.server.ts, the /drink/guinness selector). A Guinness row
 * is a row of the pint dataset, so it is a pint.
 */
export function nearGuinnessRows(
  prices: readonly (readonly [string, number, string | null, (string | null)?])[] | undefined,
): NearDrinkRow[] | undefined {
  if (!prices) return undefined;
  return prices.map(([id, price, observedOn, publisher]) => [
    id,
    price,
    nearDrinkReadDay(observedOn),
    publisher?.trim() || null,
    null,
    "pint",
  ]);
}

function measureRank(measure: DrinkMeasure | null): number {
  return measure === null ? DRINK_MEASURES.length : DRINK_MEASURES.indexOf(measure);
}

function qualifies(point: NearDrinkPoint): boolean {
  return isPublicRankablePub(point) && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/**
 * The cheapest row of EACH measure within the walk of (lat, lng): measured
 * answers first, in the closed measure order, then the size-not-stated answer.
 * Two answers are never compared with each other. A tie on price goes to the
 * shorter walk, then to the venue id, so the answer never flips on row order.
 */
export function cheapestDrinksNearby(
  lat: number,
  lng: number,
  venues: readonly NearDrinkPoint[],
  rows: readonly NearDrinkRow[],
  maxWalkMinutes: number = NEAR_DRINK_WALK_MINUTES,
): NearDrinkAnswer[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || rows.length === 0) return [];
  const byVenue = new Map<string, NearDrinkRow[]>();
  for (const row of rows) {
    const [id, price] = row;
    if (typeof id !== "string" || typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    byVenue.set(id, [...(byVenue.get(id) ?? []), row]);
  }

  const best = new Map<DrinkMeasure | null, { answer: NearDrinkAnswer; km: number }>();
  for (const point of venues) {
    const venueRows = byVenue.get(point.id);
    if (!venueRows || !qualifies(point)) continue;
    const km = haversineKm([lng, lat], [point.lng, point.lat]);
    const walkMinutes = walkMinutesFromKm(km);
    if (walkMinutes > maxWalkMinutes) continue;
    for (const [, priceGbp, observedOn, publisher, drinkLabel, measure] of venueRows) {
      const key = measure ?? null;
      const held = best.get(key);
      const better = !held
        || priceGbp < held.answer.priceGbp
        || (priceGbp === held.answer.priceGbp && (km < held.km || (km === held.km && point.id < held.answer.id)));
      if (!better) continue;
      best.set(key, {
        km,
        answer: {
          id: point.id,
          name: point.name,
          priceGbp,
          observedOn: nearDrinkReadDay(observedOn),
          publisher: publisher?.trim() || null,
          drinkLabel: drinkLabel?.trim() || null,
          measure: key,
          walkMinutes,
        },
      });
    }
  }
  return [...best.entries()]
    .sort(([left], [right]) => measureRank(left) - measureRank(right))
    .map(([, entry]) => entry.answer);
}

/** The words an answer prints for its measure. */
export function nearDrinkMeasureLabel(measure: DrinkMeasure | null): string {
  return measure === null ? NEAR_DRINK_SIZE_NOT_STATED : DRINK_MEASURE_LABEL[measure];
}

/** The honest empty line for a chip with nothing priced in the walk. */
export function nearDrinkEmptyLine(chip: NearDrinkChipId): string {
  const entry = NEAR_DRINK_CHIPS.find((candidate) => candidate.id === chip) ?? NEAR_DRINK_CHIPS[0];
  return `No listed ${entry.answerNoun} within ${NEAR_DRINK_WALK_MINUTES} minutes' walk.`;
}

/** The heading a chip's answer carries. */
export function nearDrinkAnswerHeading(chip: NearDrinkChipId): string {
  const entry = NEAR_DRINK_CHIPS.find((candidate) => candidate.id === chip) ?? NEAR_DRINK_CHIPS[0];
  return `Cheapest ${entry.answerNoun} within ${NEAR_DRINK_WALK_MINUTES} minutes`;
}
