/**
 * WHAT A CONTRIBUTION GATE MAY SAY, IN ONE PLACE. Pure leaf: it imports
 * nothing, so a browser bundle that needs the vocabulary never pulls the
 * identity stores in behind it, and `lib/contributionIdentity.server.ts`
 * re-exports every name rather than restating the list.
 *
 * ONE RULE (captain, 5 Sep 2026). Contributing asks two questions and they are
 * two findings with two ways through: a public handle names the contribution,
 * and the account has to have answered the age question at all. They used to
 * be merged, so an account that had claimed a handle was told to "add your
 * date of birth" on a claim surface that stores none, and the price path was a
 * door with nothing behind it. The age answer is the 10 Aug rule's: a stored
 * date of birth, or the recorded one tap.
 */

export const CONTRIBUTION_GATE_STATUSES = [
  "sign_in_required",
  "onboarding_required",
  "adult_check_required",
] as const;

export type ContributionGateStatus =
  (typeof CONTRIBUTION_GATE_STATUSES)[number];

/** The one sentence each refusal spends, so no surface writes a second copy. */
export const CONTRIBUTION_HANDLE_REFUSAL =
  "Choose a public handle before contributing.";
export const CONTRIBUTION_ADULT_REFUSAL =
  "Confirm you are 18 or over before contributing.";

/** A status a route really answered with, or nothing. Unknown text is NOT a
 *  status: a surface that guessed one would offer a way through the server
 *  never named. */
export function readContributionGateStatus(
  value: unknown,
): ContributionGateStatus | undefined {
  return typeof value === "string" &&
    (CONTRIBUTION_GATE_STATUSES as readonly string[]).includes(value)
    ? (value as ContributionGateStatus)
    : undefined;
}
