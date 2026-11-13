import "server-only";

// ONE RULE FOR "IS THIS PERSON STILL MY MATE". A mate is a mutual follow that
// neither side blocks. The follow graph's mutual list is the first filter; this
// check is the second, asked per person before their name is shown beside
// something they did (a price they paid, a pub they are in). It reads the same
// pair relationship the Social graph writes use, so a block either way removes
// the mate at once. Mates' prices (lib/matesPrices.server.ts) and "I'm here"
// presence (lib/presenceAudience.server.ts) both ask it.
//
// A summon and the mates' board ask the stricter question, isUnmutedMate: a
// mute either way also removes the mate, and an unavailable answer throws
// instead of reading as "not a mate", so the caller can say it is unavailable.

import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured } from "@/lib/supabase";

/** The verified Social account asking. */
export type MutualViewer = { profileId: string; handle: string };

/** The verified Social account asking, with its private Social account id. */
export type MateViewer = MutualViewer & { accountId: string };

/**
 * True only when the pair is still mutual and neither side blocks the other.
 * Fails closed: a missing, tombstoned or unlinked profile, the viewer
 * themselves, or an unavailable relationship answer is not a mate.
 */
export async function isLiveMutual(viewer: MutualViewer, mateHandle: string): Promise<boolean> {
  const mate = await profileStore().getByHandle(mateHandle);
  if (!mate || !mate.userId || isProfileTombstoned(mate)) return false;
  if (mate.id === viewer.profileId) return false;
  if (socialMemoryBlocked(viewer.profileId, mate.id)) return false;
  // Keyless dev has no relationship RPC; the memory block set above is its
  // whole block list, and the follow graph already said mutual.
  if (!isSupabaseConfigured()) return true;
  return (await socialRelationshipBetweenProfiles(viewer.profileId, mate.id)) === "mutual";
}

/** True when either side has muted the other. Throws when it cannot tell. */
export async function eitherMutes(viewer: MateViewer, handle: string): Promise<boolean> {
  const mate = await profileStore().getByHandle(handle);
  if (!mate || isProfileTombstoned(mate)) return true;
  const store = socialInteractionStore();
  const [mine, theirs] = await Promise.all([
    store.relationship(
      { accountId: viewer.accountId, profileId: viewer.profileId, handle: viewer.handle },
      mate.id,
    ),
    // The relationship read keys on the profile alone; the mate's account id
    // is not read by it.
    store.relationship({ accountId: "", profileId: mate.id, handle: mate.handle }, viewer.profileId),
  ]);
  return mine.muted || theirs.muted;
}

/**
 * True only when the pair is still mutual, neither side blocks the other and
 * neither side mutes the other. Throws when the relationship cannot be read.
 */
export async function isUnmutedMate(
  viewer: MateViewer,
  handle: string,
  mutes: (viewer: MateViewer, handle: string) => Promise<boolean> = eitherMutes,
): Promise<boolean> {
  const mate = await profileStore().getByHandle(handle);
  if (!mate || !mate.userId || isProfileTombstoned(mate)) return false;
  if (mate.id === viewer.profileId || socialMemoryBlocked(viewer.profileId, mate.id)) return false;
  if (isSupabaseConfigured()) {
    const relationship = await socialRelationshipBetweenProfiles(viewer.profileId, mate.id);
    if (relationship === "unavailable") throw new Error("Mate relationship unavailable");
    if (relationship !== "mutual") return false;
  }
  return !(await mutes(viewer, handle));
}
