import "server-only";

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { filterProfilesWithdrawnFromPublic } from "@/lib/accountPublicAccess.server";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

const SEARCH_LIMIT = 8;
const MIN_PREFIX = 2;

function toPublicMatch(profile: ProfileRecord): {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
} {
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export async function publicProfileSearchResponse(request: Request): Promise<Response> {
  const limiterKey = `profile-search:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many searches, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Profile search is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const url = new URL(request.url);
  const q = normalizeHandle(url.searchParams.get("q") ?? "");
  if (!q || q.length < MIN_PREFIX) {
    return publicApiError(
      "Type at least two characters of a handle.",
      "INVALID_REQUEST",
      400,
    );
  }

  try {
    const rows = await profileStore().searchClaimedByHandlePrefix(q, SEARCH_LIMIT);
    const live = rows.filter(
      (row) => Boolean(row.userId) && !isProfileTombstoned(row),
    );
    const matches = (await filterProfilesWithdrawnFromPublic(live)).map(toPublicMatch);
    return jsonNoStore({ matches }, { status: 200 });
  } catch {
    return publicApiError(
      "Profile search is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
