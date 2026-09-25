import "server-only";

import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// Public withdrawal is a moderation fact about a LIVE profile: its owner is
// banned in Supabase auth, or its private Social account is suspended. A
// DELETED (tombstoned) profile is never withdrawn: its contributions stay
// public under the retired label (migration 0150), and `profilePublicPresence`
// answers it as `gone`. Migration 0157's `public_withdrawn_profiles()` answers
// the whole withdrawn set in ONE round trip, so no public surface pays an
// auth-admin call, and every caller decides its rows locally.

type WithdrawnProfiles = {
  profileIds: ReadonlySet<string>;
  handles: ReadonlySet<string>;
};

const memoryWithdrawnProfileIds = new Set<string>();

/** Test seam for keyless runs. Production ignores this set when Supabase is configured. */
export function __setMemoryProfileWithdrawn(profileId: string, withdrawn: boolean): void {
  if (withdrawn) memoryWithdrawnProfileIds.add(profileId);
  else memoryWithdrawnProfileIds.delete(profileId);
}

export function __resetMemoryProfileWithdrawals(): void {
  memoryWithdrawnProfileIds.clear();
}

async function readWithdrawnProfiles(): Promise<WithdrawnProfiles> {
  const profileIds = new Set<string>();
  const handles = new Set<string>();

  const admin = isSupabaseConfigured() ? getSupabaseAdmin() : null;
  if (!admin) {
    for (const profileId of memoryWithdrawnProfileIds) {
      const profile = await profileStore().getById(profileId);
      if (!profile || isProfileTombstoned(profile)) continue;
      profileIds.add(profile.id);
      handles.add(profile.handle);
    }
    return { profileIds, handles };
  }

  try {
    const { data, error } = await admin.rpc("public_withdrawn_profiles");
    if (error) return { profileIds, handles };
    for (const row of (data ?? []) as Array<{ profile_id?: unknown; handle?: unknown }>) {
      if (typeof row.profile_id === "string") profileIds.add(row.profile_id);
      const handle = normalizeHandle(String(row.handle ?? ""));
      if (handle) handles.add(handle);
    }
  } catch {
    // Fail-soft: treat nobody as withdrawn when the lane cannot answer.
  }
  return { profileIds, handles };
}

export type ProfilePublicPresence = "visible" | "gone" | "withdrawn";

export async function profilePublicPresence(
  profile: Pick<ProfileRecord, "id" | "tombstonedAt"> | null | undefined,
): Promise<ProfilePublicPresence> {
  if (!profile) return "visible";
  if (isProfileTombstoned(profile)) return "gone";
  const withdrawn = await readWithdrawnProfiles();
  return withdrawn.profileIds.has(profile.id) ? "withdrawn" : "visible";
}

export async function isProfileWithdrawnFromPublic(
  profile: Pick<ProfileRecord, "id" | "tombstonedAt"> | null | undefined,
): Promise<boolean> {
  return (await profilePublicPresence(profile)) === "withdrawn";
}

/** Drop withdrawn owners from public profile lists (search, directory, founders). */
export async function filterProfilesWithdrawnFromPublic<T extends Pick<ProfileRecord, "id" | "tombstonedAt">>(
  profiles: readonly T[],
): Promise<T[]> {
  if (profiles.length === 0) return [];
  const withdrawn = await readWithdrawnProfiles();
  return profiles.filter(
    (profile) => isProfileTombstoned(profile) || !withdrawn.profileIds.has(profile.id),
  );
}

/** The normalised handles among `handles` whose live profile is withdrawn. */
export async function withdrawnHandles(handles: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  if (keys.length === 0) return new Set();
  const withdrawn = await readWithdrawnProfiles();
  return new Set(keys.filter((key) => withdrawn.handles.has(key)));
}

/** Drop contributions whose author profile is withdrawn from public view. */
export async function dropWithdrawnAuthors<T>(
  items: readonly T[],
  authorHandle: (item: T) => string | null | undefined,
): Promise<T[]> {
  if (items.length === 0) return [];
  const hidden = await withdrawnHandles(items.map((item) => authorHandle(item) ?? ""));
  if (hidden.size === 0) return [...items];
  return items.filter((item) => !hidden.has(normalizeHandle(authorHandle(item) ?? "")));
}
