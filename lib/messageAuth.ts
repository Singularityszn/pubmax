import "server-only";

// A verified account's linked handle takes precedence over an asserted handle.
// resolveMessageHandle also supports anonymous callers. requireLinkedActor
// requires a signed-in account and reports profile lookup outages as retryable
// 503s. Neither helper trusts an asserted handle after a failed profile lookup.

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
 * Prefer the auth-linked handle when the request carries a valid JWT whose
 * user owns a profile; otherwise return the normalized asserted handle (or ""
 * when neither is available).
 *
 * Use this on every private write before `gateHandleAction` so a signed-in
 * user cannot POST as a different unlinked handle while their JWT is present.
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
 * DMs require a signed-in user whose profile is linked.
 * Returns the linked handle or an asserted new claim. Profile lookup failures
 * refuse with 503 rather than trusting an asserted handle.
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
