// What deleting a PUBMAXX account means, in ONE place.
//
// The deletion itself is a single row: `auth.users`. Migration `0078` installs a
// BEFORE DELETE trigger on that table, and `0096`, `0097`, `0098` and `0102`
// extend it, so removing the sign-in already stamps the profile tombstone, drops
// every owned image and its bytes, clears the private card fields and takes the
// photos out of message threads. Nothing here re-implements any of that.
//
// This module owns the WORDS, because a person deleting an account is owed an
// accurate account of what happens, and a second copy of that list would drift
// away from the trigger it describes. Every line below is a statement the SQL
// above actually makes true.

/** What the delete takes away. Each line is one thing the `0078` trigger drops. */
export const ACCOUNT_DELETION_LEAVES: readonly string[] = [
  "Your sign-in. You will not be able to sign in with it again.",
  "Your profile photo, your cover photos and the photos you added to pub walls.",
  "The photos you sent in messages. The words you sent stay in the thread.",
  "The private details on your card: favourite drink, interests and workplace.",
];

/** What the delete keeps, and why. Each line is a deliberate design decision. */
export const ACCOUNT_DELETION_STAYS: readonly string[] = [
  "Your handle stays reserved, so nobody else can take it.",
  "The prices you logged stay on the map, attributed to that handle.",
  "A founding member number stays yours. It is never given to anybody else.",
];

/** The heading over the whole control, signed in. */
export const ACCOUNT_DELETION_TITLE = "Delete your account";

/** One line under the heading, before the reader opens the confirm step. */
export const ACCOUNT_DELETION_LEDE =
  "This removes your sign-in from PUBMAXX. It cannot be undone.";

/** The control that opens the confirm step. */
export const ACCOUNT_DELETION_OPEN_LABEL = "Delete account";

/** The control that performs the delete. */
export const ACCOUNT_DELETION_CONFIRM_LABEL = "Delete my account";

/** The way back out of the confirm step. */
export const ACCOUNT_DELETION_CANCEL_LABEL = "Keep my account";

/** Said while the request is in flight. */
export const ACCOUNT_DELETION_BUSY_LINE = "Deleting your account.";

/** Said once the account is gone, before the sign-out lands. */
export const ACCOUNT_DELETION_DONE_LINE =
  "Your account is deleted. Signing you out of this device.";

/** Said when the request could not be sent or the server could not answer. */
export const ACCOUNT_DELETION_FAILED_LINE =
  "Your account could not be deleted. Try again.";

/** Said when the browser session went away before the request could be signed. */
export const ACCOUNT_DELETION_SESSION_LINE =
  "Sign in again, then delete your account.";

/**
 * How a delete ended.
 *
 * `already-gone` is a SUCCESS and not an error: a second DELETE from a browser
 * that did not see the first answer must not tell somebody their account is
 * still here. The route answers both the same way for the same reason.
 */
export type AccountDeletionOutcome = "deleted" | "already-gone" | "unavailable";

/** Whether an outcome means the account is gone, either way it got there. */
export function accountIsDeleted(outcome: AccountDeletionOutcome): boolean {
  return outcome === "deleted" || outcome === "already-gone";
}
