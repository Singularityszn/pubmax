import type { SocialAccessState } from "@/lib/socialAccess";

/** Registry env for the friends-only Social launch switch. */
export const SOCIAL_FRIENDS_LAUNCH_ENV = "PUBMAX_SOCIAL_FRIENDS_LAUNCH";
export const SOCIAL_ROLLBACK_ERROR = "Social is in preview right now.";
export const SOCIAL_ROLLBACK_CODE = "SOCIAL_PREVIEW";

export function isSocialFriendsLaunchEnabled(
  value: string | undefined,
): boolean {
  // Social is live by default. Keep an explicit 0 as an emergency rollback
  // while the first production window settles.
  return value !== "0";
}

/** Search indexing follows the same launch flag the nav already reads. */
export function socialDocumentRobots(friendsLaunchEnabled = true): {
  index: boolean;
  follow: boolean;
} {
  return friendsLaunchEnabled
    ? { index: true, follow: true }
    : { index: false, follow: true };
}

export function socialListedInSitemap(friendsLaunchEnabled = true): boolean {
  return friendsLaunchEnabled;
}

const SOCIAL_LAUNCH_NAV_LABEL = "Social";
const SOCIAL_PREVIEW_NAV_LABEL = "Social preview";

/** In-page headings, desktop nav and loading lines use the surface name. */
export function socialSurfaceName(friendsLaunchEnabled = true): string {
  return friendsLaunchEnabled
    ? SOCIAL_LAUNCH_NAV_LABEL
    : SOCIAL_PREVIEW_NAV_LABEL;
}

export function socialLoadingLabel(friendsLaunchEnabled = true): string {
  return `Loading ${socialSurfaceName(friendsLaunchEnabled)}`;
}

export type SocialBoundaryCopyState =
  | Exclude<SocialAccessState, "verified">
  | "unavailable";

/** Empty-state lines for SocialAccessBoundary — surface name follows the launch flag. */
export function socialBoundaryCopy(
  state: SocialBoundaryCopyState,
  friendsLaunchEnabled = true,
): string {
  const surface = socialSurfaceName(friendsLaunchEnabled);
  switch (state) {
    case "preview":
      return `${surface} is invite-only for now. It opens more widely soon.`;
    case "sign_in_required":
      return `Sign in to use ${surface}.`;
    case "age_verification_required":
      return `Adult check needed for ${surface}.`;
    case "suspended":
      return `${surface} access is suspended.`;
    case "unavailable":
      return `${surface} is unavailable right now.`;
  }
}

export function socialInviteMessage(friendsLaunchEnabled = true): string {
  return `Use ${socialSurfaceName(friendsLaunchEnabled)}.`;
}

export function adultSelfAssertionLine(friendsLaunchEnabled = true): string {
  return `${socialSurfaceName(friendsLaunchEnabled)} is for over-18s.`;
}

/** Body dataset written by root layout (`data-social-friends-launch`). */
export function readSocialFriendsLaunchFromDocument(): boolean {
  // A read that cannot answer fails OPEN, the same way an absent document
  // does: the body is not guaranteed to exist when a client component first
  // renders, and throwing here takes the whole surface down over an optional
  // flag.
  if (typeof document === "undefined") return true;
  return document.body?.dataset?.socialFriendsLaunch !== "0";
}

export function subscribeSocialFriendsLaunchFromDocument(): () => void {
  // The flag is env-driven and only changes on a full navigation after deploy.
  return () => {};
}

/**
 * The adult gate moved to `lib/adultGate.ts`, which imports no Social module.
 * These re-exports keep the existing callers working; reach for the gate module
 * directly in new code.
 */
export {
  ADULT_SELF_ASSERTION_ACTION,
  accountIsAdult,
  isAdultDateOfBirth,
  isRecordedAdultAssertion,
  needsAdultSelfAssertion,
} from "@/lib/adultGate";
export type { AccountAdultEvidence } from "@/lib/adultGate";
