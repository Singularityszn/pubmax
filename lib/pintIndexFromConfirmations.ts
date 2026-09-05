// The PRODUCER for the public London Pint Index snapshot.
//
// `lib/pintIndex.ts` has always said what the Index may ADMIT: a
// `confirmed_pint_drop` source carrying `reviewState: "confirmed"` and a
// `confirmationId`, an observation inside the declared window, a canonical
// borough. Nothing ever built one, so the shipped snapshot is a hand-written
// `"status": "empty"` file. This module builds it, and admission is untouched:
// the script validates the result through `validatePintIndexSnapshot` and dies
// rather than write a snapshot that module would refuse.
//
// FOUR rules that are the whole design.
//
// 1. ONLY A CONFIRMATION MAY BE CITED. A Pint Drop with no live confirmation is
//    a report, not evidence a stranger can check, so it is dropped and counted.
//    `confirmationIsLive` is the same window `lib/priceTier.ts` owns, so a pub
//    the Index dates and a pub the venue sheet calls Confirmed are the same set.
//
// 2. THE OBSERVATION DATE IS THE NIGHT THE PRICE WAS SEEN, never the day it was
//    confirmed. The Index publishes what a pint cost on a date; a confirmation
//    is when a second drinker agreed, and printing that instead would date every
//    price to whenever somebody else happened to walk in.
//
// 3. EVERY DROP IS COUNTED SOMEWHERE. A pub the venue index cannot resolve, a
//    point outside every London borough, a price that is not a positive figure:
//    each has its own `excluded` reason with its own count, because a silent
//    drop is how an Index quietly stops covering a borough with nothing saying
//    so.
//
// 4. NOTHING IS INVENTED. The publisher, the licence and the URL a citation
//    resolves to are the caller's, so this module never writes a name or a link
//    of its own, and a source URL that is not a public page is refused upstream
//    by the validator rather than guessed at here.

import { measureIsPint, type DrinkMeasure } from "@/lib/drinkMeasure";
import {
  confirmationIsLive,
  type PintDropConfirmation,
} from "@/lib/pintDropConfirmation";
import {
  boroughCode,
  LONDON_BOROUGH_NAMES,
  type LondonBoroughName,
  type PintIndexObservation,
  type PintIndexSnapshot,
  type PintIndexSource,
} from "@/lib/pintIndex";

/** One confirmed Pint Drop, as the store hands it over. */
export type ConfirmedDropRow = {
  id: string;
  venueId: string;
  priceGbp: number | null;
  /**
   * The serving the price is about. Absent reads as `pint`, so every row
   * written before migration 0147 is cited exactly as it was.
   */
  measure?: DrinkMeasure;
  /** ISO instant the drop was logged: the night the price was seen. */
  createdAt: string;
  confirmation?: PintDropConfirmation | null;
};

/** What the Index needs to know about a pub: its name and where it stands. */
export type IndexVenueFact = {
  name: string;
  lat: number;
  lng: number;
};

/** Why a confirmed drop did not reach the snapshot. Closed, and each is counted. */
export const PINT_INDEX_EXCLUSION_REASONS = [
  "confirmation_not_live",
  "measure_not_pint",
  "price_not_recorded",
  "venue_not_in_index",
  "venue_outside_london_boroughs",
] as const;
export type PintIndexExclusionReason = (typeof PINT_INDEX_EXCLUSION_REASONS)[number];

const EXCLUSION_NOTE: Record<PintIndexExclusionReason, string> = {
  confirmation_not_live:
    "A Pint Drop nobody has confirmed inside the trust window is a report, not a citable observation.",
  measure_not_pint:
    "The price is for another measure, so it says nothing about what a pint costs. It is never scaled into one.",
  price_not_recorded: "A Pint Drop carrying no price says nothing about what a pint costs.",
  venue_not_in_index: "The pub is not in the curated venue index, so the Index cannot name it.",
  venue_outside_london_boroughs:
    "The pub's point falls outside every London borough boundary, so this Index does not cover it.",
};

export type PintIndexBuildInput = {
  drops: readonly ConfirmedDropRow[];
  /** Venue id to its name and point. A missing id is counted, never guessed. */
  venues: ReadonlyMap<string, IndexVenueFact>;
  /** Point to borough. The caller owns the boundary artifact and its version. */
  classify: (lat: number, lng: number) => LondonBoroughName | null;
  snapshotId: string;
  generatedAt: string;
  classification: PintIndexSnapshot["classification"];
  /** Who publishes the citation, and where one drop resolves to for a reader. */
  publisher: string;
  dropUrl: (dropId: string) => string;
  licence: string | null;
  /**
   * Exclusions that are true of the whole Index rather than of any drop here,
   * carried forward from the snapshot this one replaces. The legacy
   * competitor-derived baseline is quarantined that way and stays quarantined.
   */
  carriedExclusions?: PintIndexSnapshot["excluded"];
};

export type PintIndexBuildResult = {
  snapshot: PintIndexSnapshot;
  /** Confirmed drops examined, so a caller can report what it read. */
  examined: number;
  /** Drops that became observations. */
  published: number;
};

const BOROUGH_NAME_SET: ReadonlySet<string> = new Set(LONDON_BOROUGH_NAMES);

function pricePenceOf(priceGbp: number | null): number | null {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) return null;
  const pence = Math.round(priceGbp * 100);
  return pence > 0 ? pence : null;
}

/**
 * Build the public snapshot from confirmed Pint Drops.
 *
 * Pure and total: it throws for nothing, and every drop it cannot publish is
 * counted under a named reason. The caller validates the result before writing.
 */
export function buildPintIndexSnapshotFromConfirmations(
  input: PintIndexBuildInput,
): PintIndexBuildResult {
  const now = Date.parse(input.generatedAt);
  const sources: PintIndexSource[] = [];
  const observations: PintIndexObservation[] = [];
  const excludedCounts = new Map<PintIndexExclusionReason, number>();
  const count = (reason: PintIndexExclusionReason): void => {
    excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1);
  };

  for (const drop of input.drops) {
    const confirmation = drop.confirmation;
    if (!confirmation || !confirmationIsLive(confirmation, now)) {
      count("confirmation_not_live");
      continue;
    }
    // A half already cannot be confirmed (lib/pintDropConfirmation.ts refuses
    // it on both sides of a pair), so this catches the rows that carry a
    // confirmation minted BEFORE migration 0147 flagged their measure. The
    // Index publishes what a PINT costs, and a half is counted out under its
    // own name rather than doubled into one.
    if (!measureIsPint(drop.measure)) {
      count("measure_not_pint");
      continue;
    }
    const pricePence = pricePenceOf(drop.priceGbp);
    if (pricePence === null) {
      count("price_not_recorded");
      continue;
    }
    const venue = input.venues.get(drop.venueId);
    if (!venue) {
      count("venue_not_in_index");
      continue;
    }
    const boroughName = input.classify(venue.lat, venue.lng);
    if (!boroughName || !BOROUGH_NAME_SET.has(boroughName)) {
      count("venue_outside_london_boroughs");
      continue;
    }

    // One source per DROP, not per confirmation: a pair carries one
    // confirmation id and two observations, and each observation has to resolve
    // to the drop it is actually about.
    const sourceId = `drop-${drop.id}`;
    sources.push({
      id: sourceId,
      kind: "confirmed_pint_drop",
      confirmationId: confirmation.confirmationId,
      reviewState: "confirmed",
      publisher: input.publisher,
      sourceUrl: input.dropUrl(drop.id),
      licence: input.licence,
    });
    observations.push({
      venueId: drop.venueId,
      pubName: venue.name,
      boroughCode: boroughCode(boroughName),
      boroughName,
      pricePence,
      observedAt: new Date(drop.createdAt).toISOString(),
      sourceId,
    });
  }

  const times = observations.map((observation) => Date.parse(observation.observedAt));
  const observationWindow =
    times.length > 0
      ? {
          start: new Date(Math.min(...times)).toISOString(),
          end: new Date(Math.max(...times)).toISOString(),
        }
      : null;

  const excluded = [
    ...(input.carriedExclusions ?? []),
    ...PINT_INDEX_EXCLUSION_REASONS.filter((reason) => (excludedCounts.get(reason) ?? 0) > 0).map(
      (reason) => ({
        reason,
        observationCount: excludedCounts.get(reason) ?? 0,
        note: EXCLUSION_NOTE[reason],
      }),
    ),
  ];

  return {
    snapshot: {
      schemaVersion: 1,
      snapshotId: input.snapshotId,
      status: observations.length > 0 ? "published" : "empty",
      generatedAt: input.generatedAt,
      observationWindow,
      classification: input.classification,
      sources,
      observations,
      excluded,
    },
    examined: input.drops.length,
    published: observations.length,
  };
}
