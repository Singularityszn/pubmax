// BROWSER-SAFE LEAF. Mates' prices (launch review F8): what the reader's
// mutual friends last paid at one pub, as dated facts.
//
// ADR 0017 holds the line this module keeps. Nothing here adds prices across
// people: no average, no "your lot pays", no figure that is not one person's
// one logged price on one day. Three dated facts at most, each naming who paid
// it, so a reader can weigh it like a word from a mate at the bar.

import {
  cleanDrinkMeasure,
  cleanDrinkMeasureLabel,
  measureNamedInDrinkText,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import { londonDayKey } from "@/lib/pintContributions";

/** The most facts the line ever shows. One per mate, newest first. */
export const MATES_PRICES_LIMIT = 3;

/** One mate's newest logged price at the pub, exactly as they logged it. */
export type MatesPrice = {
  handle: string;
  priceGbp: number;
  drink: string;
  measure: DrinkMeasure;
  measureLabel?: string;
  /** When the drop was logged (ISO). The day it reads is the London day. */
  loggedAt: string;
};

export type MatesPricesAnswer = { prices: MatesPrice[] };

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * The London day a price was logged, said the way a mate says it: "today",
 * "yesterday", "on Friday" inside the week, then "on 12 Oct", and the year
 * once it is not this one. Empty when the date does not parse, so a caller
 * leaves the fact out rather than printing a wrong day.
 */
export function matesPriceDay(loggedAt: string, now: Date = new Date()): string {
  const logged = new Date(loggedAt);
  if (Number.isNaN(logged.getTime())) return "";
  const loggedKey = londonDayKey(logged);
  const todayKey = londonDayKey(now);
  const days = daysBetween(loggedKey, todayKey);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1 && days < 7) return `on ${WEEKDAY.format(logged)}`;
  if (loggedKey.slice(0, 4) === todayKey.slice(0, 4)) return `on ${DAY_MONTH.format(logged)}`;
  return `on ${DAY_MONTH_YEAR.format(logged)}`;
}

/**
 * What the price bought, in the words the mate logged it with. A drink that
 * already names its measure ("Half of lager") reads as written; a half or a
 * named measure is said beside the drink, and a pint is the default nobody
 * says out loud.
 */
export function matesPriceDrink(price: Pick<MatesPrice, "drink" | "measure" | "measureLabel">): string {
  const drink = price.drink.replace(/\s+/g, " ").trim();
  const measure = cleanDrinkMeasure(price.measure);
  const label = cleanDrinkMeasureLabel(price.measureLabel).toLowerCase();
  if (drink && measureNamedInDrinkText(drink)) return drink;
  if (measure === "half") return drink ? `a half of ${drink}` : "a half";
  if (measure === "other") {
    if (drink) return label ? `${drink} (${label})` : drink;
    return label ? `a ${label}` : "a drink";
  }
  return drink || "a pint";
}
