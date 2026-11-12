import "server-only";

// The read behind GET /api/profiles/may-know: the signed-in viewer's mates of
// mates (lib/peopleYouMayKnow.ts holds the rule). WHO IS ASKING comes from the
// bearer and never from a parameter, so a list is only ever its owner's.
//
// A person is left out when their account is private, withdrawn, a test
// handle, or on either side of a Social block. A block check that cannot
// answer leaves the person out too: a missed suggestion costs nothing, and a
// blocked person on the list is the thing this read must never show.

import { accountIsPrivate } from "@/lib/accountVisibility";
import { isKnownTestHandle, withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { callerUserId } from "@/lib/authServer";
import { profileMayWearAvatar } from "@/lib/avatarResolve";
import type { FollowRelation } from "@/lib/followRelation";
import { followStore, type FollowStore } from "@/lib/followStore";
import { MAY_KNOW_MATES_READ, MAY_KNOW_MAX, rankMayKnow } from "@/lib/peopleYouMayKnow";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured } from "@/lib/supabase";

type MayKnowPerson = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  /** The viewer's mates who are mates with this person. */
  via: string[];
  /** "follows_you" when they already added the viewer. */
  relation: Extract<FollowRelation, "none" | "follows_you">;
};

export type MayKnowResult =
  | { ok: true; people: MayKnowPerson[] }
  | { ok: false; status: 401 | 503; code: string; error: string };

export type MayKnowDeps = {
  viewerHandle(request: Request): Promise<string | null>;
  follows: Pick<FollowStore, "listFollowing" | "listFollowers" | "mutualsAmong">;
  withdrawn(handles: readonly string[]): Promise<ReadonlySet<string>>;
  profile(handle: string): Promise<ProfileRecord | null>;
  /** True when either side blocked the other, or the check could not answer. */
  blocked(viewer: ProfileRecord, other: ProfileRecord): Promise<boolean>;
};

const SIGN_IN: MayKnowResult = {
  ok: false,
  status: 401,
  code: "SIGN_IN_REQUIRED",
  error: "Sign in and claim a handle first.",
};
const UNAVAILABLE: MayKnowResult = {
  ok: false,
  status: 503,
  code: "STORE_UNAVAILABLE",
  error: "This is unavailable right now.",
};

function defaultMayKnowDeps(): MayKnowDeps {
  return {
    async viewerHandle(request) {
      const userId = await callerUserId(request);
      if (!userId) return null;
      return profileStore().getHandleByUserId(userId);
    },
    follows: followStore(),
    withdrawn: withdrawnHandles,
    profile: (handle) => profileStore().getByHandle(handle),
    async blocked(viewer, other) {
      // The block lives in the Social tables, which a keyless build has none of.
      if (!isSupabaseConfigured()) return false;
      const relationship = await socialRelationshipBetweenProfiles(viewer.id, other.id);
      return relationship === "blocked" || relationship === "unavailable";
    },
  };
}

function card(profile: ProfileRecord): Pick<MayKnowPerson, "displayName" | "avatarUrl"> {
  const avatarUrl = profileMayWearAvatar(profile) ? publicOwnedImageUrl(profile, "avatar") : null;
  return {
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function shownToStrangers(profile: ProfileRecord | null): profile is ProfileRecord {
  return Boolean(profile) && !isProfileTombstoned(profile) && !accountIsPrivate(profile?.visibility);
}

export async function readPeopleYouMayKnow(
  request: Request,
  deps: MayKnowDeps = defaultMayKnowDeps(),
): Promise<MayKnowResult> {
  let viewer: string;
  try {
    viewer = normalizeHandle((await deps.viewerHandle(request)) ?? "");
  } catch {
    return UNAVAILABLE;
  }
  if (!viewer) return SIGN_IN;

  try {
    const [following, followers] = await Promise.all([
      deps.follows.listFollowing(viewer),
      deps.follows.listFollowers(viewer),
    ]);
    const followerSet = new Set(followers.map((handle) => normalizeHandle(handle)));
    const mutuals = following.map((handle) => normalizeHandle(handle)).filter((handle) => followerSet.has(handle));
    const hiddenMates = await deps.withdrawn(mutuals);
    const mates = [...new Set(mutuals)]
      .filter((handle) => handle && !hiddenMates.has(handle))
      .sort()
      .slice(0, MAY_KNOW_MATES_READ);
    if (mates.length === 0) return { ok: true, people: [] };

    const ranked = rankMayKnow({
      viewer,
      mates,
      matesOfMates: await deps.follows.mutualsAmong(mates),
      viewerFollowing: following,
    }).filter((candidate) => !isKnownTestHandle(candidate.handle));
    // Read a few more than are shown, so a private or blocked account still
    // leaves a full list.
    const shortlist = ranked.slice(0, MAY_KNOW_MAX * 2);
    if (shortlist.length === 0) return { ok: true, people: [] };

    const hidden = await deps.withdrawn(shortlist.map((candidate) => candidate.handle));
    const viewerProfile = await deps.profile(viewer);
    if (!viewerProfile) return { ok: true, people: [] };
    const people: MayKnowPerson[] = [];
    for (const candidate of shortlist) {
      if (people.length >= MAY_KNOW_MAX) break;
      if (hidden.has(candidate.handle)) continue;
      const profile = await deps.profile(candidate.handle);
      if (!shownToStrangers(profile) || (await deps.blocked(viewerProfile, profile))) continue;
      people.push({
        handle: candidate.handle,
        ...card(profile),
        via: candidate.via,
        relation: followerSet.has(candidate.handle) ? "follows_you" : "none",
      });
    }
    return { ok: true, people };
  } catch {
    return UNAVAILABLE;
  }
}
