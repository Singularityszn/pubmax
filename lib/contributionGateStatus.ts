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
 *
 * ONE EXCEPTION, AND A REFUSAL SAYS WHICH BRANCH IT TOOK (5 Sep 2026). The age
 * question used to be asked as `needsAdultSelfAssertion` ALONE, which is true
 * only when NOBODY has answered, so an account whose stored date of birth said
 * 2012 was admitted: it had answered, and no door read the answer. The pub
 * photo wall on the neighbouring surface asked `accountIsAdult` and refused the
 * same account, so one product answered the alcohol-age question two ways. The
 * rule is now one rule with one exception: a stored date of birth that says
 * under 18 is refused at EVERY contribution door, and otherwise the recorded
 * tap admits at every door.
 *
 * That is TWO refusals, not one, because they differ in what the reader can do
 * next: a tap is the way through the first and there is no way through the
 * second, and offering a tap that would not be honoured is the door with
 * nothing behind it this entry already refuses. `contributionAdultRefusal` is
 * the ONE place the branch is chosen, so the sentence a reader gets always
 * describes the check the code performed.
 */

export const CONTRIBUTION_GATE_STATUSES = [
  "sign_in_required",
  "onboarding_required",
  "adult_check_required",
  "adult_check_failed",
] as const;

export type ContributionGateStatus =
  (typeof CONTRIBUTION_GATE_STATUSES)[number];

/** The one sentence each refusal spends, so no surface writes a second copy. */
export const CONTRIBUTION_HANDLE_REFUSAL =
  "Choose a public handle before contributing.";
export const CONTRIBUTION_ADULT_REFUSAL =
  "Confirm you are 18 or over before contributing.";
/**
 * The account HAS answered, and the answer was under 18. There is no tap behind
 * this one, so the sentence offers none: it names the answer on file, which is
 * the only thing the reader could change and the exact check the code ran.
 */
export const CONTRIBUTION_UNDER_18_REFUSAL =
  "The date of birth on your account is under 18, so contributing is not open to you.";

/** The two age refusals, chosen once. */
export type ContributionAdultRefusal = {
  status: Extract<
    ContributionGateStatus,
    "adult_check_required" | "adult_check_failed"
  >;
  error: string;
};

/**
 * WHICH AGE REFUSAL A DOOR SPENDS, decided in one place so no door can word an
 * answer it did not reach. Both booleans come from `lib/socialLaunch.ts`, which
 * stays the ONE adult gate: `accountIsAdult` judges the age and
 * `needsAdultSelfAssertion` says whether a tap is the ACTUAL thing in the way.
 * This leaf takes the two answers rather than the evidence, because it imports
 * nothing and must keep importing nothing.
 */
export function contributionAdultRefusal(answers: {
  isAdult: boolean;
  needsSelfAssertion: boolean;
}): ContributionAdultRefusal | null {
  if (answers.isAdult) return null;
  return answers.needsSelfAssertion
    ? { status: "adult_check_required", error: CONTRIBUTION_ADULT_REFUSAL }
    : { status: "adult_check_failed", error: CONTRIBUTION_UNDER_18_REFUSAL };
}

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

/** The three gates a READ of your own record answers as data at 200. */
export type ContributionDoorStatus = Extract<
  ContributionGateStatus,
  "adult_check_required" | "adult_check_failed" | "onboarding_required"
>;

/**
 * The door a 200 read of the caller's own record is standing at, or nothing.
 * `lib/contributionReadRefusal.server.ts` answers a gated read as
 * `{ status, error }` at 200 so the browser logs no error for a list a new
 * account has no way to hold yet. A surface that reads such a body asks this
 * before it reads the list, and shows its door where the list would be.
 */
export function readContributionDoor(body: unknown): ContributionDoorStatus | undefined {
  const status = readContributionGateStatus(
    body && typeof body === "object" ? (body as { status?: unknown }).status : undefined,
  );
  return status === "adult_check_required" ||
    status === "adult_check_failed" ||
    status === "onboarding_required"
    ? status
    : undefined;
}

/**
 * Fired on `window` once the one tap is recorded, by whichever door took it.
 * "We ask once" is a promise about the whole page: a profile shows a door for
 * Wanted, another for the diary and another for Step Out, each reading its own
 * list, and a tap on one of them has to dissolve the rest rather than leave two
 * doors asking a question that was just answered.
 */
export const ADULT_ASSERTED_EVENT = "pubmax:adult-asserted";
