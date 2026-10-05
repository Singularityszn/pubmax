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
//     it. A genuinely new handle can still be created and linked. That demo path
//     grants no VERIFIED ACTOR, so a write whose record has to be attributable
//     asks gateHasVerifiedActor and refuses rather than storing an unattributable
//     row.
//   • Linked handle (rowUserId set): allowed ONLY when the caller is
//     authenticated AND their uid matches. A non-owner — anonymous OR a different
//     signed-in user — is rejected. This is the security win: once a handle is
//     claimed by an account, it can't be hijacked by a self-asserted handle.
//   • Concurrent creation of the same new handle returns 409.

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { callerUserId } from "@/lib/authServer";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";

export type OwnershipDecision =
  | { allowed: true; reason: "unlinked" | "owner" }
  | { allowed: false; reason: "not-owner"; status: 403 };

export type HandleActionGate =
  | { allowed: true; callerUserId: string | null; handle: string }
  | { allowed: false; status: number; error: string };

type HandleActionIntent = "read" | "write" | "delete";

const NOT_OWNER_ERROR =
  "This handle belongs to a signed-in account. Sign in as its owner to continue.";

export type HandleActionOptions = {
  /**
   * Messages and notifications reads. An unowned row and a tombstone (the
   * owner column cleared on account deletion) are the same refusal as a
   * handle owned by somebody else. The demo path stays open for every other
   * caller.
   */
  requireAccountOwner?: boolean;
};

/** One owner for deciding whether a route action may claim an unlinked handle. */
function handleActionIntent(method: string): HandleActionIntent {
  const normalized = method.toUpperCase();
  if (normalized === "GET" || normalized === "HEAD") return "read";
  if (normalized === "DELETE") return "delete";
  return "write";
}

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
 * Whether an allowed gate stands behind a VERIFIED ACTOR.
 *
 * The unlinked demo path allows a write with no signed-in caller, so an allowed
 * gate is not by itself an attributable one. A record that has to name who made
 * it - a priced Pint Drop, which can only corroborate through its authority key
 * - asks this instead of re-deriving the answer from the gate's fields. It
 * applies the same trim as the actor keys built from that id, so the gate and
 * the key can never disagree about whether an actor is there.
 */
export function gateHasVerifiedActor(gate: HandleActionGate): boolean {
  return gate.allowed && Boolean(gate.callerUserId?.trim());
}

/**
 * Shared ownership gate for handle-keyed private/destructive API routes.
 *
 * Resolves the caller's verified JWT identity, looks up whether `handle` is
 * already linked to a `profiles.user_id`, and applies {@link decideProfileWrite}.
 * Existing unlinked profiles remain frozen against account ownership. Their
 * anonymous demo path remains, but an authenticated write may only create and
 * link a genuinely new handle. Reads and deletes never claim ownership.
 *
 * Unlinked, non-reserved handles keep the demo path. Linked handles require the
 * matching signed-in owner. Fail-closed on store errors so an outage cannot open
 * a linked handle to anonymous writes.
 *
 * A route that already verified the bearer passes `verifiedUserId` so the JWT
 * is checked once per request rather than once per gate. Omitting it keeps the
 * old behaviour; passing `null` states the caller is anonymous.
 *
 * `requireAccountOwner` closes the private-inbox read. A messages or
 * notifications read is allowed only when this caller's account owns a live
 * handle. An unowned row and a tombstone answer the same not-owner refusal a
 * handle owned by somebody else already answers.
 */
export async function gateHandleAction(
  request: Request,
  handle: string,
  verifiedUserId?: string | null,
  options?: HandleActionOptions,
): Promise<HandleActionGate> {
  const key = normalizeHandle(handle);
  if (!key) {
    return {
      allowed: false,
      status: 400,
      error: "Add a handle.",
    };
  }

  const caller =
    verifiedUserId === undefined ? await callerUserId(request) : verifiedUserId;

  try {
    const store = profileStore();
    // Generic profile creation never grants account ownership. An authenticated
    // mutation may create an absent handle already owned, but cannot inherit an
    // existing unowned row.
    const existing = await store.getByHandle(key);
    const rowUserId = existing?.userId ?? null;
    const callerOwnsHandle = Boolean(
      caller && rowUserId && caller === rowUserId,
    );
    // A deleted account keeps its rows and clears the owner. That row, and a
    // handle no account has ever owned, are not a demo inbox.
    if (options?.requireAccountOwner && !callerOwnsHandle) {
      return {
        allowed: false,
        status: 403,
        error: NOT_OWNER_ERROR,
      };
    }
    // Reserved contributor handles stay blocked for new claims and hijacks, but
    // a signed-in owner saving their own current handle must succeed idempotently.
    // A linked handle taken by someone else is a 403, not a reserved 409.
    if (!callerOwnsHandle && !rowUserId) {
      const assessment = assessPubmaxxHandle(key);
      if (!assessment.ok && assessment.reason === "reserved") {
        return {
          allowed: false,
          status: 409,
          error: assessment.error,
        };
      }
    }
    const linkNewHandle = handleActionIntent(request.method) === "write";
    if (
      existing &&
      !rowUserId &&
      caller &&
      linkNewHandle
    ) {
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
        error: NOT_OWNER_ERROR,
      };
    }

    if (linkNewHandle && !existing && caller) {
      try {
        await store.createOwned(key, caller);
      } catch (err) {
        // Concurrent creation of the same new handle surfaces as 409 so the
        // client can re-auth / pick another handle instead of a generic 503.
        const message = err instanceof Error ? err.message : String(err);
        if (/already has a handle/i.test(message)) {
          return {
            allowed: false,
            status: 409,
            error: "This account already has a handle. Use that handle, or rename it first.",
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

/**
 * `handle` when moderation withdrew it from public view and the request's
 * verified bearer owns it, otherwise undefined. A live handle never pays the
 * bearer check. Fail-closed to undefined.
 */
export async function callerOwnedWithdrawnHandle(
  request: Request,
  handle: string,
): Promise<string | undefined> {
  const key = normalizeHandle(handle);
  if (!key) return undefined;
  try {
    if (!(await withdrawnHandles([key])).has(key)) return undefined;
    const caller = await callerUserId(request);
    if (!caller) return undefined;
    const row = await profileStore().getByHandle(key);
    return row?.userId && row.userId === caller ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when moderation withdrew `handle` from public view and the request's
 * verified bearer does not own it: the caller must get the answer an unknown
 * handle gets. A live handle never pays the bearer check. Throws when the
 * withdrawal read fails, so each caller keeps its own fail-soft answer.
 */
export async function handleWithdrawnFromCaller(
  request: Request,
  handle: string,
): Promise<boolean> {
  const key = normalizeHandle(handle);
  if (!key || !(await withdrawnHandles([key])).has(key)) return false;
  return !(await callerOwnedWithdrawnHandle(request, key));
}
