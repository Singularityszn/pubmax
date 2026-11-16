import "server-only";

import { filterProfilesWithdrawnFromPublic } from "@/lib/accountPublicAccess.server";
import {
  FOUNDING_MEMBER_CAP,
  isFoundingMemberNumber,
} from "@/lib/foundingMembers";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";

export type FoundingMemberEntry = {
  number: number;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

function toFoundingEntry(profile: ProfileRecord): FoundingMemberEntry | null {
  if (!isFoundingMemberNumber(profile.foundingMemberNumber)) return null;
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    number: profile.foundingMemberNumber,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/** One public list powers the wall, its API, and the Social founder count. */
export async function readFoundingMembers(): Promise<FoundingMemberEntry[]> {
  const rows = await profileStore().listFoundingMembers();
  const live = await filterProfilesWithdrawnFromPublic(
    rows.filter((row) => Boolean(row.userId) && !isProfileTombstoned(row)),
  );
  return live
    .map(toFoundingEntry)
    .filter((entry): entry is FoundingMemberEntry => entry !== null)
    .sort((left, right) => left.number - right.number)
    .slice(0, FOUNDING_MEMBER_CAP);
}
