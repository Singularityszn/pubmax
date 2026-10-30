// The round at one stop, from the prices the pub's own record lists.
//
// Review item B6. For each crew member who picked a usual drink
// (lib/planUsualDrink.ts), the figure this pub lists for that drink, with the
// day it was read, or nothing. The total adds the listed figures and says how
// many of the round's drinks it covers, because a total over three of four
// drinks is not the price of four.
//
// FOUR RULES.
// 1. LISTED ONLY. The beer figure is the pub's pint price lane, taken only
//    where that lane is a listed or sourced price with a read day
//    (lib/venuePriceLane.ts decides the lane; this module only accepts or
//    declines it). A modelled estimate, a drinker report waiting for a second
//    drinker, a disputed split and an aged report are not listed prices, so
//    they print "not listed" here.
// 2. THE SERVING IS STATED, NEVER INFERRED. A wine figure is a menu row whose
//    own serving field says 175 ml (`measureFromServingSize`). A row with no
//    stated size, or another size, is not a 175 ml glass and is never scaled
//    into one. The drink's name is never read for a size.
// 3. THE CHEAPEST LISTED ROW of the matching kind, so "the round" means the
//    same thing at every stop, and the row's own name prints beside an
//    alcohol-free or soft figure because those two choices name a kind, not a
//    product.
// 4. A FORECAST, NOTHING MORE. No payment, settlement or per-person split is
//    derived from it.

import { measureFromServingSize } from "@/lib/drinkMeasure";
import type { DrinkCategory } from "@/lib/drinks";
import { visibleDrinkPriceUpdates, type DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import { LISTED_MAX_AGE_DAYS } from "@/lib/priceTier";
import {
  PLAN_USUAL_DRINK_MEASURE,
  type PlanUsualDrink,
} from "@/lib/planUsualDrink";
import { venueBundlePrices, venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import { venuePriceUpdatesOf } from "@/lib/venuePriceUpdates";
import type { Venue } from "@/lib/venues";

/** One listed figure, with what it is and the day it was read. */
export type RoundListedPrice = {
  priceGbp: number;
  /** ISO instant or day the source was read. */
  observedAt: string;
  /** The listed row's own drink name, printed for a kind-only choice. Null for beer and wine. */
  drinkName: string | null;
};

export type RoundLine = {
  memberId: string;
  memberName: string;
  drink: PlanUsualDrink;
  price: RoundListedPrice | null;
};

export type StopRound = {
  lines: RoundLine[];
  /** Sum of the listed figures, in pence, so no float drift creeps into the total. */
  listedTotalPence: number;
  listedCount: number;
  drinkCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function withinListedWindow(observedAt: string, now: number): boolean {
  const at = Date.parse(observedAt);
  return Number.isFinite(at) && at <= now + DAY_MS && now - at <= LISTED_MAX_AGE_DAYS * DAY_MS;
}

function positiveFigure(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The pub's listed pint, from the one price precedence, or null. */
function listedPintFor(venue: Venue, now: number = Date.now()): RoundListedPrice | null {
  const lane = venuePriceLane(venue, null, venueSourcedPrice(venue), venueBundlePrices(venue), null, null, null, now);
  if (!lane) return null;
  if (lane.lane === "sourced") {
    const observedAt = lane.sourcedPrice.observedAt;
    return positiveFigure(lane.cheapestPrice) && withinListedWindow(observedAt, now)
      ? { priceGbp: lane.cheapestPrice, observedAt, drinkName: null }
      : null;
  }
  if (lane.lane === "listed") {
    return positiveFigure(lane.listed.priceGbp) && withinListedWindow(lane.listed.observedAt, now)
      ? { priceGbp: lane.listed.priceGbp, observedAt: lane.listed.observedAt, drinkName: null }
      : null;
  }
  if (lane.lane === "baseline" && lane.standing === "listed" && lane.publisher && lane.observedOn) {
    return positiveFigure(lane.cheapestPrice)
      ? { priceGbp: lane.cheapestPrice, observedAt: lane.observedOn, drinkName: null }
      : null;
  }
  return null;
}

const MENU_CATEGORY: Record<Exclude<PlanUsualDrink, "beer">, DrinkCategory> = {
  wine: "wine",
  alcohol_free: "alcohol-free",
  soft: "soft-drink",
};

/** The cheapest listed menu row for a non-beer choice, or null. */
export function listedMenuDrinkFor(
  rows: readonly DrinkPriceUpdate[],
  drink: Exclude<PlanUsualDrink, "beer">,
  now: number = Date.now(),
): RoundListedPrice | null {
  const category = MENU_CATEGORY[drink];
  const measure = PLAN_USUAL_DRINK_MEASURE[drink];
  let best: DrinkPriceUpdate | null = null;
  for (const row of visibleDrinkPriceUpdates(rows)) {
    if (row.category !== category || !positiveFigure(row.priceGbp)) continue;
    if (!withinListedWindow(row.observedAt, now)) continue;
    // The serving must be STATED as the measure the choice names. Wine reads
    // 175 ml rows only; a row with no stated size is size not stated.
    if (measure !== null && measureFromServingSize(row.servingSize) !== measure) continue;
    if (!best || row.priceGbp < best.priceGbp) best = row;
  }
  if (!best) return null;
  return {
    priceGbp: best.priceGbp,
    observedAt: best.observedAt,
    drinkName: measure === null ? best.drinkName.trim() || null : null,
  };
}

/** The listed figure for one choice at one pub, or null. */
function listedPriceForUsualDrink(
  venue: Venue,
  drink: PlanUsualDrink,
  now: number = Date.now(),
): RoundListedPrice | null {
  if (drink === "beer") return listedPintFor(venue, now);
  return listedMenuDrinkFor(venuePriceUpdatesOf(venue).drink, drink, now);
}

/**
 * The round at one stop. `venue` is null while its detail has not answered, or
 * when it could not be read, and then every line is "not listed": we say what
 * we can show, never a figure we did not read.
 */
export function stopRound(
  venue: Venue | null,
  members: readonly { id: string; name: string; usualDrink?: PlanUsualDrink | null }[],
  now: number = Date.now(),
): StopRound {
  const lines: RoundLine[] = [];
  for (const member of members) {
    if (!member.usualDrink) continue;
    lines.push({
      memberId: member.id,
      memberName: member.name,
      drink: member.usualDrink,
      price: venue ? listedPriceForUsualDrink(venue, member.usualDrink, now) : null,
    });
  }
  let listedTotalPence = 0;
  let listedCount = 0;
  for (const line of lines) {
    if (!line.price) continue;
    listedTotalPence += Math.round(line.price.priceGbp * 100);
    listedCount += 1;
  }
  return { lines, listedTotalPence, listedCount, drinkCount: lines.length };
}

/** "£23.40 for 3 of 4 drinks listed", or null when nothing is listed. */
export function stopRoundTotalLine(round: StopRound): string | null {
  if (round.drinkCount === 0 || round.listedCount === 0) return null;
  const total = `£${(round.listedTotalPence / 100).toFixed(2)}`;
  const noun = round.drinkCount === 1 ? "drink" : "drinks";
  return `${total} for ${round.listedCount} of ${round.drinkCount} ${noun} listed`;
}
