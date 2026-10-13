import "server-only";

// Friend-graph byproduct of planning a night together (WP7).
//
// When a signed-in, handle-claimed account joins a classic or collaboration
// plan, form the mutual follow pair with the claimed host unless either side
// blocks the other. Other members require an explicit follow.
// Blocks are never downgraded.
// Idempotent: an existing mutual pair is a no-op success.

import {
  followStore,
  isSelfFollow,
  type FollowStore,
} from "@/lib/followStore";
import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  type ProfileRecord,
  type ProfileStore,
} from "@/lib/profileStore";
import {
  linkPlanMemberUser,
  planHostUserId,
} from "@/lib/planCrewIdentity";
import {
  socialRelationshipBetweenProfiles,
  type SocialRelationshipServerDependencies,
} from "@/lib/socialRelationships.server";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { isSupabaseConfigured } from "@/lib/supabase";
import { followOnce } from "@/lib/followWrite.server";
import { isProfileWithdrawnFromPublic } from "@/lib/accountPublicAccess.server";

export type CrewFriendEdgeOutcome =
  | "created"
  | "already"
  | "blocked"
  | "unclaimed"
  | "self"
  | "unavailable";

export type CrewFriendEdgeFormResult = {
  formed: number;
  skippedBlocked: number;
  skippedUnclaimed: number;
  outcomes: CrewFriendEdgeOutcome[];
};

export type CrewFriendEdgeDependencies = {
  profiles: ProfileStore;
  follows: FollowStore;
  relationship: SocialRelationshipServerDependencies["queryRelationship"];
  linkMember: typeof linkPlanMemberUser;
  hostUserId: typeof planHostUserId;
  memoryBlocked: (a: string, b: string) => boolean;
  supabaseConfigured: () => boolean;
};

const defaultDependencies = (): CrewFriendEdgeDependencies => ({
  profiles: profileStore(),
  follows: followStore(),
  relationship: async (firstProfileId, secondProfileId) => {
    const { requireSupabaseAdmin } = await import("@/lib/supabase");
    const { data, error } = await requireSupabaseAdmin().rpc(
      "social_relationship_between_profiles",
      {
        p_first_profile_id: firstProfileId,
        p_second_profile_id: secondProfileId,
      },
    );
    if (error) throw new Error(error.message);
    return data;
  },
  linkMember: linkPlanMemberUser,
  hostUserId: planHostUserId,
  memoryBlocked: socialMemoryBlocked,
  supabaseConfigured: isSupabaseConfigured,
});

function isClaimedLive(profile: ProfileRecord | null): profile is ProfileRecord {
  return Boolean(
    profile &&
      profile.userId &&
      !isProfileTombstoned(profile) &&
      normalizeHandle(profile.handle),
  );
}

async function pairIsBlocked(
  first: ProfileRecord,
  second: ProfileRecord,
  deps: CrewFriendEdgeDependencies,
): Promise<boolean> {
  if (deps.memoryBlocked(first.id, second.id)) return true;
  if (!deps.supabaseConfigured()) return false;
  const relationship = await socialRelationshipBetweenProfiles(
    first.id,
    second.id,
    { queryRelationship: deps.relationship },
  );
  return relationship === "blocked";
}

/**
 * Create the mutual follow pair between two claimed handles when neither
 * blocks the other. Never creates edges for unclaimed or tombstoned profiles.
 */
export async function ensureMutualFollowPair(
  firstHandle: string,
  secondHandle: string,
  dependencies: Partial<CrewFriendEdgeDependencies> = {},
): Promise<CrewFriendEdgeOutcome> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const a = normalizeHandle(firstHandle);
  const b = normalizeHandle(secondHandle);
  if (!a || !b) return "unclaimed";
  if (isSelfFollow(a, b)) return "self";

  let first: ProfileRecord | null;
  let second: ProfileRecord | null;
  try {
    [first, second] = await Promise.all([
      deps.profiles.getByHandle(a),
      deps.profiles.getByHandle(b),
    ]);
  } catch {
    return "unavailable";
  }
  if (!isClaimedLive(first) || !isClaimedLive(second)) return "unclaimed";

  try {
    const withdrawn = await Promise.all([
      isProfileWithdrawnFromPublic(first),
      isProfileWithdrawnFromPublic(second),
    ]);
    if (withdrawn.includes(true)) return "unavailable";
    if (await pairIsBlocked(first, second, deps)) return "blocked";
  } catch {
    return "unavailable";
  }

  try {
    const [aFollowsB, bFollowsA] = await Promise.all([
      deps.follows.isFollowing(a, b),
      deps.follows.isFollowing(b, a),
    ]);
    if (aFollowsB && bFollowsA) return "already";
    const outcomes = await Promise.all([
      aFollowsB ? Promise.resolve("already") : followOnce(a, b, deps),
      bFollowsA ? Promise.resolve("already") : followOnce(b, a, deps),
    ]);
    if (outcomes.includes("unavailable")) return "unavailable";
    return outcomes.includes("followed") ? "created" : "already";
  } catch {
    return "unavailable";
  }
}

/**
 * After a successful plan-crew join: stamp the joiner's auth user on their
 * member row, then form mutuals only with the claimed host.
 * Fail-soft: identity or edge failures never fail the join itself.
 */
export async function formFriendEdgesForPlanJoin(input: {
  planId: string;
  joinerUserId: string;
  joinerMemberId: string;
}, dependencies: Partial<CrewFriendEdgeDependencies> = {}): Promise<CrewFriendEdgeFormResult> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const empty: CrewFriendEdgeFormResult = {
    formed: 0,
    skippedBlocked: 0,
    skippedUnclaimed: 0,
    outcomes: [],
  };
  const userId = typeof input.joinerUserId === "string" ? input.joinerUserId.trim() : "";
  if (!userId || !input.planId || !input.joinerMemberId) return empty;

  let joiner: ProfileRecord | null;
  try {
    joiner = await deps.profiles.getByUserId(userId);
  } catch {
    return empty;
  }
  if (!isClaimedLive(joiner)) {
    return { ...empty, skippedUnclaimed: 1, outcomes: ["unclaimed"] };
  }

  try {
    await deps.linkMember(input.planId, input.joinerMemberId, userId);
  } catch {
    // Stamp failure still allows edge formation against the already-linked host.
  }

  let hostUserId: string | null;
  try {
    hostUserId = await deps.hostUserId(input.planId);
  } catch {
    return empty;
  }
  if (!hostUserId || hostUserId === userId) return empty;
  let host: ProfileRecord | null;
  try {
    host = await deps.profiles.getByUserId(hostUserId);
  } catch {
    return { ...empty, outcomes: ["unavailable"] };
  }
  if (!isClaimedLive(host)) {
    return { ...empty, skippedUnclaimed: 1, outcomes: ["unclaimed"] };
  }
  const outcome = await ensureMutualFollowPair(joiner.handle, host.handle, deps);
  return {
    formed: outcome === "created" ? 1 : 0,
    skippedBlocked: outcome === "blocked" ? 1 : 0,
    skippedUnclaimed: outcome === "unclaimed" ? 1 : 0,
    outcomes: [outcome],
  };
}
