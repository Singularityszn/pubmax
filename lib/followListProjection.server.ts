import "server-only";

import type { FollowListEntry } from "@/lib/followList";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore, publicOwnedImageUrl } from "@/lib/profileStore";

/** Public projection for one handle in a followers/following list. */
export async function followListEntries(handles: string[]): Promise<FollowListEntry[]> {
  const store = profileStore();
  return Promise.all(
    handles.map(async (raw): Promise<FollowListEntry | null> => {
      const handle = normalizeHandle(raw);
      if (!handle) return null;
      const profile = await store.getByHandle(handle);
      const entry: FollowListEntry = { handle };
      if (profile?.displayName) entry.displayName = profile.displayName;
      const avatarUrl = profile ? publicOwnedImageUrl(profile, "avatar") : undefined;
      if (avatarUrl) entry.avatarUrl = avatarUrl;
      return entry;
    }),
  ).then((rows) => rows.filter((row): row is FollowListEntry => row !== null));
}
