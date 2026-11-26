// What a quiet night offers instead of a mood chip: real pubs with a listed
// price.
//
// A night nothing is listed on used to hand the reader nine vibe chips and a
// link to the map. Chips are an ask, not an answer, so the quiet page now
// carries pubs: the cheapest listed pints we hold, each with its own area,
// its own figure and its own way onto the map.
//
// WHY THIS IS NOT A "QUIETER PUBS" LIST. The captain's F02 ruling (recorded in
// lib/AGENTS.md) settles it: the only quiet reading this product has is
// `estimateBusyness`, whose typical-pattern half is a function of the hour and
// identical for every pub in London, and an unreported pub's crowd state is
// unknown rather than quiet. So no row here claims a pub is quiet. The rows
// claim what they can prove: a price somebody listed, on a day the dataset
// names.
//
// ONE ROW PER CHAIN (site audit D17, 13 Sep 2026). A chain prices one menu
// across every branch, so a list ordered by price is a list of that chain's
// branches: the Spoons import put a dozen Wetherspoons at £1.99 and the list
// read four of them and no other pub. The chain keeps its cheapest branch and
// its name on that row, and the other rows go to other pubs. It is the lede's
// demotion rule (`lib/tonightChainLanes.ts`) read for a price list: the chain
// is shown and labelled, never allowed to fill the list.
//
// Tonight and Discover read eligible London rows through
// `loadLondonPintRanking` (lib/londonPintRanking.server.ts).
// docs/rules/lib-prices-trust-and-drinks.md owns the ranking contract.

import type { Route } from "next";
import { comparablePint } from "@/lib/comparablePint.mjs";
import { isVerifiedClosedCuratedVenue, isVerifiedClosedPub } from "@/lib/verifiedClosedPubs";
import type { HuntStanding } from "@/lib/cheapestHunt";

import type { TonightChainLaneKey } from "@/lib/tonightChainLanes";
import { venueAreaLabel } from "@/lib/venueDisplay";
import { isPublicRankablePub } from "@/lib/venueKindFilters";

export type TonightCheapPint = {
  venueId: string;
  name: string;
  borough: string;
  /** Cheapest listed pint in pounds. Always a real figure, never a guess. */
  priceGbp: number;
  drinkLabel?: string | null;
  servingSize?: string | null;
  publisher?: { label: string; url: string } | null;
  standing?: HuntStanding;
  /** The chain that runs the pub, or null. The list holds one row per chain. */
  chain: TonightChainLaneKey | null;
  /** When that cheapest pint was last read at its source. Absent or null when it records none. */
  observedAt?: string | null;
  /** The hunt's own link to the pub on the map; a base pub's carries its point. */
  mapHref?: string;
};

export type TonightCheapPintCandidate = {
  id: string;
  name: string;
  primaryBorough: string;
  cheapestPrice: number | null;
  drinkLabel?: string | null;
  servingSize?: string | null;
  publisher?: { label: string; url: string } | null;
  standing?: HuntStanding;
  observedAt?: string | null;
  chain?: TonightChainLaneKey | null;
  mapHref?: string;
};

/**
 * The fields the London ranking takes from the cheapest-pint hunt.
 */
export type TonightHuntPint = {
  venueId: string;
  pubName: string;
  placeName: string;
  priceGbp: number;
  drinkLabel?: string | null;
  servingSize?: string | null;
  /** ISO day (`YYYY-MM-DD`) the publisher's own row was read. */
  observedOn: string;
  publisher: { label: string; url: string };
  standing?: HuntStanding;
  mapHref: string;
};

/** Where a row opens the pub: the hunt's own map link, else the pub by its id. */
export function tonightCheapPintHref(row: Pick<TonightCheapPint, "venueId" | "mapHref">): Route {
  return (row.mapHref ?? `/map?sel=${encodeURIComponent(row.venueId)}`) as Route;
}

/** How many rows the quiet page carries. Enough to choose from, short enough to read. */
export const TONIGHT_CHEAP_PINTS_LIMIT = 4;

export const TONIGHT_CHEAP_PINTS_TITLE = "Cheapest listed pints";

const CHAIN_LABELS: Record<TonightChainLaneKey, string> = {
  wetherspoon: "Wetherspoon",
  "greene-king": "Greene King",
};

/** The name a cheap pint row prints for the chain that runs the pub. */
export function tonightCheapPintChainLabel(chain: TonightChainLaneKey): string {
  return CHAIN_LABELS[chain];
}

/** What a priced venue carries that can tie it to a chain. */
export type TonightCheapPintSource = {
  id: string;
  website: string;
  prices: readonly { pub_name: string; pub_url: string; website: string }[];
};

// "JD Wetherspoon", "J D Wetherspoon", "JD Wetherspoons": how a price listing
// names the operator after the pub ("The George - JD Wetherspoon").
const WETHERSPOON_LISTING_LABEL = /\bj\.?\s?d\.?\s+wetherspoons?\b/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The venue ids Tonight treats as Wetherspoon pubs: the union of two
 * first-party-derived sources.
 *
 * A directory gap alone does not establish an operator change. A pub in either
 * the directory join or SpoonMe pack is a Wetherspoon for the cap and label.
 * Closed pubs remain excluded by tonightCheapPints regardless of membership.
 */
export function tonightWetherspoonVenueIds(
  directoryMatchedVenueIds: ReadonlySet<string>,
  spoonMeVenueIds: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...directoryMatchedVenueIds, ...spoonMeVenueIds]);
}

/**
 * Which chain runs a pub, read off what a SOURCE says about it, never off a
 * name that sounds like one. Three sources answer, strongest first: the
 * first-party Wetherspoon membership (`tonightWetherspoonVenueIds`: the
 * directory join by name and 250 m, and the SpoonMe pack), the pub's own
 * website host, and the price listing naming the operator after the pub. A pub
 * none of them ties to a chain answers null.
 */
export function tonightCheapPintChain(
  venue: TonightCheapPintSource,
  matchedWetherspoonVenueIds: ReadonlySet<string>,
): TonightChainLaneKey | null {
  if (matchedWetherspoonVenueIds.has(venue.id)) return "wetherspoon";
  const websites = [venue.website, ...venue.prices.map((price) => price.website)];
  for (const website of websites) {
    const host = hostOf(website);
    if (hostIs(host, "jdwetherspoon.com")) return "wetherspoon";
    if (hostIs(host, "greeneking.co.uk")) return "greene-king";
  }
  for (const price of venue.prices) {
    if (WETHERSPOON_LISTING_LABEL.test(`${price.pub_name} ${decoded(price.pub_url)}`)) {
      return "wetherspoon";
    }
  }
  return null;
}

/**
 * Use the pub's locality, then its borough. If only the UK bundle holds the
 * pub, use its city and any known Wetherspoon membership.
 */
export function tonightCheapPintCandidates(
  pints: readonly TonightHuntPint[],
  venues: ReadonlyMap<string, TonightCheapPintSource & { primaryBorough: string; locality?: string }>,
  matchedWetherspoonVenueIds: ReadonlySet<string>,
): TonightCheapPintCandidate[] {
  return pints.filter((pint) => comparablePint({
    cheapestPrice: pint.priceGbp,
    priceSource: pint.publisher?.label,
    priceObservedAt: pint.observedOn,
  }) !== null).map((pint) => {
    const venue = venues.get(pint.venueId);
    return {
      id: pint.venueId,
      name: pint.pubName,
      primaryBorough: venueAreaLabel({
        locality: venue?.locality,
        primaryBorough: venue?.primaryBorough || pint.placeName,
      }),
      cheapestPrice: pint.priceGbp,
      drinkLabel: pint.drinkLabel ?? null,
      servingSize: pint.servingSize ?? null,
      publisher: pint.publisher,
      standing: pint.standing,
      observedAt: `${pint.observedOn}T12:00:00.000Z`,
      chain: tonightCheapPintChain(
        venue ?? { id: pint.venueId, website: "", prices: [] },
        matchedWetherspoonVenueIds,
      ),
      mapHref: pint.mapHref,
    };
  });
}

/**
 * The hunt's order (lib/cheapestHunt.ts `compareHuntPints`): cheapest first,
 * then the freshest read, then the name, then the id, so two pubs at one price
 * keep one order on every machine and the first row is the pub the landing's
 * London row names. A pub with no listed figure is not a row: "no price logged
 * here yet" is the honest line elsewhere, and this list is only about the ones
 * we hold. A bar the public cannot walk into is not a row either
 * (`isPublicRankablePub`). A chain answers with its first branch in that order
 * and no other.
 */
export function tonightCheapPints(
  venues: readonly TonightCheapPintCandidate[],
  limit: number = TONIGHT_CHEAP_PINTS_LIMIT,
): TonightCheapPint[] {
  const rows: TonightCheapPint[] = [];
  for (const venue of venues) {
    if (typeof venue.cheapestPrice !== "number" || !Number.isFinite(venue.cheapestPrice)) {
      continue;
    }
    if (venue.cheapestPrice <= 0) continue;
    if (!venue.id || !venue.name) continue;
    if (isVerifiedClosedCuratedVenue(venue.id) || isVerifiedClosedPub(venue.id)) continue;
    // A students' union or members' bar holds a real price nobody off the
    // street can pay (lib/venueKindFilters.ts).
    if (!isPublicRankablePub({ name: venue.name })) continue;
    rows.push({
      venueId: venue.id,
      name: venue.name,
      borough: venue.primaryBorough,
      priceGbp: venue.cheapestPrice,
      ...(venue.drinkLabel !== undefined ? { drinkLabel: venue.drinkLabel } : {}),
      ...(venue.servingSize !== undefined ? { servingSize: venue.servingSize } : {}),
      ...(venue.publisher !== undefined ? { publisher: venue.publisher } : {}),
      ...(venue.standing !== undefined ? { standing: venue.standing } : {}),
      chain: venue.chain ?? null,
      observedAt: venue.observedAt ?? null,
      ...(venue.mapHref ? { mapHref: venue.mapHref } : {}),
    });
  }
  rows.sort(
    (left, right) =>
      left.priceGbp - right.priceGbp ||
      (right.observedAt ?? "").localeCompare(left.observedAt ?? "") ||
      left.name.localeCompare(right.name, "en-GB") ||
      left.venueId.localeCompare(right.venueId),
  );
  const max = Math.max(0, Math.floor(limit));
  const chainsShown = new Set<TonightChainLaneKey>();
  const shown: TonightCheapPint[] = [];
  for (const row of rows) {
    if (shown.length >= max) break;
    if (row.chain) {
      if (chainsShown.has(row.chain)) continue;
      chainsShown.add(row.chain);
    }
    shown.push(row);
  }
  return shown;
}
