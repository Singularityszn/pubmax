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

/**
 * The durable resume cookie (`AUTH_RESUME_COOKIE` in lib/authSessionResume.ts).
 * Restated here so this leaf, which the login page ships to the browser, does
 * not pull that module's Buffer codec into the client bundle.
 */
const LOGIN_SESSION_HINT_COOKIE = "pubmax_session_resume";

/** Supabase's persisted session. The PKCE verifier key is a different suffix. */
const SUPABASE_SESSION_STORAGE_KEY = /^sb-.+-auth-token$/;

/**
 * Whether this reader may already have a session, before the live client has
 * answered. The resume cookie is HttpOnly, so only the server can see it; the
 * Supabase session lives in localStorage, so only the browser can see that.
 * Either one holds the email door back. A reader with neither gets the door
 * on first paint.
 */
export function loginPageHasSessionHint({
  cookieHeader,
  storageKeys,
}: {
  cookieHeader?: string | null;
  storageKeys?: readonly string[] | null;
} = {}): boolean {
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() !== LOGIN_SESSION_HINT_COOKIE) continue;
      if (part.slice(eq + 1).trim()) return true;
    }
  }
  for (const key of storageKeys ?? []) {
    if (SUPABASE_SESSION_STORAGE_KEY.test(key)) return true;
  }
  return false;
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
