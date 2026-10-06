// The one real pub card on the landing page. Pure: no fs, no React.
//
// Captain decision 2026-09-03 (issue #1354): above the fold sits one real pub
// with today's price on record, who listed it and when, and the archaeology
// line with its source. Nothing here is invented. The price is the venue's
// listed cheapest pint from the bundled dataset, the publisher is the row's
// own page, the collection day is the freshness registry's stamp, and the
// "then" figure is a dated, sourced row from public/data/price_history.
//
// The history lane is second class by law (lib/priceHistory.ts): it reaches
// this card as a sentence about the past and stops. It never touches the
// card's current price, which is passed in from the priced venue index.
//
// Which pub: a short preference list first, because the front door should
// show a pub a Londoner knows, then the longest archive span among pubs that
// carry both a listed price and a history row. Deterministic, so the
// prerendered document and its share card agree.

import type { Route } from "next";
import { buildDrinkBrandLanding, DRINK_BRAND_LANDING_CATALOG } from "@/lib/drinkBrandLanding";
import { haystackMatchesBrand } from "@/lib/drinkBrands";
import {
  answerEvidenceFor,
  HERO_RAIL_SIZE,
  type LandingArchiveIndex,
  type LandingRailRow,
} from "@/lib/landingHero";
import {
  formatObservedDay,
  formatObservedMonth,
  groupPriceHistoryByVenue,
  parsePriceHistory,
  venuePriceArc,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { priceMovementLine } from "@/lib/priceMovementLine";
import type { PriceStanding } from "@/lib/priceTier";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { Venue } from "@/lib/venues";

/** Pubs a Londoner knows, tried in order. Ids are the curated venue ids. */
export const LANDING_PUB_PREFERENCE: readonly string[] = [
  "venue-eltcmh", // The Blackfriar, City of London
  "venue-1w54puk", // Fountains Abbey, Paddington
  "venue-qk6ti7", // Camden Head
];

export type LandingPubCardData = {
  id: string;
  name: string;
  area: string;
  /** Listed cheapest pint today, in pounds. */
  priceGbp: number;
  /** The pint the price is for, as the dataset names it. */
  pintName: string;
  /**
   * `/drink/<slug>` when the drink-brand landing family publishes a page for
   * that pint over its floor, else null and the name prints as plain text.
   * The same loader decides both, so the card can never link a 404.
   */
  drinkHref: Route | null;
  /** Who listed it, or null when the row names no publisher. */
  publisher: { label: string; url: string } | null;
  /** ISO day the publisher's own row was last read at its source, or null when no row records one. */
  observedOn: string | null;
  /**
   * How far to trust the figure, decided by lib/priceTier.ts and never here:
   * a listed price with a public page inside its window reads `listed`; a
   * row with no page, or one past its window, falls to `none`. A prerendered
   * document cannot know about a drinker's confirmation after the build, so
   * `confirmed` never appears on this card.
   */
  standing: PriceStanding;
  then: {
    priceGbp: number;
    /** `YYYY-MM-DD` as the archive states it. */
    observedOn: string;
    source: { label: string; url: string };
  };
  /** "Up £2.90 in 13 years." */
  movementLine: string;
  mapHref: string;
};

function pintLabel(venue: Venue): string {
  const raw = (venue.cheapestPint ?? "").trim();
  if (!raw) return "a pint";
  // Dataset pint names arrive shouted ("PRAVHA"); print them as a name.
  const cased = raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw;
  return `a pint of ${cased}`;
}

function drinkHrefFor(venue: Venue, venues: readonly Venue[]): Route | null {
  const pint = venue.cheapestPint ?? "";
  const brand = DRINK_BRAND_LANDING_CATALOG.find((candidate) => haystackMatchesBrand(pint, candidate));
  if (!brand || !buildDrinkBrandLanding(brand.id, venues)) return null;
  return `/drink/${encodeURIComponent(brand.id)}` as Route;
}

/**
 * Build the card from the priced venue index and the raw history file. Null
 * when no venue carries both a listed price and a dated archive row, and the
 * landing then renders no card rather than a made-up one.
 */
export function buildLandingPubCard(
  venues: readonly Venue[],
  rawHistory: unknown,
  opts: { now?: number } = {},
): LandingPubCardData | null {
  const now = opts.now ?? Date.now();
  const history = groupPriceHistoryByVenue(parsePriceHistory(rawHistory, now));
  const candidates = venues.filter(
    (venue) => typeof venue.cheapestPrice === "number" && venue.cheapestPrice > 0 && history.has(venue.id),
  );
  if (candidates.length === 0) return null;

  const preferred = LANDING_PUB_PREFERENCE.map((id) => candidates.find((v) => v.id === id)).find(Boolean);
  const chosen =
    preferred ??
    [...candidates].sort((a, b) => spanYears(history.get(b.id), b, now) - spanYears(history.get(a.id), a, now))[0];
  if (!chosen) return null;

  const arc = venuePriceArc(history.get(chosen.id) ?? [], chosen.cheapestPrice, now);
  if (!arc || arc.nowGbp === null || arc.deltaGbp === null) return null;

  const { publisher, standing, observedOn } = answerEvidenceFor(
    { priceGbp: arc.nowGbp, prices: chosen.prices },
    now,
  );

  return {
    id: chosen.id,
    name: chosen.name,
    area: chosen.primaryBorough,
    priceGbp: arc.nowGbp,
    pintName: pintLabel(chosen),
    drinkHref: drinkHrefFor(chosen, venues),
    publisher,
    observedOn,
    standing,
    then: {
      priceGbp: arc.then.priceGbp,
      observedOn: arc.then.observedOn,
      source: { label: arc.then.source.label, url: arc.then.source.url },
    },
    movementLine: priceMovementLine(arc.deltaGbp, arc.years),
    mapHref: venueMapUrl(chosen.id),
  };
}

function spanYears(rows: PriceHistoryObservation[] | undefined, venue: Venue, now: number): number {
  const arc = venuePriceArc(rows ?? [], venue.cheapestPrice, now);
  return arc ? arc.years : -1;
}

// ── The hero (issue #1357): the archive index and the anchor rail ────────────
// Built at prerender beside the card, from the same two reads. The archive
// index is the whole "then" lane the browser may ever print: one dated row per
// priced pub, keyed by venue id, so a near-you answer can carry its then line
// without the browser importing the history lane.

export function buildLandingArchiveIndex(
  venues: readonly Venue[],
  rawHistory: unknown,
  now: number = Date.now(),
): LandingArchiveIndex {
  const history = groupPriceHistoryByVenue(parsePriceHistory(rawHistory, now));
  const index: LandingArchiveIndex = {};
  for (const venue of venues) {
    if (typeof venue.cheapestPrice !== "number" || venue.cheapestPrice <= 0) continue;
    const arc = venuePriceArc(history.get(venue.id) ?? [], venue.cheapestPrice, now);
    if (!arc) continue;
    index[venue.id] = {
      priceGbp: arc.then.priceGbp,
      observedOn: arc.then.observedOn,
      observedMonth: formatObservedMonth(arc.then.observedOn),
      observedDay: formatObservedDay(arc.then.observedOn),
      years: arc.years,
      source: { label: arc.then.source.label, url: arc.then.source.url },
    };
  }
  return index;
}

/**
 * The rows under the anchor card when the browser has no fix: the cheapest
 * listed pints in the anchor's own borough, cheapest first, the anchor itself
 * left out. An empty answer hides the rail rather than padding it.
 */
export function buildLandingAnchorRail(
  venues: readonly Venue[],
  anchor: { id: string; area: string },
  archive: LandingArchiveIndex,
): LandingRailRow[] {
  return venues
    .filter(
      (venue) =>
        venue.id !== anchor.id &&
        isPubVenueKind(venue.kind) &&
        venue.primaryBorough === anchor.area &&
        typeof venue.cheapestPrice === "number" &&
        venue.cheapestPrice > 0,
    )
    .sort((a, b) => (a.cheapestPrice as number) - (b.cheapestPrice as number) || a.name.localeCompare(b.name))
    .slice(0, HERO_RAIL_SIZE)
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      area: venue.primaryBorough,
      priceGbp: venue.cheapestPrice as number,
      hasThen: venue.id in archive,
    }));
}
