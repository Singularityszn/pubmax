// Browser-safe. What CONFIRMS a Pint Drop, and what that confirmation says.
//
// Captain's intent 3 Sept 2026: green means a drinker confirmed the price
// inside 30 days. Two halves of that promise already shipped and never met.
// `lib/trustPill.ts` owns the WORDS and the window a confirmation stays green
// for. `lib/pintIndex.ts` refuses a `confirmed_pint_drop` source unless it
// carries `reviewState: "confirmed"` and a `confirmationId`. Nothing in the
// tree ever minted one, so green had no producer. This module is that
// producer's policy half; the write lives in `lib/pintDropConfirm.server.ts`.
//
// ONE definition of a second independent reporter, never two. The finder below
// is built on `corroboratedPriceDrop` (`lib/venues.ts`), and it runs SERVER-SIDE
// over stored rows, where every authority key is present.
//
// The reading half is one call too: `authoritativePriceDrop` (`lib/venues.ts`)
// asks THIS confirmation first and only then falls back to a corroboration the
// browser can still prove, so a pill can never read Confirmed over a pin the
// map refuses to colour. It used to be able to: a browser sees no authority key
// on an anonymous drop (#1440), so the client re-derivation went quiet over a
// pub the server had confirmed.
//
// Independence follows ADR 0010, read through the drop lane's own key. ADR
// 0010's `submitterBucket` puts every unattributed Community Price row in ONE
// shared bucket, because two anonymous rows cannot be proved to be two people.
// A Pint Drop goes one step further and gives an unattributed row NO bucket at
// all: `authorityKey` is present only when the server derived it from a
// verified PUBMAXX User ID, and a drop without one is a visible provisional
// observation that never counts as an authority voice (AGENTS.md, migration
// 0117). Two drops from the same account therefore share one key and confirm
// nothing, which is exactly the rule this module has to keep.
//
// The WINDOW is not decided here either. `lib/priceTier.ts` is the one module
// that says how long a confirmation stands. What this module produces is the
// `ConfirmedPriceInput` that decider takes.
//
// The RECORD itself - what a confirmation is, and `confirmationIsLive` - lives
// in the leaf `lib/pintDropConfirmationRecord.ts`, so `lib/venues.ts` can read
// a confirmation in its price-authority lane without an import cycle. This
// module re-exports every one of those names, so it stays the one a reader
// reaches for and no importer had to move.

import type { Provenance } from "@/lib/curation";
import { agreesWithinTolerance, isWithinMaxAge } from "@/lib/communityPrice";
import {
  confirmationIsLive,
  type PintDropConfirmation,
} from "@/lib/pintDropConfirmationRecord";
import { type ConfirmedPriceInput } from "@/lib/priceTier";
import {
  confirmedPriceDrop,
  corroboratedPriceDrop,
  type SummaryDrop,
} from "@/lib/venues";

export {
  confirmationIsLive,
  isPintDropConfirmationBasis,
  PINT_DROP_CONFIRMATION_BASES,
} from "@/lib/pintDropConfirmationRecord";
export type {
  PintDropConfirmation,
  PintDropConfirmationBasis,
} from "@/lib/pintDropConfirmationRecord";

/** The minimum a row needs before this module can ask whether it is confirmed. */
export type ConfirmableDrop = SummaryDrop & {
  id: string;
  confirmation?: PintDropConfirmation | null;
};

/** Is this row a first-party priced observation rather than a seed or a note? */
function isPricedObservation(drop: ConfirmableDrop): boolean {
  return (
    (drop.provenance as Provenance) !== "demo" &&
    typeof drop.priceGbp === "number" &&
    Number.isFinite(drop.priceGbp)
  );
}

/**
 * The venue's live confirmation - the freshest one still inside the window.
 * Null when nobody has confirmed a price here, and null again once the last
 * confirmation ages out, which is what drops the standing back to grey without
 * deleting anything: the drop keeps its dated record, it just stops speaking
 * for tonight.
 */
export function liveConfirmationFor(
  drops: readonly ConfirmableDrop[],
  now: number = Date.now(),
): { confirmationId: string; confirmedAtMs: number } | null {
  let best: { confirmationId: string; confirmedAtMs: number } | null = null;
  for (const drop of drops) {
    const confirmation = drop.confirmation;
    if (!confirmation || !confirmationIsLive(confirmation, now)) continue;
    const confirmedAtMs = Date.parse(confirmation.confirmedAt);
    if (!best || confirmedAtMs > best.confirmedAtMs) {
      best = { confirmationId: confirmation.confirmationId, confirmedAtMs };
    }
  }
  return best;
}

/**
 * THE READ SEAM. What a venue's drop lane hands `priceStandingFor` for its
 * `confirmed` input: the price the live confirmation is about, and the day it
 * was confirmed. Null when nobody has confirmed a price here, and null again
 * once the confirmation ages out, so the pub falls through to whatever weaker
 * standing its own evidence supports rather than reading as an empty pub.
 *
 * It is a PROJECTION of `confirmedPriceDrop` (`lib/venues.ts`) and finds
 * nothing of its own, so the pub a standing calls Confirmed and the pub the map
 * paints from a confirmation are one pub by construction.
 *
 * Deliberately NOT a second decider: it reports evidence, and lib/priceTier.ts
 * decides what may be claimed from it.
 */
export function confirmedPriceInputFor(
  drops: readonly ConfirmableDrop[],
  now: number = Date.now(),
): ConfirmedPriceInput | null {
  const row = confirmedPriceDrop(drops, now);
  if (!row) return null;
  return {
    priceGbp: row.priceGbp as number,
    observedAt: (row.confirmation as PintDropConfirmation).confirmedAt,
  };
}

/**
 * The pair a second independent reporter has just completed, or null.
 *
 * `corroboratedPriceDrop` answers the first half: which in-window priced drop
 * at this pub is backed by the most distinct authority keys, and whether that
 * count reached the threshold. This adds the second half the Index needs - WHO
 * agreed - by picking the freshest in-window drop that carries a DIFFERENT
 * authority key and agrees within the shared tolerance.
 *
 * Null when the venue already holds a live confirmation: a third drinker
 * agreeing with a confirmed price is welcome evidence, not a second event, and
 * re-minting would move the day the pill prints without anything having
 * changed.
 */
export function findSecondReporterConfirmation(
  drops: readonly ConfirmableDrop[],
  now: number = Date.now(),
): { dropId: string; confirmingDropId: string } | null {
  if (liveConfirmationFor(drops, now)) return null;

  const confirmed = corroboratedPriceDrop(drops, now);
  if (!confirmed) return null;
  const confirmedKey = confirmed.authorityKey?.trim();
  const confirmedPrice = confirmed.priceGbp;
  if (!confirmedKey || typeof confirmedPrice !== "number") return null;

  let peer: ConfirmableDrop | null = null;
  for (const drop of drops) {
    if (drop.id === confirmed.id) continue;
    if (!isPricedObservation(drop)) continue;
    if (!isWithinMaxAge({ submittedAt: Date.parse(drop.createdAt) }, now)) continue;
    const key = drop.authorityKey?.trim();
    if (!key || key === confirmedKey) continue;
    if (!agreesWithinTolerance(confirmedPrice, drop.priceGbp as number)) continue;
    if (!peer || Date.parse(drop.createdAt) > Date.parse(peer.createdAt)) peer = drop;
  }

  return peer ? { dropId: confirmed.id, confirmingDropId: peer.id } : null;
}
