import "server-only";

// The viewer's OWN mute and block list, for the "Blocked and muted" card in
// account settings. It reads only what this account set (its rows as blocker
// and as muter), never who blocked or muted it: that is the same one-way answer
// `read_social_relationship` gives for a single profile.
//
// A READ, AND NOTHING ELSE. Changing a row still goes through the existing
// `setBlock` and `setMute` on `socialInteractionStore`, and enforcement is
// untouched: every surface that hides a blocked account keeps reading its own
// door. This module adds no method to the store's type, so no caller of the
// store has to change.

import { createDualBackendStore, admin } from "@/lib/storeBackend";
import { socialMemoryBlocksBy, socialMemoryMutedProfiles } from "@/lib/socialBlockMemory";
import { profileStore } from "@/lib/profileStore";

/** More than this many rows in either list is not a list a person reads. */
const MAX_ROWS = 500;

type SocialRelationshipEntry = { handle: string; since: string | null };

export type OwnSocialRelationships = {
  blocked: SocialRelationshipEntry[];
  muted: SocialRelationshipEntry[];
};

type RelationshipListReader = {
  list(ownerProfileId: string): Promise<OwnSocialRelationships>;
};

function byHandle(left: SocialRelationshipEntry, right: SocialRelationshipEntry): number {
  return left.handle.localeCompare(right.handle);
}

const memoryReader: RelationshipListReader = {
  async list(ownerProfileId) {
    async function entries(ids: Set<string>): Promise<SocialRelationshipEntry[]> {
      const profiles = await Promise.all([...ids].slice(0, MAX_ROWS).map((id) => profileStore().getById(id)));
      return profiles
        .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
        .map((profile) => ({ handle: profile.handle, since: null }))
        .sort(byHandle);
    }
    const [blocked, muted] = await Promise.all([
      entries(socialMemoryBlocksBy(ownerProfileId)),
      entries(socialMemoryMutedProfiles(ownerProfileId)),
    ]);
    return { blocked, muted };
  },
};

async function durableEntries(
  table: "social_blocks" | "social_mutes",
  ownerColumn: string,
  targetColumn: string,
  ownerProfileId: string,
): Promise<SocialRelationshipEntry[]> {
  const { data, error } = await admin()
    .from(table)
    .select(`${targetColumn}, created_at`)
    .eq(ownerColumn, ownerProfileId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  const rows = (Array.isArray(data) ? data : []) as unknown as Record<string, unknown>[];
  const since = new Map<string, string | null>();
  for (const row of rows) {
    const id = row[targetColumn];
    if (typeof id === "string") since.set(id, typeof row.created_at === "string" ? row.created_at : null);
  }
  if (since.size === 0) return [];
  const { data: profiles, error: profileError } = await admin()
    .from("profiles")
    .select("id, handle")
    .in("id", [...since.keys()])
    .is("tombstoned_at", null);
  if (profileError) throw new Error(profileError.message);
  return ((Array.isArray(profiles) ? profiles : []) as Record<string, unknown>[])
    .filter((profile) => typeof profile.id === "string" && typeof profile.handle === "string")
    .map((profile) => ({
      handle: profile.handle as string,
      since: since.get(profile.id as string) ?? null,
    }))
    .sort(byHandle);
}

const supabaseReader: RelationshipListReader = {
  async list(ownerProfileId) {
    const [blocked, muted] = await Promise.all([
      durableEntries("social_blocks", "blocker_profile_id", "blocked_profile_id", ownerProfileId),
      durableEntries("social_mutes", "muter_profile_id", "muted_profile_id", ownerProfileId),
    ]);
    return { blocked, muted };
  },
};

const relationshipListReader = createDualBackendStore(memoryReader, supabaseReader);

/** The accounts this profile has blocked and muted, by handle. THROWS on a durable read failure. */
export function listOwnSocialRelationships(ownerProfileId: string): Promise<OwnSocialRelationships> {
  return relationshipListReader().list(ownerProfileId);
}
