import "server-only";

import type {
  CreatorListDiscoveryItem,
  CreatorListDiscoveryResult,
  CreatorListProfile,
} from "@/lib/creatorListDiscovery";
import { creatorListMapHref } from "@/lib/creatorListMap";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";
import { PLAN_QUERY_PARAM } from "@/lib/planOccasion";
import { savedListPath } from "@/lib/savedListUrl";
import {
  cleanListType,
  savedPubsStore,
  type SavedPubDTO,
} from "@/lib/savedPubsStore";

const PREVIEW_VENUE_LIMIT = 3;

export type CreatorListDiscoveryDependencies = {
  listProfiles(input: {
    limit: number;
    afterHandle?: string;
  }): Promise<CreatorListProfile[]>;
  listSaved(input: { handle: string }): Promise<SavedPubDTO[]>;
};

type CreatorListDiscoveryInput = {
  limit: number;
  afterHandle?: string;
};

function creatorListPlanUrl(handle: string, listType: string): string {
  const params = new URLSearchParams();
  params.set(PLAN_QUERY_PARAM, `Plan ${listType} by @${handle}`);
  return `/plan?${params.toString()}`;
}

function listsForProfile(
  profile: CreatorListProfile,
  saved: SavedPubDTO[],
): CreatorListDiscoveryItem[] {
  const grouped = new Map<string, SavedPubDTO[]>();
  for (const row of saved) {
    const listType = cleanListType(row.listType);
    if (!listType) continue;
    const rows = grouped.get(listType) ?? [];
    rows.push(row);
    grouped.set(listType, rows);
  }

  return Array.from(grouped).flatMap(([listType, rows]) => {
    const mapUrl = creatorListMapHref(rows);
    if (!mapUrl) return [];
    return [{
      ownerHandle: profile.handle,
      ...(profile.displayName ? { ownerDisplayName: profile.displayName } : {}),
      ...(profile.avatarUrl ? { ownerAvatarUrl: profile.avatarUrl } : {}),
      listType,
      listUrl: savedListPath(profile.handle, listType),
      mapUrl,
      planUrl: creatorListPlanUrl(profile.handle, listType),
      savedCount: rows.length,
      updatedAt: rows[0]!.savedAt,
      previewVenues: rows.slice(0, PREVIEW_VENUE_LIMIT).map((row) => ({
        venueId: row.venueId,
        venueName: row.venueName,
        venueMapUrl: row.venueMapUrl,
      })),
    }];
  });
}

export async function discoverCreatorLists(
  input: CreatorListDiscoveryInput,
  dependencies: CreatorListDiscoveryDependencies,
): Promise<CreatorListDiscoveryResult> {
  const profiles = await dependencies.listProfiles({
    limit: input.limit + 1,
    ...(input.afterHandle ? { afterHandle: input.afterHandle } : {}),
  });
  const examined = profiles.slice(0, input.limit);
  const nextCursor = profiles.length > examined.length && examined.length > 0
    ? examined[examined.length - 1]!.handle
    : null;
  const savedByProfile = await Promise.all(
    examined.map((profile) => dependencies.listSaved({ handle: profile.handle })),
  );

  return {
    status: "ready",
    lists: examined.flatMap((profile, index) =>
      listsForProfile(profile, savedByProfile[index] ?? []),
    ),
    nextCursor,
  };
}

export const creatorListDiscoveryDependencies: CreatorListDiscoveryDependencies = {
  async listProfiles(input) {
    const profiles = await profileStore().listClaimedProfiles(input);
    return profiles
      .filter((profile) => Boolean(profile.userId) && !isProfileTombstoned(profile))
      .map((profile) => {
        const avatarUrl = publicOwnedImageUrl(profile, "avatar");
        return {
          handle: profile.handle,
          ...(profile.displayName ? { displayName: profile.displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        };
      });
  },
  listSaved(input) {
    return savedPubsStore().listSaved(input);
  },
};
