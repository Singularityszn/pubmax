// Browser-safe LEAF. What a minted Pint Drop confirmation IS, and when it is
// still live. Nothing else lives here.
//
// `lib/pintDropConfirmation.ts` remains the module a reader reaches for: it
// owns the confirmation POLICY and re-exports everything below, so no importer
// had to move. This file exists only so `lib/venues.ts` can ask the ONE
// liveness question without an import cycle, because the price-authority lane
// in that module now reads a confirmation rather than re-deriving one.
//
// The house rule this follows is AGENTS.md's: "A fact several modules need
// lives in ONE leaf module", the same shape `lib/handleNormalize.ts` has.
//
// The WINDOW is not decided here. `lib/priceTier.ts` is the one module that
// says how long a confirmation stands, so this reads CONFIRMED_MAX_AGE_DAYS
// off it rather than restating 30 days.

import { DAY_MS } from "@/lib/dayMs";
import { CONFIRMED_MAX_AGE_DAYS } from "@/lib/priceTier";

/** How a confirmation came about. Closed: nothing else may mint one. */
export const PINT_DROP_CONFIRMATION_BASES = ["second_reporter", "moderator"] as const;
export type PintDropConfirmationBasis = (typeof PINT_DROP_CONFIRMATION_BASES)[number];

const BASIS_SET: ReadonlySet<string> = new Set(PINT_DROP_CONFIRMATION_BASES);

export function isPintDropConfirmationBasis(
  value: unknown,
): value is PintDropConfirmationBasis {
  return typeof value === "string" && BASIS_SET.has(value);
}

/**
 * The minted record. `confirmationId` is the handle the Pint Index cites, so it
 * is stored rather than derived: a citation nobody can look up is not evidence.
 */
export type PintDropConfirmation = {
  confirmationId: string;
  /** ISO instant the confirmation was minted (server clock, never a client's). */
  confirmedAt: string;
  basis: PintDropConfirmationBasis;
  /**
   * The peer drop that agreed. Present on `second_reporter` only - a moderator
   * confirmation is one person's decision and names no second reporter.
   */
  confirmingDropId?: string;
};

/**
 * Is this confirmation still inside the window that keeps a standing green?
 * The window belongs to lib/priceTier.ts; a confirmation dated in the future is
 * a bad row rather than a fresh one, exactly as that module reads it.
 */
export function confirmationIsLive(
  confirmation: PintDropConfirmation | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!confirmation) return false;
  const at = Date.parse(confirmation.confirmedAt);
  if (!Number.isFinite(at)) return false;
  const ageDays = (now - at) / DAY_MS;
  return ageDays >= 0 && ageDays <= CONFIRMED_MAX_AGE_DAYS;
}
