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
//   • An existing unlinked legacy profile is frozen against account ownership.
//     It keeps the anonymous demo path, but an authenticated write cannot claim
//     it. A genuinely new handle can still be created and linked.
//   • Linked handle (rowUserId set): allowed ONLY when the caller is
//     authenticated AND their uid matches. A non-owner — anonymous OR a different
//     signed-in user — is rejected. This is the security win: once a handle is
//     claimed by an account, it can't be hijacked by a self-asserted handle.
//   • Concurrent creation of the same new handle returns 409.

import { callerUserId } from "@/lib/authServer";
import { profileStore } from "@/lib/profileStore";

export type OwnershipDecision =
  | { allowed: true; reason: "unlinked" | "owner" }
  | { allowed: false; reason: "not-owner"; status: 403 };

export type HandleActionGate =
  | { allowed: true; callerUserId: string | null; handle: string }
  | { allowed: false; status: number; error: string };

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
 * Decide whether the caller's authenticated identity should be linked to a new
 * handle row. The shared gate calls this only after proving no profile row
 * exists, so an old unlinked profile never reaches this helper.
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
 * Existing unlinked profiles remain frozen against account ownership. Their
 * anonymous demo path remains, but an authenticated write may only create and
 * link a genuinely new handle.
 *
 * Unlinked, non-reserved handles keep the demo path. Linked handles require the
 * matching signed-in owner. Fail-closed on store errors so an outage cannot open
 * a linked handle to anonymous writes.
 */
export async function gateHandleAction(
  request: Request,
  handle: string,
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
    // A read never creates account ownership. A write can link only when there
    // is no row at all, never when an unlinked legacy row already exists.
    const existing = await store.getByHandle(key);
    const rowUserId = existing?.userId ?? null;
    const linkNewHandle = !["GET", "HEAD"].includes(request.method.toUpperCase());
    if (existing && !rowUserId && caller && linkNewHandle) {
      return {
        allowed: false,
        status: 409,
        error: "That legacy handle is frozen. Choose a new handle for this account.",
      };
    }
    const decision = decideProfileWrite(rowUserId, caller);
    if (!decision.allowed) {
      return {
        allowed: false,
        status: decision.status,
        error:
          "This handle belongs to a signed-in account. Sign in as its owner to continue.",
      };
    }

    if (linkNewHandle && shouldLinkUser(rowUserId, caller) && caller) {
      try {
        await store.linkUser(key, caller);
      } catch (err) {
        // Concurrent creation of the same new handle surfaces as 409 so the
        // client can re-auth / pick another handle instead of a generic 503.
        const message = err instanceof Error ? err.message : String(err);
        if (/already linked/i.test(message)) {
          return {
            allowed: false,
            status: 409,
            error: "This handle was just claimed by another account. Sign in as its owner, or pick a different handle.",
          };
        }
        if (/not available/i.test(message)) {
          return {
            allowed: false,
            status: 409,
            error: "That handle is not available.",
          };
        }
        throw err;
      }
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
