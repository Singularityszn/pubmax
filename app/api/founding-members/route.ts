// The founders wall read: the first hundred claimed handles, in number order.
//
// The sibling of /api/profiles/directory - same closed row set (claimed and
// live), same public projection, same rate limit - narrowed to the accounts
// holding a founding number and ordered by that number instead of by handle. A
// wall that returned anything wider than the directory does would be a new
// disclosure hiding behind a numbered list.
//
// What crosses the wire is the number, the handle, an optional display name and
// an optional approved avatar. Email, date of birth, gender, full name, user id
// and every ownership or tombstone internal stay behind the owner-authenticated
// reads (__tests__/profilesRoutePrivacy.test.ts pins that set).
//
// A departed founder leaves the list and keeps their number, so the numbers may
// have gaps. That is the honest shape: reusing No. 7 would mean the mark named
// two different people.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { FOUNDING_MEMBER_CAP } from "@/lib/foundingMembers";
import { isLimited } from "@/lib/pintDrops";
import { readFoundingMembers } from "@/lib/foundingMembers.server";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `founding-members:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "The founders list is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  try {
    const members = await readFoundingMembers();
    return jsonNoStore({ members, cap: FOUNDING_MEMBER_CAP }, { status: 200 });
  } catch {
    return publicApiError(
      "The founders list is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
