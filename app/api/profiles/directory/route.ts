// Browse the people who have joined: claimed, non-tombstoned public handles.
//
// The sibling of /api/profiles/search - same closed row set, same public
// projection (`toPublicMatch` there, `toDirectoryEntry` here), same rate limit -
// with the prefix dropped so a reader who does not already know a handle can
// still find somebody. Search answers "is @sam here"; this answers "who is
// here". A directory that returned anything wider than the search does would be
// a new disclosure hiding behind a browse control.
//
// What crosses the wire is id, handle, optional display name and optional
// avatar url. Email, date of birth, gender, full name, user id and every
// ownership or tombstone internal stay behind the owner-authenticated reads
// (__tests__/profilesRoutePrivacy.test.ts pins that set).
//
// Paged by handle, which is the sort key, so the cursor is the last handle of
// the page and needs no signing: it reveals nothing the page itself did not.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

export type DirectoryEntry = {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

function toDirectoryEntry(profile: ProfileRecord): DirectoryEntry {
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `profile-directory:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "The directory is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return publicApiError("Ask for 1 to 48 people.", "INVALID_REQUEST", 400);
    }
    limit = parsed;
  }
  const afterHandle = normalizeHandle(params.get("after") ?? "");

  try {
    // Ask for one more than the page so "is there another page" is a fact
    // rather than a guess from a full page.
    const rows = await profileStore().listClaimedProfiles({
      limit: Math.min(limit + 1, MAX_LIMIT + 1),
      ...(afterHandle ? { afterHandle } : {}),
    });
    const live = rows.filter(
      (row) => Boolean(row.userId) && !isProfileTombstoned(row),
    );
    const page = live.slice(0, limit);
    const nextCursor = live.length > page.length && page.length > 0
      ? page[page.length - 1]!.handle
      : null;
    return jsonNoStore(
      { people: page.map(toDirectoryEntry), nextCursor },
      { status: 200 },
    );
  } catch {
    return publicApiError(
      "The directory is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
