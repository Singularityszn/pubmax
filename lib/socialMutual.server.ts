import "server-only";

// ONE RULE FOR "IS THIS PERSON STILL MY MATE". A mate is a mutual follow that
// neither side blocks. The follow graph's mutual list is the first filter; this
// check is the second, asked per person before their name is shown beside
// something they did (a price they paid, a pub they are in). It reads the same
// pair relationship the Social graph writes use, so a block either way removes
// the mate at once. Mates' prices (lib/matesPrices.server.ts) and "I'm here"
// presence (lib/presenceAudience.server.ts) both ask it.

import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { socialRelationshipBetweenProfiles } from "@/lib/socialRelationships.server";
import { isSupabaseConfigured } from "@/lib/supabase";

/** The verified Social account asking. */
export type MutualViewer = { profileId: string; handle: string };

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
