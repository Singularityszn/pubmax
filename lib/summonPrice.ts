// THE DATED PRICE A SUMMON MAY CARRY. Browser-safe pure leaf: the dialog runs
// it over the public venue detail for a share, and the server runs it over a
// fresh detail read for a direct message, so both print the same rule.
//
// One row speaks for the price: the first live row carrying the pub's listed
// figure. Every fact the line prints comes from that row, or there is no line.
// No other row lends it a source, a date or a measure.

import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import { measureNamedInDrinkText } from "@/lib/drinkMeasureText.mjs";
import { formatGbp } from "@/lib/formatGbp";
import { legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import { isLivePriceRow } from "@/lib/priceRowEligibility.mjs";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue, VenuePrice } from "@/lib/venues";

/** A summon's own freshness rule. It changes no other price reader. */
const SUMMON_PRICE_MAX_AGE_DAYS = 30;
/** The longest listing a summon quotes. A longer one is left out whole, never cut. */
const SUMMON_PRICE_STATEMENT_MAX = 160;

const DRINK_MAX = 80;
const SOURCE_URL_MAX = 300;
const DAY_MS = 86_400_000;
const SCALAR_LISTING = /^£(\d+(?:\.\d{1,2})?)$/;
const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f]/;

/** The words a measure prints inside the line: "(pint)", "(175 ml)". */
const MEASURE_WORD: Record<Exclude<DrinkMeasure, "other">, string> = {
  pint: "pint",
  half: "half",
  "125ml": "125 ml",
  "175ml": "175 ml",
  "250ml": "250 ml",
  bottle: "bottle",
  single: "single",
  double: "double",
};

export type SummonPriceEvidence = {
  venueId: string;
  rowId: string;
  drink: string;
  measure: Exclude<DrinkMeasure, "other">;
  amountGbp: number;
  /** The listing exactly as its row states it. */
  priceText: string;
  /** The listing when it says more than the figure, quoted whole. Null for a bare figure. */
  statement: string | null;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  /** `YYYY-MM-DD`, the London day the row was read. */
  readDay: string;
};

const londonDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

function cleanLine(value: unknown): string | null {
  if (typeof value !== "string" || UNSAFE_TEXT.test(value)) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean || null;
}

function sameAmount(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.005;
}

/** True when the listing states this exact figure, in pounds and pence or whole pounds. */
function listingStatesAmount(listing: string, amount: number): boolean {
  for (const match of listing.matchAll(/£(\d+(?:\.\d{1,2})?)(?![\d.])/g)) {
    if (sameAmount(Number(match[1]), amount)) return true;
  }
  return false;
}

function servingMatches(drink: string, measure: DrinkMeasure): boolean {
  if (measure === "pint") return isComparablePintServing({ measure, cheapestPint: drink });
  const named = measureNamedInDrinkText(drink);
  return named === null || named === measure;
}

function anyFutureRead(row: VenuePrice, nowMs: number): boolean {
  return String(row.scraped_at_values ?? "")
    .split("|")
    .map((value) => value.trim())
    .some((value) => {
      if (!value) return false;
      const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
      const instant = Date.parse(value);
      return (day !== undefined && day > londonDay.format(nowMs)) || (Number.isFinite(instant) && instant > nowMs);
    });
}

function evidenceFromRow(venueId: string, row: VenuePrice, amount: number, nowMs: number): SummonPriceEvidence | null {
  const rowId = cleanLine(row.app_price_id);
  const drink = cleanLine(row.pint_name);
  const measure = statedDrinkMeasure(row.measure);
  if (!rowId || !drink || drink.length > DRINK_MAX || !measure || measure === "other") return null;
  if (!servingMatches(drink, measure)) return null;

  const priceText = cleanLine(row.price_text);
  if (!priceText || priceText.length > SUMMON_PRICE_STATEMENT_MAX) return null;
  const scalar = SCALAR_LISTING.exec(priceText);
  if (scalar ? !sameAmount(Number(scalar[1]), amount) : !listingStatesAmount(priceText, amount)) return null;

  const source = namedLegacyPintPriceSource(row);
  if (!source || source.url.length > SOURCE_URL_MAX || /\s/.test(source.url) || UNSAFE_TEXT.test(source.label)) {
    return null;
  }

  if (anyFutureRead(row, nowMs)) return null;
  const observedAt = legacyPintPriceObservedAt(row, nowMs);
  if (!observedAt) return null;
  const readDay = londonDay.format(Date.parse(observedAt));
  const age = dayNumber(londonDay.format(nowMs)) - dayNumber(readDay);
  if (!(age >= 0 && age <= SUMMON_PRICE_MAX_AGE_DAYS)) return null;

  return {
    venueId,
    rowId,
    drink,
    measure,
    amountGbp: amount,
    priceText,
    statement: scalar ? null : priceText,
    sourceLabel: source.label,
    sourceUrl: source.url,
    observedAt,
    readDay,
  };
}

/**
 * The dated price for this pub's listed figure, or null. Null when any fact is
 * missing, the row is not live, the read is in the future or more than 30
 * London days old, or the venue is not a pub. Null never means the pub has no
 * price: it means this invite cannot say one honestly.
 */
export function selectSummonPrice(venue: Venue | null | undefined, nowMs: number): SummonPriceEvidence | null {
  if (!venue || !Number.isFinite(nowMs) || !isPubVenueKind(venue.kind) || !Array.isArray(venue.prices)) return null;
  const live = venue.prices.filter(
    (row): row is VenuePrice & { price_gbp: number } =>
      isLivePriceRow(row) && typeof row.price_gbp === "number" && Number.isFinite(row.price_gbp) && row.price_gbp > 0,
  );
  if (live.length === 0) return null;
  // The listed figure is the lowest live row, the rule the detail grouping uses.
  // A drinker's logged price is another lane and never stands in for it.
  const amount = Math.min(...live.map((row) => row.price_gbp));
  const row = live.find((candidate) => candidate.price_gbp === amount);
  return row ? evidenceFromRow(venue.id, row, amount, nowMs) : null;
}

/** "Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026. Source: <url>" */
export function summonPriceLine(price: SummonPriceEvidence): string {
  const figure = price.statement === null ? `at ${formatGbp(price.amountGbp)}` : `as "${price.statement}"`;
  const day = formatObservedDate(new Date(`${price.readDay}T12:00:00Z`));
  return `${price.sourceLabel} listed ${price.drink} (${MEASURE_WORD[price.measure]}) ${figure}, read ${day}. Source: ${price.sourceUrl}`;
}
