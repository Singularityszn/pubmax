import { londonCalendarDate } from "@/lib/privateIdentity";

/** Registry env for the friends-only Social launch switch. */
export const SOCIAL_FRIENDS_LAUNCH_ENV = "PUBMAX_SOCIAL_FRIENDS_LAUNCH";

export function isSocialFriendsLaunchEnabled(
  value: string | undefined,
): boolean {
  return value === "1";
}

/**
 * What the product may say when it asks the age question. One place, because
 * the prompt, the button and the refusal are read together and a second copy
 * of any of them would drift from the others.
 */
export const ADULT_SELF_ASSERTION_LINE = "Social is for over-18s.";
export const ADULT_SELF_ASSERTION_ACTION = "I'm 18 or over";

/** Self-asserted 18+ from onboarding date of birth (London calendar day). */
export function isAdultDateOfBirth(
  dateOfBirth: string,
  now: number = Date.now(),
): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return false;
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  const today = londonCalendarDate(now);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  let age = todayYear - birthYear;
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1;
  }
  return age >= 18;
}

/**
 * The two things an account may have said about its own age. Both are
 * optional, and BOTH being absent is a real third answer: nobody has asked yet.
 */
export type AccountAdultEvidence = {
  /** From the private identity row, when the account has one. */
  dateOfBirth?: string | null;
  /** When the account tapped "I'm 18 or over" (migration 0103). */
  adultSelfAssertedAt?: string | null;
};

/** A recorded assertion is a real instant somebody tapped, or it is nothing. */
export function isRecordedAdultAssertion(
  assertedAt: string | null | undefined,
): boolean {
  if (typeof assertedAt !== "string") return false;
  const stamp = assertedAt.trim();
  return stamp !== "" && Number.isFinite(Date.parse(stamp));
}

/**
 * THE ONE adult gate. Captain decision 2026-08-10: an account that says it is
 * 18 or over is taken at its word, so a recorded self-assertion passes.
 *
 * A stored date of birth still DECIDES when there is one, in both directions:
 * an assertion may answer the age question when nobody has answered it, and it
 * may never overturn an answer the account already gave. Otherwise a person who
 * told us they were 15 could tap their way past their own answer.
 */
export function accountIsAdult(
  evidence: AccountAdultEvidence,
  now: number = Date.now(),
): boolean {
  const dateOfBirth = evidence.dateOfBirth?.trim() ?? "";
  if (dateOfBirth) return isAdultDateOfBirth(dateOfBirth, now);
  return isRecordedAdultAssertion(evidence.adultSelfAssertedAt);
}

/**
 * Whether the one-tap prompt is the way through for this account. False once
 * either answer exists, so an account whose stored date of birth says under 18
 * is never offered a tap that would not be honoured, and an account that
 * already tapped is never asked twice.
 */
export function needsAdultSelfAssertion(
  evidence: AccountAdultEvidence,
): boolean {
  const dateOfBirth = evidence.dateOfBirth?.trim() ?? "";
  return !dateOfBirth && !isRecordedAdultAssertion(evidence.adultSelfAssertedAt);
}
