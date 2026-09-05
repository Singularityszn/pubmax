// A contribution outlives the account that made it, and the name does not.
//
// Captain, 5 September 2026: "We keep the prices, but we remember these
// accounts and what they have logged in." Verification scout verify-preview-4
// (section 13) found the half that was missing: a throwaway account deleted
// itself, its Pint Drops stayed on the map, and both were still printed under
// the retired handle, one of them leading the Blackfriar sheet.
//
// This module is the whole of the reading rule and it is a PURE LEAF, so a
// bundle that needs the label pulls no store behind it. Migration 0150 owns the
// writing half: the tombstone trigger stamps `author_retired_at` on every lane
// that prints a contributor handle to a stranger, and each lane's ONE public
// projection asks the question here.
//
// THREE rules.
//
// (1) A RETIREMENT IS A NAMING CHANGE AND NOTHING ELSE. The price, the measure,
//     the date, the venue and the authority key all stay exactly as they were,
//     so a lone drop from a departed account keeps whatever trust state the
//     rules already give it and a confirmed pair stays confirmed. Nothing in
//     `lib/venues.ts`, `lib/pintTrust.ts` or `lib/priceTier.ts` may read this
//     answer: a figure is worth what its evidence says, not what became of the
//     person who logged it.
//
// (2) IT SPENDS THE VOCABULARY WE ALREADY HAVE. `ANON_HANDLE_LABEL` is the
//     withheld-handle label an `anonymous` Pint Drop has always worn, and a
//     retired author reads the same way to the same reader for the same reason:
//     the observation is public, the identity is not. A second label would be a
//     second vocabulary for one idea, and the two would drift.
//
// (3) A MODERATOR STILL SEES THE HANDLE. Withholding is a PUBLIC projection
//     rule, exactly as it is for an anonymous drop: the row keeps its handle,
//     the moderator DTO keeps its handle, and the ledger remembers both. Taking
//     a bad price down still needs to know whose it was.

import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";

/**
 * The label a public surface prints where a retired handle used to be.
 *
 * Deliberately the anonymous drop's own label rather than a new string: see
 * rule (2) above.
 */
export const RETIRED_CONTRIBUTOR_LABEL = ANON_HANDLE_LABEL;

/**
 * Has the account behind this contribution left?
 *
 * Absent, null and an empty string all read as a live author, which is what
 * every row written before migration 0150 is.
 */
export function contributorHasRetired(
  authorRetiredAt: string | null | undefined,
): boolean {
  return typeof authorRetiredAt === "string" && authorRetiredAt.trim() !== "";
}

/**
 * The handle a public surface may print for one contribution.
 *
 * The ONE substitution, shared by every lane, so the venue sheet, the permalink
 * and the landing strip cannot disagree about what a departed drinker is
 * called.
 */
export function publicContributorHandle(
  handle: string,
  authorRetiredAt: string | null | undefined,
): string {
  return contributorHasRetired(authorRetiredAt) ? RETIRED_CONTRIBUTOR_LABEL : handle;
}

/**
 * The stamp as it comes off a database row: a timestamp string, or undefined
 * when the column is absent (a cluster without 0150) or null (a live author).
 *
 * Undefined rather than null, so the field stays cleanly optional on the shapes
 * that carry it, the way `measure` and `authorityKey` already do.
 */
export function authorRetiredAtFromRow(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
