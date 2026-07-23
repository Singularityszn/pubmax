// Tonight-list de-duplication (draft plan F6, decision #11). Pure and React-free.
//
// The live-taste P0: /tonight rendered ~60 near-identical "Curry Club - every
// Thursday" rows in one endless column. This collapses chain-wide duplicate
// offers into ONE card per offer family, carrying the nearest venue plus the
// rest as expandable alternates, so a syndicated promotion reads as one deal at
// many pubs rather than sixty separate recommendations.
//
// It reuses lib/dealsDigest's grouping primitive unchanged (that module is
// surface-agnostic by design and already unit-tested); this file only maps its
// output to the Tonight card shape and states the surface contract.

import { groupIdenticalDeals, type NearPoint } from "@/lib/dealsDigest";
import type { WhatsOnRow } from "@/lib/whatsOn";

export type { NearPoint } from "@/lib/dealsDigest";

export type TonightGroupedRow = {
  /** The venue to render as the card: the nearest in the family when a near
   *  point is known, otherwise the soonest (then input order). */
  row: WhatsOnRow;
  /** Other venues running the same deal, nearest-first — the expander content.
   *  Empty for a lone listing. */
  alternates: WhatsOnRow[];
  /** Distinct real venues in the family (the card's venue + alternates). 1 for a
   *  lone listing; drives the "Same deal at N pubs" disclosure. */
  venueCount: number;
};

/**
 * Group the Tonight list's chain-wide duplicate offers. Rows sharing a
 * normalised (kind, title, source) family collapse into one entry; groups keep
 * the input's order (first appearance), and members within a group are
 * nearest-first when `near` is known, else soonest then input order. Malformed
 * rows are dropped by the underlying primitive. Pure and non-mutating; an empty
 * input yields an empty list.
 *
 * One card per family is deliberately STRONGER than the plan's "at most two of
 * a family in the first ten results" cap — a family can appear at most once
 * anywhere in the returned list, so the cap holds by construction.
 */
export function groupTonightListings(
  rows: readonly WhatsOnRow[],
  near: NearPoint | null,
): TonightGroupedRow[] {
  return groupIdenticalDeals(rows, { near }).map((digest) => ({
    row: digest.display,
    alternates: digest.members.slice(1),
    venueCount: digest.venueCount,
  }));
}
