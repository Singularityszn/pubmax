// Create-password prompt gate.
//
// The machinery to CREATE a password already existed and was correct, but it
// was mounted in exactly one place: the account hub's settings grid. So the
// only people who ever met it were the people who went looking for it, and an
// account signing in by email link had nothing telling it a handle sign-in was
// available at all. This module is the ask, and nothing else — it owns when the
// ask is owed, the words it uses, and the one durable marker that spends it.
//
// THREE RULES.
//
// (1) It asks ONCE per account, and the marker is keyed by ACCOUNT ID rather
//     than being a bare device flag. A device may hold several accounts
//     (lib/deviceAccountSessions.ts), so a device-wide flag would let the first
//     account's answer speak for the second, which has never been asked. This
//     key is deliberately OUTSIDE DEVICE_IDENTITY_LOCAL_KEYS for the same
//     reason that module is: every entry NAMES the account it is about, nothing
//     reads "who is signed in" from it, and dropping the set on an account
//     change would only re-ask people who have already answered.
//
// (2) The answer is TRI-STATE, and only `false` may be acted on. `null` means
//     `public.account_has_password` could not answer, and telling an owner who
//     HAS a password to create one is the exact defect the tri-state exists to
//     prevent. A read that could not run offers nothing.
//
// (3) It is only offered when a password is the ACTUAL thing in the way. A
//     password signs you in BY HANDLE, so an account with no claimed handle has
//     nothing to sign in as yet, and an ask it could not act on reads as broken.
//     Same shape as the adult self-assertion gate.
//
// Creating the password is NOT this module's job and never becomes it. The one
// place a password is set is components/auth/SetAccountPassword.tsx, bound to
// the caller's own GoTrue session; the prompt sends people there.

import { safeLocalStorage } from "@/lib/safeStorage";

/** Prompt-budget id, so this ask cannot stack on another interruption. */
export const PASSWORD_PROMPT_SURFACE = "create-password";

/** Same-tab notify: a localStorage write raises no `storage` event here. */
export const PASSWORD_PROMPT_EVENT = "pubmax:create-password-prompt";

const ANSWERED_KEY_PREFIX = "pubmax:create-password-prompt:answered:v1:";

/**
 * Where the ask sends someone. The account hub already renders the create form
 * with a brass `accountHubPasswordOwed` border when a password is owed, so the
 * settings heading is a real destination rather than a dead drop.
 */
export const PASSWORD_PROMPT_DESTINATION = "/u/you#account-settings-title";

export const PASSWORD_PROMPT_TITLE = "Add a password?";
export const PASSWORD_PROMPT_BODY =
  "You sign in with an email link. A password lets you sign in with your handle instead.";
/** Honest, because the ask is spent either way: this is not "not yet". */
export const PASSWORD_PROMPT_DECLINE_LABEL = "No thanks";
export const PASSWORD_PROMPT_ACCEPT_LABEL = "Add one";

/** One marker per account, so a second account on a device meets its own ask. */
export function passwordPromptAnsweredKey(accountId: string): string {
  return `${ANSWERED_KEY_PREFIX}${accountId}`;
}

export type PasswordPromptInputs = {
  /** Whether browser auth is configured on this build at all. */
  configured: boolean;
  /** The signed-in account, or null while nobody is signed in. */
  accountId: string | null;
  /** False while the live session has not answered yet. */
  identityResolved: boolean;
  /** The account's claimed handle, or null for an account without one. */
  handle: string | null;
  /** Tri-state: true has one, false has none, null could not be read. */
  hasPassword: boolean | null;
  /** Whether this account has already answered the ask on this device. */
  answered: boolean;
};

/**
 * The whole decision, kept pure so the rules can be read and tested without a
 * browser. Every refusal is its own line on purpose: each one is a rule above.
 */
export function shouldOfferPasswordPrompt(input: PasswordPromptInputs): boolean {
  if (!input.configured) return false;
  if (!input.accountId) return false;
  // Never speak before the live session has: identity is tri-state everywhere.
  if (!input.identityResolved) return false;
  // A password signs you in by handle, so it is owed nothing without one.
  if (!input.handle) return false;
  // Rule 2: only an answered `false` may be acted on. `null` offers nothing.
  if (input.hasPassword !== false) return false;
  if (input.answered) return false;
  return true;
}

function notify(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(PASSWORD_PROMPT_EVENT));
  } catch {
    // Storage stays authoritative.
  }
}

/** A read that cannot run answers "not answered", so the ask is still owed. */
export function readPasswordPromptAnswered(accountId: string | null): boolean {
  if (!accountId) return false;
  const storage = safeLocalStorage();
  if (!storage) return false;
  try {
    return storage.getItem(passwordPromptAnsweredKey(accountId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Spend the ask for this account. BOTH buttons call it: "Add one" hands the
 * person to the form, and asking a second time somebody who already said yes
 * and then walked away is the nagging this one-shot discipline exists to stop.
 * The form itself stays in the account hub, flagged, for as long as it is owed.
 */
export function markPasswordPromptAnswered(accountId: string | null): void {
  if (!accountId) return;
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(passwordPromptAnsweredKey(accountId), "1");
  } catch {
    // Private mode: the ask simply does not persist, and the budget still caps
    // it at one interruption a session.
  }
  notify();
}

export function subscribePasswordPrompt(
  onStoreChange: () => void,
  accountId: string | null = null,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const sameTabHandler = () => onStoreChange();
  const storageHandler = (event: StorageEvent) => {
    if (!accountId || event.key !== passwordPromptAnsweredKey(accountId)) return;
    onStoreChange();
  };
  window.addEventListener(PASSWORD_PROMPT_EVENT, sameTabHandler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(PASSWORD_PROMPT_EVENT, sameTabHandler);
    window.removeEventListener("storage", storageHandler);
  };
}
