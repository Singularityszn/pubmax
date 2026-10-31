// BROWSER-SAFE LEAF. A crew member's usual drink on a Plan, and nothing else.
//
// Review item B6 (launch review, 30 Oct 2026): "What will a round cost us at
// each stop?" Each member picks a usual drink once, from four closed choices,
// and the plan card prints the round at each stop from LISTED prices
// (lib/planRoundForecast.ts). It is a forecast of listed prices: no payment, no
// settlement and no per-person split ride on it, and nothing in the product
// branches on the choice beyond printing that forecast.
//
// The set is closed for the same reason a measure is (lib/drinkMeasure.ts):
// each choice names the SERVING its price must be about. Beer is a pint and
// wine is a 175 ml glass, so a forecast never reads a half as a pint or a
// bottle as a glass, and nothing is ever scaled between them. Migration 0211
// mirrors this list in its CHECK, and `__tests__/planUsualDrink.test.ts` holds
// the two together.
//
// This module imports only the measure leaf, so the plan card and the route
// can share it without pulling the venue index in behind it.

import type { DrinkMeasure } from "@/lib/drinkMeasure";

export const PLAN_USUAL_DRINKS = ["beer", "wine", "alcohol_free", "soft"] as const;
export type PlanUsualDrink = (typeof PLAN_USUAL_DRINKS)[number];

/** The word each choice prints, on the picker and beside a figure alike. */
export const PLAN_USUAL_DRINK_LABEL: Record<PlanUsualDrink, string> = {
  beer: "Beer (pint)",
  wine: "Wine (175 ml)",
  alcohol_free: "Alcohol-free",
  soft: "Soft drink",
};

/**
 * The measure a choice's price must state, or null when the choice names a
 * kind of drink rather than a serving. A beer forecast reads pint rows only and
 * a wine forecast reads 175 ml rows only.
 */
export const PLAN_USUAL_DRINK_MEASURE: Record<PlanUsualDrink, DrinkMeasure | null> = {
  beer: "pint",
  wine: "175ml",
  alcohol_free: null,
  soft: null,
};

const USUAL_DRINK_SET: ReadonlySet<string> = new Set(PLAN_USUAL_DRINKS);

/** The choice a value names, or null. Never a default: no pick is no pick. */
export function cleanPlanUsualDrink(value: unknown): PlanUsualDrink | null {
  return typeof value === "string" && USUAL_DRINK_SET.has(value) ? (value as PlanUsualDrink) : null;
}

/** The heading over the round on the plan card. */
export const PLAN_ROUND_HEADING = "What’s our round here?";

/** The line that says what the round's figures are. */
export const PLAN_ROUND_BASIS_LINE =
  "A forecast from listed prices, with the day each was read. Not a bill.";

/** What the picker asks, once per member. */
export const PLAN_USUAL_DRINK_ASK = "Your usual";

/** What a drink with no listed figure at a stop prints. */
export const PLAN_ROUND_NOT_LISTED = "not listed";
