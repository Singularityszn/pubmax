import type { ArrivalIntent } from "@/lib/arrivalWelcome";

/**
 * What /login says before the live session answers, and what a first-time
 * drinker sees after it does. "Welcome back" is only for a returning session
 * (the welcome-back card or the signed-in card). A cold first paint that
 * borrowed the sign-in door title told first-timers they had been here.
 */

export const LOGIN_FIRST_TIME_TITLE = "Sign in or create your account";
export const LOGIN_FIRST_TIME_LEAD =
  "Use your email, or pick a handle after the link lands.";

const LOGIN_SIGNED_IN_TITLE = "You are signed in";
const LOGIN_SIGNED_IN_LEAD =
  "Your account is ready. Jump back into the map, or sign out.";

const LOGIN_ADD_ACCOUNT_TITLE = "Add another account";
const LOGIN_ADD_ACCOUNT_LEAD =
  "Sign in to the other account. This device keeps both, and you can switch between them whenever you like.";

/** Supabase's persisted session. The PKCE verifier key is a different suffix. */
const SUPABASE_SESSION_STORAGE_KEY = /^sb-.+-auth-token$/;

/**
 * Whether this reader may already have a session, before the live client has
 * answered. The resume cookie is HttpOnly, so only the server can see it; a
 * provider callback landing (`_authCallback=1` with no `authError`) carries
 * the session in its fragment; the Supabase session lives in localStorage, so
 * only the browser can see that. Any one holds the email door back. A reader
 * with none gets the door on first paint.
 */
export function loginPageHasSessionHint({
  resumeCookie = null,
  authCallback = null,
  authError = null,
  storageKeys = [],
}: {
  resumeCookie?: string | null;
  authCallback?: string | null;
  authError?: string | null;
  storageKeys?: readonly string[];
} = {}): boolean {
  if (resumeCookie) return true;
  if (authCallback === "1" && authError !== "1") return true;
  return storageKeys.some((key) => SUPABASE_SESSION_STORAGE_KEY.test(key));
}

/**
 * Whether the sign-in card's shape stands in while the session resolves.
 *
 * A reader with no session hint gets the email door on first paint instead:
 * the skeleton was the whole wait, and the server can send the field. A hint
 * keeps the skeleton, so a signed-in reader does not see the form flash in
 * front of their card. A keyless build has no card to arrive, so the
 * not-configured notice is the whole answer there and a skeleton would
 * promise something that never comes.
 */
export function loginPageShowsSkeleton({
  sessionKnown,
  hasAuthSurface,
  hasSessionHint,
}: {
  sessionKnown: boolean;
  hasAuthSurface: boolean;
  hasSessionHint: boolean;
}): boolean {
  return !sessionKnown && hasAuthSurface && hasSessionHint;
}

/**
 * Which of the skeleton, the signed-in card and the email door /login paints,
 * and whether the head over them is settled. Adding an account is the ONE case
 * where a live session does not get the signed-in card: the person came here
 * to bring a second account onto this device. A hinted session still
 * resolving is read as live there, so the head over the already-painted form
 * does not change when it answers, and the hint never hides the form they
 * asked for. Everyone else with a hint keeps the skeleton until the session
 * answers. With no hint the form is the first paint, so its head is settled
 * too, and a session that then appears replaces the form with the card. A
 * welcome-back cookie is itself a hint, so that card still waits out the
 * resolve.
 */
export function loginPageGate({
  sessionKnown,
  signedIn,
  addAccount,
  sessionHinted,
  hasAuthSurface,
  returning,
}: {
  sessionKnown: boolean;
  signedIn: boolean;
  addAccount: boolean;
  sessionHinted: boolean;
  hasAuthSurface: boolean;
  /** A welcome-back card the reader has not dismissed for another account. */
  returning: boolean;
}): {
  adding: boolean;
  showSignedIn: boolean;
  headSessionKnown: boolean;
  showSkeleton: boolean;
  showForm: boolean;
} {
  const adding = addAccount && (signedIn || (!sessionKnown && sessionHinted));
  const showSignedIn = signedIn && !adding;
  const hasSessionHint = sessionHinted && !addAccount;
  const showSkeleton = loginPageShowsSkeleton({
    sessionKnown,
    hasAuthSurface,
    hasSessionHint,
  });
  return {
    adding,
    showSignedIn,
    headSessionKnown: sessionKnown || !hasSessionHint,
    showSkeleton,
    showForm:
      !showSignedIn &&
      hasAuthSurface &&
      !showSkeleton &&
      (!sessionKnown || !returning),
  };
}

export function loginPageHeadCopy({
  sessionKnown,
  adding,
  signedIn,
  returning,
  intent,
  door,
}: {
  sessionKnown: boolean;
  adding: boolean;
  signedIn: boolean;
  returning: boolean;
  intent: ArrivalIntent;
  door: { title: string; lead: string };
}): { title: string; lead: string } {
  if (adding) {
    return { title: LOGIN_ADD_ACCOUNT_TITLE, lead: LOGIN_ADD_ACCOUNT_LEAD };
  }
  if (signedIn) {
    return { title: LOGIN_SIGNED_IN_TITLE, lead: LOGIN_SIGNED_IN_LEAD };
  }
  if (!sessionKnown) {
    return { title: LOGIN_FIRST_TIME_TITLE, lead: LOGIN_FIRST_TIME_LEAD };
  }
  if (returning || intent === "signup") {
    return door;
  }
  return { title: LOGIN_FIRST_TIME_TITLE, lead: LOGIN_FIRST_TIME_LEAD };
}
