import "server-only";

import type { MomentConsent, StoryContributor } from "@/lib/nightMemory";

// Shared memory relations let profile clearing and Story reads use one atomic
// operation without making the profile and Story stores import each other.
export const memoryStoryContributors = new Map<string, StoryContributor[]>();
export const memoryStoryConsents = new Map<string, MomentConsent[]>();
export const memoryStoryRedactionNames = new Map<string, Map<string, string[]>>();

/** Memory equivalent of clear_profile_for_caller's Story transaction. */
export function withdrawMemoryStoryContributions(accountId: string, displayName?: string): number {
  const affected = new Set<string>();
  let count = 0;
  for (const [storyId, rows] of memoryStoryContributors) {
    memoryStoryContributors.set(storyId, rows.map((row) => {
      if (row.profileId !== accountId) return row;
      if (row.status === "accepted" || row.status === "withdrawn") affected.add(storyId);
      if (row.status !== "accepted") return row;
      count += 1;
      return { ...row, status: "withdrawn" };
    }));
  }
  for (const [storyId, rows] of memoryStoryConsents) {
    if (rows.some((row) => row.ownerId === accountId && row.status === "withdrawn")) {
      affected.add(storyId);
    }
  }
  const name = displayName?.trim();
  if (name) {
    for (const storyId of affected) {
      const byAccount = memoryStoryRedactionNames.get(storyId) ?? new Map<string, string[]>();
      const names = byAccount.get(accountId) ?? [];
      if (!names.includes(name)) byAccount.set(accountId, [...names, name]);
      memoryStoryRedactionNames.set(storyId, byAccount);
    }
  }
  return count;
}
