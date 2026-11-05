import "server-only";

// Resolve handles for direct messages and legacy callers.
// A failed profile lookup returns an empty handle from `resolveMessageHandle`
// and a retryable 503 from `requireLinkedActor`.

import { callerUserId } from "@/lib/authServer";
import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  supabaseProfileStore,
  type ProfileStore,
} from "@/lib/profileStore";
import { isSupabaseConfigured } from "@/lib/supabase";

function profileStore(): ProfileStore {
  return isSupabaseConfigured() ? supabaseProfileStore : memoryProfileStore;
}

/**
 * Prefer the linked handle of a verified user. If there is no verified user,
 * return the normalized asserted handle. If a successful lookup finds no
 * profile, return the assertion unless `requireLinked` is set. Return "" when
 * the lookup fails or finds no profile with `requireLinked` set.
 *
 * Legacy write routes must still check handle ownership with
 * `gateHandleAction`.
 *
 * A route that already verified the bearer passes `verifiedUserId` so the JWT
 * is checked once per request rather than once per gate. Omitting it keeps the
 * old behaviour; passing `null` states the caller is anonymous.
 */
export async function resolveMessageHandle(
  request: Request,
  assertedHandle: string | null | undefined,
  verifiedUserId?: string | null,
  options?: { requireLinked?: boolean },
): Promise<string> {
  const asserted = normalizeHandle(assertedHandle ?? "");
  const userId =
    verifiedUserId === undefined ? await callerUserId(request) : verifiedUserId;
  if (!userId) return asserted;

  try {
    const linked = await profileStore().getHandleByUserId(userId);
    if (linked) return linked;
    if (options?.requireLinked) return "";
  } catch {
    // Valid JWT present but profile lookup failed — fail closed. Falling back
    // to the body handle would let a spoofed handle ride a real session during
    // a store outage.
    return "";
  }
  return asserted;
}

export type LinkedActorGate =
  | { ok: true; handle: string; userId: string }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string };

/**
 * Require a verified user for direct messages. Return the linked handle if
 * the lookup finds one. A successful lookup that finds no profile permits a
 * normalized asserted handle, subject to the route's ownership checks.
 *
 * Return 401 without a verified user and 400 without a handle after a
 * successful lookup. Fail closed with a retryable 503 if the lookup fails.
 */
export async function requireLinkedActor(
  request: Request,
  assertedHandle: string | null | undefined,
): Promise<LinkedActorGate> {
  const userId = await callerUserId(request);
  if (!userId) {
    return {
      ok: false,
      status: 401,
      error: "Sign in to message.",
    };
  }

  let linked = "";
  try {
    linked = (await profileStore().getHandleByUserId(userId)) ?? "";
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Couldn't check your handle. Try again.",
    };
  }

  if (!linked) {
    // A new asserted handle can be created by gateHandleAction on POST. If a
    // legacy unlinked row already exists, that gate refuses account ownership.
    const asserted = normalizeHandle(assertedHandle ?? "");
    if (!asserted) {
      return {
        ok: false,
        status: 400,
        error: "Add your handle.",
      };
    }
    return { ok: true, handle: asserted, userId };
  }

  return { ok: true, handle: linked, userId };
}
