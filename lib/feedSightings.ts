// Ambient price sightings for the feed's London tab — pure model + placement.
//
// The feed's London tab used to show a dead "No pints logged yet tonight" empty
// state with nothing behind it, which kills the habit loop on a cold start. The
// price-sighting rows the /tonight and menu surfaces already read
// (public/data/drink_price_updates) are honest ambient content: a real price,
// from a NAMED source, with a date. This module turns those rows into feed
// sightings and decides where they sit relative to real user drops.
//
// Taste doctrine (docs/VOICE.md): a sighting is NEVER dressed as user activity.
// It carries its source domain + observed date beneath one sourced-price section
// heading, so the surface honestly has content without faking a single drinker.
//
// Every export here is a pure function (no fetch, no fs, no DOM, no serverEnv),
// so the mapping + placement logic is covered hermetically by
// __tests__/feedSightings.test.ts. The server seam
// (app/feed/feedSightings.server.ts) injects the venue resolver and the parsed
// updates.

import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { FeedFilter } from "@/lib/feed";

// A serialisable sighting the server hands the client. Deliberately flat (no
// nested source object beyond the resolved domain) so it crosses the
// server→client boundary cleanly and the card renders it with no extra work.
export type SightingDTO = {
  /** Stable id, one per venue: `sighting-<venueId>`. */
  id: string;
  venueId: string;
  /** Human pub name, server-resolved from the venue index. */
  venueName: string;
  /** "/map?sel=…" — tapping the sighting opens the venue on the map. */
  venueMapUrl: string;
  /** The specific drink the price was observed on (e.g. "Doom Bar"). */
  drink: string;
  /** The observed price in pounds — always a real, positive number. */
  priceGbp: number;
  /** "£5.29", ready to render. */
  priceLabel: string;
  /** The attribution label from the source (e.g. "J D Wetherspoon — official site"). */
  sourceLabel: string;
  /** The absolute source URL the price was attributed to. */
  sourceUrl: string;
  /** The source host, www-stripped (e.g. "jdwetherspoon.com") for provenance. */
  sourceDomain: string;
  /** ISO-8601 observation date — the card shows it, never hides staleness. */
  observedAt: string;
};

/** The venue facts the server resolves for a sighting's grouping key. */
export type SightingVenue = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
};

/** Resolve a drink-update grouping key to its venue facts, or null to skip it. */
export type ResolveSightingVenue = (venueKey: string) => SightingVenue | null;

/** The default cap on how many sightings the feed surfaces at once. */
export const SIGHTINGS_CAP = 12;

/** The www-stripped host of an absolute URL, or "" when it can't be parsed. */
export function sourceDomain(url: string): string {
  if (typeof url !== "string" || url.length === 0) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/** "£5.29" from a numeric price. */
export function formatSightingPrice(price: number): string {
  return `£${price.toFixed(2)}`;
}

// A newer observation wins; on an identical timestamp the cheaper price wins.
// This is how we pick ONE representative sighting per venue (see buildSightings).
function beatsForVenue(candidate: DrinkPriceUpdate, incumbent: DrinkPriceUpdate): boolean {
  const tc = Date.parse(candidate.observedAt);
  const ti = Date.parse(incumbent.observedAt);
  if (tc !== ti) return tc > ti;
  return candidate.priceGbp < incumbent.priceGbp;
}

/**
 * Build ambient sightings from already-parsed, already-validated drink price
 * updates. Pure over (updates, resolve). Guarantees:
 *
 *  - ONE sighting per venue — the freshest observation, cheapest on a tie — so
 *    the surface surveys many pubs instead of repeating one pub's whole menu;
 *  - only priced (> 0), attributable (parseable source domain) rows survive —
 *    a £0 promo or an unattributable row is never shown as a sighting;
 *  - newest observation first (venue name breaks ties for a stable order);
 *  - capped at `cap` (default SIGHTINGS_CAP).
 *
 * `resolve` maps a grouping key to venue facts; returning null drops that venue
 * (e.g. an id the venue index no longer carries).
 */
export function buildSightings(
  updates: DrinkPriceUpdate[],
  resolve: ResolveSightingVenue,
  opts: { cap?: number } = {},
): SightingDTO[] {
  const cap = opts.cap ?? SIGHTINGS_CAP;

  const bestByVenue = new Map<string, DrinkPriceUpdate>();
  for (const update of updates) {
    if (
      typeof update.priceGbp !== "number" ||
      !Number.isFinite(update.priceGbp) ||
      update.priceGbp <= 0
    ) {
      continue;
    }
    if (sourceDomain(update.source?.url ?? "") === "") continue;
    const incumbent = bestByVenue.get(update.venueKey);
    if (!incumbent || beatsForVenue(update, incumbent)) {
      bestByVenue.set(update.venueKey, update);
    }
  }

  const sightings: SightingDTO[] = [];
  for (const [venueKey, update] of bestByVenue) {
    const venue = resolve(venueKey);
    if (!venue) continue;
    sightings.push({
      id: `sighting-${venue.venueId}`,
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueMapUrl: venue.venueMapUrl,
      drink: update.drinkName,
      priceGbp: update.priceGbp,
      priceLabel: formatSightingPrice(update.priceGbp),
      sourceLabel: update.source.label,
      sourceUrl: update.source.url,
      sourceDomain: sourceDomain(update.source.url),
      observedAt: update.observedAt,
    });
  }

  sightings.sort((a, b) => {
    const byDate = Date.parse(b.observedAt) - Date.parse(a.observedAt);
    if (byDate !== 0) return byDate;
    return a.venueName.localeCompare(b.venueName);
  });

  return sightings.slice(0, cap);
}

// ── Placement ─────────────────────────────────────────────────────────────────

// Where the sightings sit relative to the London tab's real user drops:
//  - "primary" — there are NO user drops, so sightings ARE the surface (they
//    replace the dead empty state honestly);
//  - "strip"   — there ARE user drops, so sightings collapse to a compact strip
//    BELOW the fresh user content — real drinkers always lead;
//  - "none" - not the London tab or Latest filter, still loading, or no
//    sightings exist.
export type SightingPlacement = "none" | "primary" | "strip";

export function sightingPlacement(args: {
  tab: string;
  filter: FeedFilter;
  status: "loading" | "ready" | "error";
  userItemCount: number;
  sightingCount: number;
}): SightingPlacement {
  const { tab, filter, status, userItemCount, sightingCount } = args;
  // Sightings are a London-tab affordance only, once the feed has settled, and
  // only in Latest, where an ambient fallback matches the filter's promise.
  // Never mask a load error, another tab, or a narrower feed filter.
  if (
    tab !== "london" ||
    filter !== "latest" ||
    status !== "ready" ||
    sightingCount <= 0
  ) {
    return "none";
  }
  return userItemCount === 0 ? "primary" : "strip";
}
