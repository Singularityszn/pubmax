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
import { measureNamedInDrinkText, NON_PINT_MEASURE_PATTERNS } from "@/lib/drinkMeasureText.mjs";
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

/**
 * A spirit pour a text states: "single" or "double" ending the text or followed
 * by a pour or spirit word. A brand or style word ("Double IPA", "Single Malt")
 * is not a pour, so it names nothing here.
 */
const SPIRIT_POUR =
  /\b(single|double)\b(?=\s+(?:shots?|measures?|of|gin|vodka|rum|whisk(?:e)?y|tequila|brandy|cognac|bourbon|scotch|spirits?|g\s*&\s*t)\b|\s*\)?\s*$)/gi;
/** A can the text names as a serving. A listing's bare "can" is often the verb, so it needs a serving word beside it. */
const DRINK_CAN = /\b(?:cans?|canned)\b/i;
const LISTING_CAN = /\b(?:canned|cans)\b|\b(?:\d+(?:\.\d+)?\s*(?:ml|cl|l)|per|a)\s+can\b/i;
const BOTTLE = /\b(?:bottles?|bottled)\b/i;
const VOLUME = /\b(\d+(?:\.\d+)?)\s*(ml|cl|litres?|l)\b/gi;
const LISTING_MEASURES = [
  ...NON_PINT_MEASURE_PATTERNS,
  { word: "schooners", measure: "other" },
  { word: "halfpint", measure: "half" },
  { word: "halfpints", measure: "half" },
  { word: "single", measure: "single" },
  { word: "singles", measure: "single" },
  { word: "double", measure: "double" },
  { word: "doubles", measure: "double" },
].map(({ word, measure }) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = `\\p{L}\\p{N}\\p{M}_${word.includes("/") ? "/" : ""}`;
  return { measure, pattern: new RegExp(`(^|[^${boundary}])${escaped}(?=$|[^${boundary}])`, "iu") };
});

function millilitres(amount: string, unit: string): number {
  const lower = unit.toLowerCase();
  return Number(amount) * (lower === "ml" ? 1 : lower === "cl" ? 10 : 1000);
}

function withoutDrinkName(text: string, drinkName: string): string {
  const escaped = drinkName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}_])${escaped}(?=$|[^\\p{L}\\p{N}\\p{M}_])`, "giu"), "$1");
}

/**
 * True when a text states a serving other than the row's measure. The drink
 * name and the quoted listing are both read, because either one is printed
 * beside the measure. A serving the text does not state is never inferred.
 */
function servingConflicts(text: string, measure: Exclude<DrinkMeasure, "other">, kind: "drink" | "listing", drinkName?: string): boolean {
  for (const pour of text.matchAll(SPIRIT_POUR)) {
    if (pour[1]!.toLowerCase() !== measure) return true;
  }
  if ((kind === "drink" ? DRINK_CAN : LISTING_CAN).test(text)) return true;
  if (measure !== "bottle" && BOTTLE.test(text)) return true;
  // A listing's serving words apply even before conditions. Its complete drink name is excluded.
  if (kind === "listing") {
    const servingText = drinkName ? withoutDrinkName(text, drinkName) : text;
    if (LISTING_MEASURES.some((entry) => entry.measure !== measure && entry.pattern.test(servingText))) return true;
  }
  const expectedMl =
    measure === "pint" ? 568 : measure === "half" ? 284 : /^(125|175|250)ml$/.test(measure) ? Number.parseInt(measure, 10) : null;
  if (expectedMl !== null) {
    for (const size of text.matchAll(VOLUME)) {
      if (millilitres(size[1]!, size[2]!) !== expectedMl) return true;
    }
  }
  const pintText = text.toLowerCase().replace(/[^a-z0-9½/]+/g, " ")
    .replace(/(?:\bhalf|\b1\/2|½)(?:\s+of)?(?:\s+a)?\s+pints?\b/g, "");
  if (measure !== "pint" && /\bpints?\b/.test(pintText)) return true;
  const named = measureNamedInDrinkText(text);
  if (measure === "pint") return named !== null || (kind === "drink" && !isComparablePintServing({ measure, cheapestPint: text }));
  return named !== null && named !== measure;
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
  if (servingConflicts(drink, measure, "drink")) return null;

  const priceText = cleanLine(row.price_text);
  if (!priceText || priceText.length > SUMMON_PRICE_STATEMENT_MAX) return null;
  const scalar = SCALAR_LISTING.exec(priceText);
  if (scalar ? !sameAmount(Number(scalar[1]), amount) : !listingStatesAmount(priceText, amount)) return null;
  if (!scalar && servingConflicts(priceText, measure, "listing", drink)) return null;

  const source = namedLegacyPintPriceSource(row);
  if (!source || source.url.length > SOURCE_URL_MAX || /\s/.test(source.url) || UNSAFE_TEXT.test(source.url) || UNSAFE_TEXT.test(source.label)) {
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

/** "Pint Prices listed Amstel (pint) at £5.50, read 9 November 2026." The line without its source link. */
export function summonPriceSentence(price: SummonPriceEvidence): string {
  const figure = price.statement === null ? `at ${formatGbp(price.amountGbp)}` : `as "${price.statement}"`;
  const day = formatObservedDate(new Date(`${price.readDay}T12:00:00Z`));
  return `${price.sourceLabel} listed ${price.drink} (${MEASURE_WORD[price.measure]}) ${figure}, read ${day}.`;
}

/** The sentence, then the publisher's own page in full. */
export function summonPriceLine(price: SummonPriceEvidence): string {
  return `${summonPriceSentence(price)} Source: ${price.sourceUrl}`;
}
