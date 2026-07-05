// Directed follow graph over profiles. ONE interface, TWO implementations
// (process-memory + Supabase public.follows), same seam pattern as the other
// stores. A follow edge is keyed by the two self-asserted handles; each is
// resolved to a profile row (created lazily via ProfileStore.ensure) so the edge
// always references real profile ids, matching the follows FKs in migration 0006.
//
// No auth: the "follower" is whoever the client says they are (the localStorage
// handle). That is the same demo trust boundary as pint drops — extended here,
// not weakened.

import { normalizeHandle } from "@/lib/profiles";
import {
  memoryProfileStore,
  supabaseProfileStore,
  type ProfileStore,
} from "@/lib/profileStore";
import { getSupabaseAdmin } from "@/lib/supabase";

export type FollowCounts = { followers: number; following: number };

export type FollowStore = {
  /** Follow followee as follower (idempotent). Returns true when now following. */
  follow(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Remove the edge (idempotent). Returns true when no longer following. */
  unfollow(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Does follower currently follow followee? */
  isFollowing(followerHandle: string, followeeHandle: string): Promise<boolean>;
  /** Follower + following counts for a handle (0/0 for an unknown handle). */
  counts(handle: string): Promise<FollowCounts>;
};

const TABLE = "follows";

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// A self-follow is nonsense (and rejected by follows_no_self_chk). Normalise both
// handles and report when they collapse to the same identity so callers can 400.
export function isSelfFollow(a: string, b: string): boolean {
  const x = normalizeHandle(a);
  const y = normalizeHandle(b);
  return x !== "" && x === y;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseFollowStore: FollowStore = {
  async follow(followerHandle, followeeHandle) {
    if (isSelfFollow(followerHandle, followeeHandle)) return false;
    const follower = await supabaseProfileStore.ensure(followerHandle);
    const followee = await supabaseProfileStore.ensure(followeeHandle);
    const { error } = await admin()
      .from(TABLE)
      .insert({ follower_id: follower.id, followee_id: followee.id });
    // A duplicate edge means "already following" — an idempotent success, not an
    // error. Every other insert error is real.
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
    return true;
  },

  async unfollow(followerHandle, followeeHandle) {
    const follower = await supabaseProfileStore.getByHandle(followerHandle);
    const followee = await supabaseProfileStore.getByHandle(followeeHandle);
    // If either side has no profile there is nothing to unfollow — idempotent.
    if (!follower || !followee) return true;
    const { error } = await admin()
      .from(TABLE)
      .delete()
      .eq("follower_id", follower.id)
      .eq("followee_id", followee.id);
    if (error) throw new Error(error.message);
    return true;
  },

  async isFollowing(followerHandle, followeeHandle) {
    const follower = await supabaseProfileStore.getByHandle(followerHandle);
    const followee = await supabaseProfileStore.getByHandle(followeeHandle);
    if (!follower || !followee) return false;
    const { data, error } = await admin()
      .from(TABLE)
      .select("id")
      .eq("follower_id", follower.id)
      .eq("followee_id", followee.id)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },

  async counts(handle) {
    const profile = await supabaseProfileStore.getByHandle(handle);
    if (!profile) return { followers: 0, following: 0 };
    // head:true + count:exact = a COUNT query, no rows shipped back.
    const followers = await admin()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("followee_id", profile.id);
    if (followers.error) throw new Error(followers.error.message);
    const following = await admin()
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("follower_id", profile.id);
    if (following.error) throw new Error(following.error.message);
    return { followers: followers.count ?? 0, following: following.count ?? 0 };
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Edges as a Set of "followerId>followeeId" keys. Resets on restart.
const memoryEdges = new Set<string>();

function edgeKey(followerId: string, followeeId: string): string {
  return `${followerId}>${followeeId}`;
}

function makeMemoryFollowStore(profiles: ProfileStore): FollowStore {
  return {
    async follow(followerHandle, followeeHandle) {
      if (isSelfFollow(followerHandle, followeeHandle)) return false;
      const follower = await profiles.ensure(followerHandle);
      const followee = await profiles.ensure(followeeHandle);
      memoryEdges.add(edgeKey(follower.id, followee.id));
      return true;
    },
    async unfollow(followerHandle, followeeHandle) {
      const follower = await profiles.getByHandle(followerHandle);
      const followee = await profiles.getByHandle(followeeHandle);
      if (follower && followee) memoryEdges.delete(edgeKey(follower.id, followee.id));
      return true;
    },
    async isFollowing(followerHandle, followeeHandle) {
      const follower = await profiles.getByHandle(followerHandle);
      const followee = await profiles.getByHandle(followeeHandle);
      if (!follower || !followee) return false;
      return memoryEdges.has(edgeKey(follower.id, followee.id));
    },
    async counts(handle) {
      const profile = await profiles.getByHandle(handle);
      if (!profile) return { followers: 0, following: 0 };
      let followers = 0;
      let following = 0;
      for (const key of memoryEdges) {
        const [from, to] = key.split(">");
        if (to === profile.id) followers += 1;
        if (from === profile.id) following += 1;
      }
      return { followers, following };
    },
  };
}

export const memoryFollowStore: FollowStore = makeMemoryFollowStore(memoryProfileStore);

/** Test-only: clear the in-memory edge set between cases. */
export function __resetMemoryFollows(): void {
  memoryEdges.clear();
}
