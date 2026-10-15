import "server-only";

import type { MomentConsent, NightStory, StoryContributor } from "@/lib/nightMemory";

// Shared memory relations let profile clearing and Story reads use one atomic
// operation without making the profile and Story stores import each other.
export const memoryStories = new Map<string, NightStory>();
export const memoryStoryContributors = new Map<string, StoryContributor[]>();
export const memoryStoryConsents = new Map<string, MomentConsent[]>();
export const memoryStoryRedactionNames = new Map<string, Map<string, string[]>>();

type ClearedIdentity = { handle: string; displayName?: string };

/** Clear keeps Story-scoped identities; ordinary departure only withdraws accepted rows. */
export function withdrawMemoryStoryContributions(accountId: string, identity?: ClearedIdentity): number {
  const affected = new Set<string>();
  let count = 0;
  for (const [storyId, rows] of memoryStoryContributors) {
    memoryStoryContributors.set(storyId, rows.map((row) => {
      if (row.profileId !== accountId) return row;
      if (identity) affected.add(storyId);
      if (row.status === "withdrawn" || (!identity && row.status !== "accepted")) return row;
      count += 1;
      return { ...row, status: "withdrawn" };
    }));
  }
  if (!identity) return count;

  const decidedAt = new Date().toISOString();
  for (const [storyId, rows] of memoryStoryConsents) {
    const removedMomentIds = new Set<string>();
    memoryStoryConsents.set(storyId, rows.map((row) => {
      if (row.ownerId !== accountId) return row;
      affected.add(storyId);
      removedMomentIds.add(row.momentId);
      return row.status === "withdrawn" ? row : { ...row, status: "withdrawn", decidedAt };
    }));
    const story = memoryStories.get(storyId);
    if (story && removedMomentIds.size > 0) {
      memoryStories.set(storyId, {
        ...story,
        publishedMomentIds: story.publishedMomentIds.filter((id) => !removedMomentIds.has(id)),
        updatedAt: decidedAt,
      });
    }
  }
  const retained = [identity.handle, identity.displayName].map((name) => name?.trim()).filter((name): name is string => Boolean(name));
  for (const storyId of affected) {
    const byAccount = memoryStoryRedactionNames.get(storyId) ?? new Map<string, string[]>();
    byAccount.set(accountId, [...new Set([...(byAccount.get(accountId) ?? []), ...retained])]);
    memoryStoryRedactionNames.set(storyId, byAccount);
  }
  return count;
}
