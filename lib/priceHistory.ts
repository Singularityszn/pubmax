// Price archaeology — what a pint at this pub USED to cost.
//
// Every row here is a dated, sourced historical price: a figure someone
// published on a citable page on a known day. It is the one price layer that
// cannot be re-scraped from a live source, so it is gathered by hand from
// archives and press and shipped as a hand-curated static file
// (public/data/price_history/london.json). There is no generator on purpose:
// public/data/price_history/README.md owns what earns a row.
//
// HARD RULE — historical prices are strictly second class.
//
//   A row in this file is history, not an observation of today. It must NEVER
//   reach anything that answers "what does a pint cost here now": price bands,
//   pin colour, the pin price label, cheapest-pint buckets, the Pint Index, the
//   freshness registry's current-price feeds, the community price merge, or the
//   drink/food price-update overlays.
//
//   Mechanically that means this module exports NOTHING shaped like a current
//   price and is imported by NOTHING on those paths. It has exactly one
//   consumer: the venue sheet's then-and-now line. __tests__/priceHistory.test.ts
//   pins both halves — the import fence and the data fence.
//
// The guards below mirror lib/priceUpdates.ts: hand-rolled, drop-the-bad-row,
// never throw. A historical price with no source URL or no date is not evidence,
// so it is dropped rather than shown.

import { DAY_MS } from "@/lib/dayMs";
import { statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { isHttpUrl } from "@/lib/httpUrl";
import { isFiniteNumber, isNonBlankString } from "@/lib/priceUpdateRowShape";

/** One dated historical price for a venue, as published by a citable source. */
export type PriceHistoryObservation = {
  venueId: string;
  /** Carried for legibility in the data file and in review; the UI reads the venue. */
  venueName: string;
  priceGbp: number;
  /** Calendar day the price was published/seen, `YYYY-MM-DD`. Never a timestamp: */
  /** archival evidence is dated to the day at best, and pretending otherwise lies. */
  observedOn: string;
  /** What was being bought, when the source says so ("a pint of Doom Bar"). */
  drink?: string;
  /** The words that carry the price, quoted so a reader can check the claim. */
  quote?: string;
  /**
   * What the figure is a price FOR, only where the source states all of it.
   * `drink` and `quote` are words for a reader and never stand in for this.
   */
  item?: PriceComparisonItem;
  source: {
    label: string;
    url: string;
    licence: string;
  };
};

/**
 * A calendar day, `YYYY-MM-DD`, that really exists and is not in the future.
 * A future historical price is a data error by definition.
 */
export function isValidObservedOn(value: unknown, now: number = Date.now()): value is string {
  if (!isNonBlankString(value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return false;
  // Round-trip the parse so "2013-02-31" is rejected rather than rolled forward.
  if (new Date(ms).toISOString().slice(0, 10) !== value) return false;
  return ms <= now;
}

/** Hand-rolled row guard. Drops a malformed row; never throws. */
export function isValidPriceHistoryObservation(
  value: unknown,
  now: number = Date.now(),
): value is PriceHistoryObservation {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonBlankString(row.venueId)) return false;
  if (!isNonBlankString(row.venueName)) return false;
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp <= 0) return false;
  if (!isValidObservedOn(row.observedOn, now)) return false;
  const source = row.source;
  if (typeof source !== "object" || source === null) return false;
  const src = source as Record<string, unknown>;
  if (!isNonBlankString(src.label)) return false;
  if (!isHttpUrl(src.url, { allowWhitespace: true })) return false;
  if (!isNonBlankString(src.licence)) return false;
  return true;
}

/** Parse a whole file, keeping only rows that carry a price, a day and a source. */
export function parsePriceHistory(raw: unknown, now: number = Date.now()): PriceHistoryObservation[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { observations?: unknown })?.observations)
      ? ((raw as { observations: unknown[] }).observations)
      : [];
  const out: PriceHistoryObservation[] = [];
  for (const row of rows) {
    if (!isValidPriceHistoryObservation(row, now)) continue;
    const r = row as PriceHistoryObservation;
    const item = priceComparisonItem(r.item);
    out.push({
      venueId: r.venueId,
      venueName: r.venueName,
      priceGbp: r.priceGbp,
      observedOn: r.observedOn,
      ...(isNonBlankString(r.drink) ? { drink: r.drink } : {}),
      ...(isNonBlankString(r.quote) ? { quote: r.quote } : {}),
      ...(item ? { item } : {}),
      source: { label: r.source.label, url: r.source.url, licence: r.source.licence },
    });
  }
  return out;
}

/** Bucket rows by venue, oldest first, so a venue read is one Map lookup. */
export function groupPriceHistoryByVenue(
  observations: PriceHistoryObservation[],
): Map<string, PriceHistoryObservation[]> {
  const byVenue = new Map<string, PriceHistoryObservation[]>();
  for (const row of observations) {
    const list = byVenue.get(row.venueId);
    if (list) list.push(row);
    else byVenue.set(row.venueId, [row]);
  }
  for (const list of byVenue.values()) {
    list.sort((a, b) => a.observedOn.localeCompare(b.observedOn) || a.priceGbp - b.priceGbp);
  }
  return byVenue;
}

/**
 * What a figure is a price FOR, as its source states it. A then-and-now
 * movement claims that ONE thing got dearer or cheaper, so it needs this on
 * both figures: the same drink, the same serving and an ordinary bar price.
 * Nothing here is read out of free text, because a guessed item is how two true
 * prices for two different pints became "Down £0.46 in 13 years."
 */
export type PriceComparisonItem = {
  /** The drink as the source names it ("Bud Light"). Matched exactly, ignoring case and spacing. */
  drink: string;
  /** The serving the source states. Never defaulted: an unstated measure is not a pint here. */
  measure: DrinkMeasure;
  /** An ordinary bar price. A happy hour, member, festival or promotional price is never `standard`. */
  terms: "standard";
};

/** A stated comparison item, or null when the value states less than all three parts. */
function priceComparisonItem(value: unknown): PriceComparisonItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const drink = item.drink;
  if (!isNonBlankString(drink)) return null;
  const measure = statedDrinkMeasure(item.measure);
  if (measure === null || item.terms !== "standard") return null;
  return { drink: drink.trim(), measure, terms: "standard" };
}

/** Names that say what KIND of drink, never which one. Two of them are not the same pint. */
const GENERIC_DRINK_NAMES: ReadonlySet<string> = new Set([
  "a pint",
  "ale",
  "beer",
  "bitter",
  "cider",
  "draught",
  "house lager",
  "lager",
  "pint",
  "stout",
]);

function drinkKey(drink: string): string | null {
  const key = drink.toLowerCase().replace(/\s+/g, " ").trim();
  return key === "" || GENERIC_DRINK_NAMES.has(key) ? null : key;
}

/**
 * THE ONE comparison policy every then-and-now line reads, on the venue sheet
 * and on the landing alike. True only when both sides state an item and the
 * items are the same drink by name, the same pint or half, and both ordinary
 * prices. Two unknowns are not a match, a generic name is not a drink, an
 * `other` serving carries a free label nobody can line up, and a near-miss name
 * is a different drink.
 */
export function sameComparisonItem(a: unknown, b: unknown): boolean {
  const left = priceComparisonItem(a);
  const right = priceComparisonItem(b);
  if (!left || !right) return false;
  if (left.measure === "other" || left.measure !== right.measure) return false;
  const key = drinkKey(left.drink);
  return key !== null && key === drinkKey(right.drink);
}

/**
 * The then-and-now arc for one venue: the deepest historical price we can
 * evidence, against the price on record today.
 *
 * `then` is the OLDEST row, because the furthest-back dated price is the one
 * worth printing. `nowGbp` is whatever the venue surface is already showing as
 * today's price; it is passed IN rather than derived here, so this module never
 * reads a current-price source and can never be mistaken for one.
 *
 * Returns null when the venue has no historical row at all. A venue with
 * history but no current price still gets an arc, with `nowGbp` null: the
 * historical fact stands on its own.
 *
 * A movement between the two is a separate claim, and `deltaGbp` carries it
 * only when `nowItem` and the then row state the same item
 * (`sameComparisonItem`). The default is no item, so a caller that states
 * nothing about today's pint gets both figures and no movement.
 */
export type VenuePriceArc = {
  then: PriceHistoryObservation;
  /** Every historical row for the venue, oldest first (`then` is the first). */
  history: PriceHistoryObservation[];
  nowGbp: number | null;
  /**
   * nowGbp - then.priceGbp, only when both figures are the same item. Positive
   * means it has gone up. Null says no movement may be printed.
   */
  deltaGbp: number | null;
  /** Whole years between the historical day and `asOf`, floored, minimum 0. */
  years: number;
};

export function venuePriceArc(
  history: PriceHistoryObservation[],
  nowGbp: number | null | undefined,
  asOf: number = Date.now(),
  nowItem: PriceComparisonItem | null = null,
): VenuePriceArc | null {
  const ordered = [...history].sort(
    (a, b) => a.observedOn.localeCompare(b.observedOn) || a.priceGbp - b.priceGbp,
  );
  const then = ordered[0];
  if (!then) return null;
  const thenMs = Date.parse(`${then.observedOn}T00:00:00.000Z`);
  const years = Number.isFinite(thenMs)
    ? Math.max(0, Math.floor((asOf - thenMs) / (365.2425 * DAY_MS)))
    : 0;
  const now = isFiniteNumber(nowGbp) ? nowGbp : null;
  const comparable = sameComparisonItem(then.item, nowItem);
  return {
    then,
    history: ordered,
    nowGbp: now,
    deltaGbp: now !== null && comparable ? Math.round((now - then.priceGbp) * 100) / 100 : null,
    years,
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "July 2013" — the granularity a historical claim deserves on screen. The exact
 * day stays in the data and in the link, so nothing is overstated either way.
 */
export function formatObservedMonth(observedOn: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(observedOn);
  if (!match) return observedOn;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : (match[1] ?? observedOn);
}

/** "14 July 2013" — the full day, for the source line and the accessible name. */
export function formatObservedDay(observedOn: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(observedOn);
  if (!match) return observedOn;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return observedOn;
  return `${Number(match[3])} ${month} ${match[1]}`;
}
