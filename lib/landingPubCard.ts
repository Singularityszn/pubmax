// The one real pub card on the landing page. Pure: no fs, no React.
//
// Captain decision 2026-09-03 (issue #1354): above the fold sits one real pub
// with a listed price on record, who listed it and when, and the archaeology
// line with its source. Nothing here is invented. The price is the venue's
// listed cheapest pint from the bundled dataset, the publisher is the row's
// own page, the date belongs to that row's source read, and the
// "then" figure is a dated, sourced row from public/data/price_history.
//
// The history lane is second class by law (lib/priceHistory.ts): it reaches
// this card as a sentence about the past and stops. It never touches the
// card's current price, which is passed in from the priced venue index.
//
// Which pub: the CHEAPEST listed pint among pubs that carry both a listed
// price and a history row (product decision 16 Oct 2026, after a UX audit).
// The front door's one action says "Cheapest pints near me", so the pub under
// it shows a cheap pint rather than a famous dear one: a hand-picked £6.50 pub
// under that promise read as a contradiction. A pub whose figure stands as
// `listed` (a named publisher read inside its window) beats one that does not,
// so the card keeps its provenance line; ties go to the longer archive span,
// then the name. Deterministic, so the prerendered document and its share card
// agree, and derived, so a re-collected dataset moves the pick.
//
// Where: Zone 1 only, when the caller hands in the station table (captain
// decision D1 (a), 11 Nov 2026). Cheapest-anywhere put a Sutton pint under a
// Kingsbury pint, both £2.43, so the London story started in the outer zones.
// A pub takes the zone of its nearest station (lib/nearestStationZone.mjs), the
// same rule the map's zone lens uses, and the card names that station so the
// approximation is on the page. No Zone 1 pub that qualifies means no card,
// never a quiet fall back to the outer zones.

import type { Route } from "next";
import { comparableVenuePint } from "@/lib/comparableVenuePint";
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
import { nearestStationZone, type StationZone } from "@/lib/nearestStationZone.mjs";
import { priceMovementLine } from "@/lib/priceMovementLine";
import type { PriceStanding } from "@/lib/priceTier";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { venueAreaLabel } from "@/lib/venueDisplay";
import type { Venue } from "@/lib/venues";

/** The fare zone the landing's pub card and its rail are drawn from. */
const LANDING_HERO_ZONE = 1;

/** The station a pub takes its fare zone from, as the card prints it. */
export type LandingCardStation = { name: string; zone: number };

type LandingPickOpts = {
  now?: number;
  /**
   * The station table (data/tfl_station_zones.json). With it, only pubs whose
   * nearest station is in LANDING_HERO_ZONE may win. The landing always passes
   * it; fixtures that test other rules may leave it out.
   */
  stations?: readonly StationZone[];
};

function heroStation(venue: Venue, stations: readonly StationZone[]): LandingCardStation | null {
  const nearest = nearestStationZone(venue.latitude, venue.longitude, stations);
  return nearest && nearest.zone === LANDING_HERO_ZONE ? { name: nearest.station, zone: nearest.zone } : null;
}

/** True when the venue may stand in the hero: any pub without a table, else Zone 1 only. */
function inHeroZone(venue: Venue, stations: readonly StationZone[] | undefined): boolean {
  return !stations || heroStation(venue, stations) !== null;
}

export type LandingPubCardData = {
  id: string;
  name: string;
  area: string;
  primaryBorough: string;
  /**
   * The nearest station and its fare zone, which is how the card knows it is
   * in Zone 1. Null when the card was picked without a station table.
   */
  station: LandingCardStation | null;
  /** Cheapest listed pint in pounds, without a claim about today's price. */
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
  /**
   * "Up £2.90 in 13 years.", or null when lib/priceHistory.ts cannot show the
   * two figures are the same pint at an ordinary price. Both figures print
   * either way; only the movement is withheld.
   */
  movementLine: string | null;
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
  opts: LandingPickOpts = {},
): LandingPubCardData | null {
  const now = opts.now ?? Date.now();
  const history = groupPriceHistoryByVenue(parsePriceHistory(rawHistory, now));
  const candidates = venues.filter(
    (venue) =>
      isPublicRankablePub(venue) &&
      comparableVenuePint(venue, null, false, now) !== null &&
      history.has(venue.id) &&
      inHeroZone(venue, opts.stations),
  );
  if (candidates.length === 0) return null;

  // Listed first, then cheapest, then the longest archive span, then the name.
  const ranked = candidates.map((venue) => ({
    venue,
    listed: answerEvidenceFor({ priceGbp: venue.cheapestPrice as number, prices: venue.prices }, now).standing === "listed",
    span: spanYears(history.get(venue.id), venue, now),
  }));
  ranked.sort(
    (a, b) =>
      Number(b.listed) - Number(a.listed) ||
      (a.venue.cheapestPrice as number) - (b.venue.cheapestPrice as number) ||
      b.span - a.span ||
      a.venue.name.localeCompare(b.venue.name),
  );
  const chosen = ranked[0]?.venue;
  if (!chosen) return null;

  // The bundled index names the cheapest pint but states neither its serving
  // nor its terms, so today's figure carries no comparison item and no movement
  // is said against the archive. The card still stands on both figures.
  const arc = venuePriceArc(history.get(chosen.id) ?? [], chosen.cheapestPrice, now);
  if (!arc || arc.nowGbp === null) return null;

  const { publisher, standing, observedOn } = answerEvidenceFor(
    { priceGbp: arc.nowGbp, prices: chosen.prices },
    now,
  );

  return {
    id: chosen.id,
    name: chosen.name,
    area: venueAreaLabel(chosen),
    primaryBorough: chosen.primaryBorough,
    station: opts.stations ? heroStation(chosen, opts.stations) : null,
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
    movementLine: arc.deltaGbp === null ? null : priceMovementLine(arc.deltaGbp, arc.years),
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
      // Decided here, with the policy, against this venue's own listed figure.
      movement:
        arc.nowGbp !== null && arc.deltaGbp !== null
          ? { nowGbp: arc.nowGbp, line: priceMovementLine(arc.deltaGbp, arc.years) }
          : null,
    };
  }
  return index;
}

/**
 * The rows under the anchor card when the browser has no fix, cheapest first,
 * the anchor itself left out. With the station table they follow the card:
 * the next cheapest listed pints in LANDING_HERO_ZONE, from any borough. With
 * none they are the anchor's own borough. An empty answer hides the rail rather
 * than padding it.
 */
export function buildLandingAnchorRail(
  venues: readonly Venue[],
  anchor: { id: string; primaryBorough: string },
  archive: LandingArchiveIndex,
  stations?: readonly StationZone[],
): LandingRailRow[] {
  return venues
    .filter(
      (venue) =>
        venue.id !== anchor.id &&
        isPublicRankablePub(venue) &&
        (stations ? inHeroZone(venue, stations) : venue.primaryBorough === anchor.primaryBorough) &&
        comparableVenuePint(venue, null, false) !== null,
    )
    .sort((a, b) => (a.cheapestPrice as number) - (b.cheapestPrice as number) || a.name.localeCompare(b.name))
    .slice(0, HERO_RAIL_SIZE)
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      area: venueAreaLabel(venue),
      primaryBorough: venue.primaryBorough,
      priceGbp: venue.cheapestPrice as number,
      hasThen: venue.id in archive,
    }));
}
