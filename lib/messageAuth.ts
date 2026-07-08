// Resolve the actor handle for messaging routes.
//
// Dual-backend identity (same stance as profiles):
//   • When a verified Supabase Auth JWT is present AND that user has a linked
//     profile, the linked handle wins — body/query handle is not trusted alone.
//   • When auth is absent / unconfigured / the user has no linked profile, fall
//     back to the self-asserted handle (anonymous/demo path).
//
// Fail-soft: a store lookup error never blocks the demo path; we just use the
// asserted handle. Ownership of LINKED profiles is still enforced elsewhere
// (profile PATCH/DELETE); messaging only needs "who am I claiming to be".

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
 */
export async function resolveMessageHandle(
  request: Request,
  assertedHandle: string | null | undefined,
): Promise<string> {
  const asserted = normalizeHandle(assertedHandle ?? "");
  const userId = await callerUserId(request);
  if (!userId) return asserted;

  try {
    const linked = await profileStore().getHandleByUserId(userId);
    if (linked) return linked;
  } catch {
    // Auth configured but profile lookup failed — keep the demo path alive.
  }
  return asserted;
}
