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

import { namedLegacyPintPriceSource } from "@/lib/drinks";
import {
  groupPriceHistoryByVenue,
  parsePriceHistory,
  venuePriceArc,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { priceMovementLine } from "@/lib/priceMovementLine";
import { priceStandingFor, type PriceStanding } from "@/lib/priceTier";
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
  /** Who listed it, or null when the row names no publisher. */
  publisher: { label: string; url: string } | null;
  /** ISO day the bundled dataset was collected. */
  collectedOn: string;
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

function publisherFor(venue: Venue): { label: string; url: string } | null {
  for (const row of venue.prices) {
    const named = namedLegacyPintPriceSource(row);
    if (named) return { label: named.label, url: named.url };
  }
  return null;
}

/**
 * Build the card from the priced venue index and the raw history file. Null
 * when no venue carries both a listed price and a dated archive row, and the
 * landing then renders no card rather than a made-up one.
 */
export function buildLandingPubCard(
  venues: readonly Venue[],
  rawHistory: unknown,
  opts: { collectedOn: string; now?: number },
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

  const arc = venuePriceArc(history.get(chosen.id) ?? [], chosen.cheapestPrice, now);
  if (!arc || arc.nowGbp === null || arc.deltaGbp === null) return null;

  const publisher = publisherFor(chosen);
  const { standing } = priceStandingFor(
    {
      listed: publisher
        ? { priceGbp: arc.nowGbp, sourceUrl: publisher.url, observedAt: `${opts.collectedOn}T12:00:00.000Z` }
        : null,
    },
    now,
  );

  return {
    id: chosen.id,
    name: chosen.name,
    area: chosen.primaryBorough,
    priceGbp: arc.nowGbp,
    pintName: pintLabel(chosen),
    publisher,
    collectedOn: opts.collectedOn,
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
