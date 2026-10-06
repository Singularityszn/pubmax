// WP7 find-your-lot: prefix search over claimed, non-tombstoned public handles.
// Returns ONLY the public projection fields - never email, DOB, userId, or
// tombstone/ownership internals. Rate-limited; errors via publicApiError.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { followStore } from "@/lib/followStore";
import { resolveFollowRelation, type FollowRelation } from "@/lib/followRelation";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import {
  filterProfilesWithdrawnFromPublic,
  withdrawnHandles,
} from "@/lib/accountPublicAccess.server";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

const SEARCH_LIMIT = 8;
const MIN_PREFIX = 2;

type PublicMatch = {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  /** What the asking viewer is to this match; absent when nobody was named. */
  relation?: FollowRelation;
};

function toPublicMatch(profile: ProfileRecord): PublicMatch {
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/**
 * Where each match stands with the viewer, from the two follow edges.
 *
 * `?viewer=` is the follow control's own convenience, self-asserted exactly as
 * it is on the public profile read, and it may decide what a button says and
 * never what a body carries. Both edges are already public through
 * `/following` and `/lot`, so this adds a round trip's worth of convenience and
 * no disclosure. A withdrawn viewer answers like one who never existed.
 */
async function withRelations(
  matches: PublicMatch[],
  viewer: string,
): Promise<PublicMatch[]> {
  if (!viewer || matches.length === 0) return matches;
  let following: string[];
  let followers: string[];
  try {
    if ((await withdrawnHandles([viewer])).has(viewer)) return matches;
    const store = followStore();
    [following, followers] = await Promise.all([
      store.listFollowing(viewer),
      store.listFollowers(viewer),
    ]);
  } catch {
    // A follow state that could not be read is no state: the match still shows,
    // and its button says what it said before relations existed.
    return matches;
  }
  const followed = new Set(following.map(normalizeHandle));
  const followedBy = new Set(followers.map(normalizeHandle));
  return matches.map((match) =>
    match.handle === viewer
      ? match
      : {
          ...match,
          relation: resolveFollowRelation({
            viewerFollowing: followed.has(match.handle),
            followsViewer: followedBy.has(match.handle),
          }),
        },
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
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
    const viewer = normalizeHandle(url.searchParams.get("viewer") ?? "");
    return jsonNoStore({ matches: await withRelations(matches, viewer) }, { status: 200 });
  } catch {
    return publicApiError(
      "Profile search is unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
