// Profile ownership decision — pure helpers + shared route gate (user story 31).
//
// THE MODEL (as actually enforced in this codebase): all profile writes go
// through the service-role admin client, which bypasses RLS. So RLS is not the
// gate for the app's own writes — the gate is this server-side decision at the
// API seam. Given the handle being written and (a) whether that handle's stored
// profile is already LINKED to an auth user and (b) the caller's VERIFIED auth
// uid (from a validated JWT, or null when the request is anonymous), decide
// whether the write may proceed.
//
// Rules:
//   • Unlinked handle (rowUserId == null): allowed for ANYONE — this preserves
//     the demo/anonymous self-asserted-handle behaviour. An anonymous caller can
//     still edit an unclaimed handle exactly as before.
//   • Linked handle (rowUserId set): allowed ONLY when the caller is
//     authenticated AND their uid matches. A non-owner — anonymous OR a different
//     signed-in user — is rejected. This is the security win: once a handle is
//     claimed by an account, it can't be hijacked by a self-asserted handle.

import { callerUserId } from "@/lib/authServer";
import { profileStore } from "@/lib/profileStore";

export type OwnershipDecision =
  | { allowed: true; reason: "unlinked" | "owner" }
  | { allowed: false; reason: "not-owner"; status: 403 };

export type HandleActionGate =
  | { allowed: true; callerUserId: string | null; handle: string }
  | { allowed: false; status: number; error: string };

type HandleActionGateOptions = {
  /**
   * Whether an authenticated caller may stamp user_id onto an unlinked handle.
   * Defaults to write-intent methods only; read-only private routes must never
   * claim a handle merely because someone opened an inbox/list endpoint.
   */
  claimOnUnlinked?: boolean;
};

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

/**
 * Shared ownership gate for handle-keyed private/destructive API routes.
 *
 * Resolves the caller's verified JWT identity, looks up whether `handle` is
 * already linked to a `profiles.user_id`, and applies {@link decideProfileWrite}.
 * On the first authenticated touch of a still-unlinked handle, stamps the link
 * (account migration) so subsequent anonymous claims of that handle fail closed.
 *
 * Unlinked handles keep the demo path (anyone may act). Linked handles require
 * the matching signed-in owner. Fail-closed on store errors so an outage cannot
 * open a linked handle to anonymous writes.
 */
export async function gateHandleAction(
  request: Request,
  handle: string,
  options: HandleActionGateOptions = {},
): Promise<HandleActionGate> {
  const key = typeof handle === "string" ? handle.trim() : "";
  if (!key) {
    return {
      allowed: false,
      status: 400,
      error: "Add a handle.",
    };
  }

  const caller = await callerUserId(request);

  try {
    const store = profileStore();
    // Prefer a read-only lookup so a private GET (inbox, notifications) does not
    // invent a profile row. Fall back to ensure() only when we are about to
    // link — that path is write-intent and needs a row to stamp.
    const existing = await store.getByHandle(key);
    const rowUserId = existing?.userId ?? null;
    const decision = decideProfileWrite(rowUserId, caller);
    if (!decision.allowed) {
      return {
        allowed: false,
        status: decision.status,
        error:
          "This handle belongs to a signed-in account. Sign in as its owner to continue.",
      };
    }

    const claimOnUnlinked =
      options.claimOnUnlinked ?? !["GET", "HEAD"].includes(request.method.toUpperCase());
    if (claimOnUnlinked && shouldLinkUser(rowUserId, caller) && caller) {
      await store.linkUser(key, caller);
    }

    return { allowed: true, callerUserId: caller, handle: key };
  } catch {
    return {
      allowed: false,
      status: 503,
      error: "Profile storage is unavailable.",
    };
  }
}
