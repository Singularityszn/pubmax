import { londonCalendarDate } from "@/lib/privateIdentity";

/** Registry env for the friends-only Social launch switch. */
export const SOCIAL_FRIENDS_LAUNCH_ENV = "PUBMAX_SOCIAL_FRIENDS_LAUNCH";

export function isSocialFriendsLaunchEnabled(
  value: string | undefined,
): boolean {
  return value === "1";
}

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
