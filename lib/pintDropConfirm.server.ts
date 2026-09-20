import "server-only";

// The PRODUCER behind a green trust pill.
//
// `lib/pintDropConfirmation.ts` says what confirms a Pint Drop.
// `lib/pintIndex.ts` says what a confirmation has to carry before the Index may
// cite it. This module is the one place a confirmation is MINTED and written,
// so there is a single answer to "who confirmed this, and when".
//
// Two ways in, and no third. A SECOND INDEPENDENT REPORTER completes the pair
// the map already trusts, and the pass runs after a drop lands. A MODERATOR
// confirms one drop from the review queue, which is a person's decision about
// evidence they looked at rather than a derivation, so it names no peer.
//
// Nothing here fails a Pint Drop. A drop is a drinker's own account of what
// they paid; a confirmation is the app's reading of two such accounts. When the
// reading cannot be taken, the drop still stands and the pill stays grey.

import { randomUUID } from "crypto";

import { log } from "@/lib/log";
import {
  outcomeForUnmintedReading,
  readSecondReporter,
  type PintDropConfirmation,
} from "@/lib/pintDropConfirmation";
import type { PintDropConfirmationOutcome } from "@/lib/pintDropSecondDrinker";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { pintTrustFor, type PintTrustState } from "@/lib/pintTrust";

function mint(
  basis: PintDropConfirmation["basis"],
  now: number,
  confirmingDropId?: string,
): PintDropConfirmation {
  return {
    confirmationId: randomUUID(),
    confirmedAt: new Date(now).toISOString(),
    basis,
    ...(confirmingDropId ? { confirmingDropId } : {}),
  };
}

/**
 * Run the second-reporter pass over one venue's drop lane and NAME what it
 * found (`lib/pintDropSecondDrinker.ts` owns the vocabulary).
 *
 * The write is the same one it always was: a pair completed by a second
 * independent authority key is minted once, both rows carrying the SAME
 * confirmation id, because one agreement between two reporters is one event.
 * What is new is the answer for every pass that mints nothing, so a drinker
 * who has just repeated their own report is told so rather than shown a line
 * asking for a second drinker they cannot be.
 *
 * `same_reporter` is a sentence ABOUT THE CALLER, so the caller's own authority
 * key is passed in and nothing else can name that outcome (battle test D08).
 * Without it the reading was venue-wide: Alice's £6.50 at a pub where Bob had
 * twice logged £5.20 came back "That matches your own earlier report", which
 * was a claim about somebody else's rows made to her face.
 *
 * Idempotent by construction: a retry after a mint reads the live confirmation
 * and answers `already_confirmed` with the record on file, never a second id.
 * NEVER throws: the caller is a create path, and a confirmation that could not
 * be taken is a fact about us, not about the price, so the answer is
 * `unavailable` and the drop stands.
 */
export async function runSecondReporterPass(
  venueId: string,
  now: number = Date.now(),
  callerAuthorityKey?: string | null,
): Promise<PintDropConfirmationOutcome> {
  try {
    const store = pintDropsStore();
    const candidates = await store.listConfirmationCandidates(venueId);
    const reading = readSecondReporter(candidates, now, callerAuthorityKey);
    if (reading.kind !== "pair") return outcomeForUnmintedReading(reading);
    const confirmation = mint("second_reporter", now, reading.confirmingDropId);
    // Both drops carry the SAME confirmation id on purpose: one agreement
    // between two reporters is one event, and either row can answer a citation
    // of it. The store writes them together or not at all.
    const dropIds = [reading.dropId, reading.confirmingDropId];
    const wrote = await store.confirm(dropIds, confirmation, now);
    if (!wrote) return { status: "unavailable" };
    log("info", "pint_drop.confirmed", {
      basis: confirmation.basis,
      confirmationId: confirmation.confirmationId,
    });
    return { status: "confirmed", confirmation, dropIds };
  } catch (err) {
    log("warn", "pint_drop.confirm_failed", {
      basis: "second_reporter",
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "unavailable" };
  }
}

/**
 * The pass as a producer alone: the confirmation when THIS call minted one,
 * and null otherwise. Kept for the callers that only need the record.
 */
export async function confirmVenueBySecondReporter(
  venueId: string,
  now: number = Date.now(),
  callerAuthorityKey?: string | null,
): Promise<PintDropConfirmation | null> {
  const outcome = await runSecondReporterPass(venueId, now, callerAuthorityKey);
  return outcome.status === "confirmed" ? outcome.confirmation : null;
}

/**
 * A moderator's own confirmation of one drop from the review queue. Throws on a
 * storage failure, because unlike the create-path pass this IS the request the
 * moderator made and a silent no-op would read as a decision that landed.
 * Returns null when the drop is unknown or already carries a live confirmation.
 */
export async function confirmPintDropByModerator(
  id: string,
  now: number = Date.now(),
): Promise<PintDropConfirmation | null> {
  const confirmation = mint("moderator", now);
  const wrote = await pintDropsStore().confirm([id], confirmation, now);
  if (!wrote) return null;
  log("info", "pint_drop.confirmed", {
    basis: confirmation.basis,
    confirmationId: confirmation.confirmationId,
  });
  return confirmation;
}

/**
 * The venue's whole pint TRUST STATE, or null when the reading could not be
 * taken. Battle test D07.
 *
 * The mission receipt used to word itself from `community_prices`
 * corroborations while the sheet's head, chip and drop row wore the Pint Drop
 * lane's own state, and over one pub the two disagreed: the receipt printed
 * "Price is trusted now." above a head reading "Logged once, needs a second
 * drinker", because a seeded community row from a second actor is not a second
 * PINT DROP carrying an authority key. Two lanes, two readings, and the receipt
 * took the stronger word.
 *
 * There is one reading of that story and it is `pintTrustFor`. This is the
 * server seam onto it, so a browser holding no drops - `/near`'s mission slot
 * holds none at all - can still be told what the pub's trust state became.
 *
 * Null is honest and is NOT "no trust": a caller that cannot read the state
 * must decline to claim one rather than fall back to a weaker lane's word.
 * Never throws, for the reason the pass does not: this rides a create path.
 */
export async function readVenuePintTrust(
  venueId: string,
  now: number = Date.now(),
): Promise<PintTrustState | null> {
  try {
    const candidates = await pintDropsStore().listConfirmationCandidates(venueId);
    return pintTrustFor(candidates, now).state;
  } catch (err) {
    log("warn", "pint_drop.trust_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
