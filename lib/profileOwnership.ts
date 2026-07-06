// Profile ownership decision — pure, backend-free (user story 31).
//
// THE MODEL (as actually enforced in this codebase): all profile writes go
// through the service-role admin client, which bypasses RLS. So RLS is not the
// gate for the app's own writes — the gate is this server-side decision at the
// API seam (app/api/profiles/[handle]/route.ts). Given the handle being written
// and (a) whether that handle's stored profile is already LINKED to an auth user
// and (b) the caller's VERIFIED auth uid (from a validated JWT, or null when the
// request is anonymous), decide whether the write may proceed.
//
// Rules:
//   • Unlinked handle (rowUserId == null): allowed for ANYONE — this preserves
//     the demo/anonymous self-asserted-handle behaviour. An anonymous caller can
//     still edit an unclaimed handle exactly as before.
//   • Linked handle (rowUserId set): allowed ONLY when the caller is
//     authenticated AND their uid matches. A non-owner — anonymous OR a different
//     signed-in user — is rejected. This is the security win: once a handle is
//     claimed by an account, it can't be hijacked by a self-asserted handle.
//
// Pure so it unit-tests with no DB/JWT: the route resolves the two inputs
// (rowUserId from the store, callerUserId from verifying the token) and asks.

export type OwnershipDecision =
  | { allowed: true; reason: "unlinked" | "owner" }
  | { allowed: false; reason: "not-owner"; status: 403 };

/**
 * Decide whether a caller may write to `handle`'s profile.
 *
 * @param rowUserId    profiles.user_id for the target handle, or null when the
 *                     handle has no row yet OR the row is unlinked (demo).
 * @param callerUserId the caller's VERIFIED auth uid, or null when the request
 *                     carries no valid session (anonymous).
 */
export function decideProfileWrite(
  rowUserId: string | null | undefined,
  callerUserId: string | null | undefined,
): OwnershipDecision {
  const linkedTo = typeof rowUserId === "string" && rowUserId ? rowUserId : null;
  const caller = typeof callerUserId === "string" && callerUserId ? callerUserId : null;

  // Unlinked / no row yet → anyone may write (demo path unchanged).
  if (!linkedTo) return { allowed: true, reason: "unlinked" };

  // Linked → only the matching, authenticated owner.
  if (caller && caller === linkedTo) return { allowed: true, reason: "owner" };

  return { allowed: false, reason: "not-owner", status: 403 };
}

/**
 * Decide whether the caller's authenticated identity should be LINKED onto the
 * handle's row on this write (account migration, user story 32). Link when the
 * caller is authenticated and the row is not already linked to them — i.e. the
 * first authenticated touch of a still-unlinked handle claims it. Never
 * re-links a row already owned by someone else (that write is rejected upstream
 * by decideProfileWrite before we get here).
 */
export function shouldLinkUser(
  rowUserId: string | null | undefined,
  callerUserId: string | null | undefined,
): boolean {
  const linkedTo = typeof rowUserId === "string" && rowUserId ? rowUserId : null;
  const caller = typeof callerUserId === "string" && callerUserId ? callerUserId : null;
  if (!caller) return false; // anonymous → nothing to link
  return linkedTo !== caller; // link when unlinked, or (defensively) mismatched-but-allowed
}
