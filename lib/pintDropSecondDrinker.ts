// Browser-safe LEAF. The second drinker's door and what the server says back.
//
// A lone public Pint Drop prints "Logged once, needs a second drinker"
// (`PROVISIONAL_PRICE_LINE`, lib/venuePriceLane.ts). This module owns the ONE
// action that line offers and the ONE answer the write path gives it:
//
//   - the CTA's words ("Still £4.50?") and the figure it seeds the composer
//     with, so the door the landing opens (#1462) and the door the venue sheet
//     opens spell the same promise the same way;
//   - the closed outcome vocabulary a priced write answers with, so a drinker
//     whose report matched their OWN earlier report is told so plainly rather
//     than left reading "needs a second drinker" over a figure they just sent.
//
// Nothing here decides independence. `lib/pintDropConfirmation.ts` reads the
// pair and `lib/pintDropConfirm.server.ts` mints; this module names the result.
// Nothing here derives a figure either: the seed is the figure the pub's lane
// already prints, handed through unchanged.

import { formatGbp } from "@/lib/formatGbp";
import type { PintDropConfirmation } from "@/lib/pintDropConfirmationRecord";
import type { PintTrustState } from "@/lib/pintTrust";

/**
 * The trust states (lib/pintTrust.ts) a pub is in when it is owed a second
 * drinker: one in-window report, two or more in-window reports that DISAGREE,
 * or every report past the window. CLOSED, and read off the ONE trust reading
 * rather than off a lane branch, so the door mounts against the same state the
 * chip's `data-pint-trust` carries and the two cannot disagree. `confirmed` and
 * `corroborated` already have their second drinker; `none` has nothing to
 * confirm.
 *
 * `disputed` is here because a split pub is owed a second drinker MORE than a
 * logged-once one, not less: two people have reported and neither has been
 * matched. What differs is the question. A logged-once pub is asked "Still
 * £4.50?"; a split pub is asked "Which did you pay?" over each recorded figure
 * (`OVERVIEW_PRICE_DOOR_KIND`, lib/pintTrust.ts), because naming one of two
 * answers would call the other a correction.
 */
export const SECOND_DRINKER_STATES = [
  "logged-once",
  "disputed",
  "aged-out",
] as const satisfies readonly PintTrustState[];

export function secondDrinkerDoorOffered(state: PintTrustState | null | undefined): boolean {
  return state !== null && state !== undefined && (SECOND_DRINKER_STATES as readonly string[]).includes(state);
}

/** The figure as the composer's own price field spells it, or null. */
export function confirmPintPriceSeed(priceGbp: number | null | undefined): string | null {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) {
    return null;
  }
  return priceGbp.toFixed(2);
}

/** The one action a logged-once price offers: "Still £4.50?". */
export function confirmPintActionLabel(priceGbp: number): string {
  return `Still ${formatGbp(priceGbp)}?`;
}

/**
 * The accessible name behind that label, naming the pub, because a screen
 * reader hears the button without the price line above it.
 */
export function confirmPintActionName(priceGbp: number, venueName: string): string {
  return `Confirm ${formatGbp(priceGbp)} a pint at ${venueName}`;
}

/**
 * What the second-reporter pass found after a priced write. CLOSED.
 *
 *  - `confirmed`: this write completed the pair and a confirmation was minted.
 *  - `already_confirmed`: the pub already held a live confirmation, so this
 *    write changed nothing about its standing (a retry lands here).
 *  - `same_reporter`: the figure agrees with an earlier report, but every
 *    agreeing report carries one authority key, so nothing was confirmed.
 *  - `awaiting_second_drinker`: no independent agreement yet.
 *  - `unavailable`: the pass could not read or write; the drop still stands.
 */
export type PintDropConfirmationOutcome =
  | { status: "confirmed"; confirmation: PintDropConfirmation; dropIds: string[] }
  | { status: "already_confirmed"; confirmation: PintDropConfirmation }
  | { status: "same_reporter" }
  | { status: "awaiting_second_drinker" }
  | { status: "unavailable" };

export const PINT_DROP_CONFIRMATION_OUTCOMES = [
  "confirmed",
  "already_confirmed",
  "same_reporter",
  "awaiting_second_drinker",
  "unavailable",
] as const;

function isConfirmationRecord(value: unknown): value is PintDropConfirmation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.confirmationId === "string" &&
    record.confirmationId.length > 0 &&
    typeof record.confirmedAt === "string" &&
    Number.isFinite(Date.parse(record.confirmedAt)) &&
    (record.basis === "second_reporter" || record.basis === "moderator")
  );
}

/**
 * Read an outcome off a response body. A body that carries none, or one this
 * vocabulary does not know, answers null: the drop landed either way, and a
 * missing outcome is not a refusal.
 */
export function parseConfirmationOutcome(value: unknown): PintDropConfirmationOutcome | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.status) {
    case "confirmed": {
      if (!isConfirmationRecord(record.confirmation)) return null;
      const dropIds = Array.isArray(record.dropIds)
        ? record.dropIds.filter((id): id is string => typeof id === "string")
        : [];
      return { status: "confirmed", confirmation: record.confirmation, dropIds };
    }
    case "already_confirmed":
      return isConfirmationRecord(record.confirmation)
        ? { status: "already_confirmed", confirmation: record.confirmation }
        : null;
    case "same_reporter":
    case "awaiting_second_drinker":
    case "unavailable":
      return { status: record.status };
    default:
      return null;
  }
}

/**
 * The one sentence the composer adds to its receipt. Null where the receipt
 * already says everything ("Your Pint Drop is live" is the whole truth of an
 * awaiting or unreadable pass, and inventing a standing there would be a
 * claim about the pub nobody made).
 */
export function confirmationOutcomeLine(
  outcome: PintDropConfirmationOutcome | null,
  priceGbp: number | null,
): string | null {
  if (!outcome) return null;
  const figure =
    typeof priceGbp === "number" && Number.isFinite(priceGbp)
      ? formatGbp(priceGbp)
      : "this price";
  switch (outcome.status) {
    case "confirmed":
      return `Two drinkers now agree on ${figure}. Confirmed.`;
    case "already_confirmed":
      return `${figure} was already confirmed here.`;
    case "same_reporter":
      return "That matches your own earlier report, so it still needs a second drinker.";
    default:
      return null;
  }
}
