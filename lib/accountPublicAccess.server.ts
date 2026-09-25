import "server-only";

import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, type ProfileRecord } from "@/lib/profileStore";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// Public withdrawal is a moderation fact about a PROFILE: its private social
// account is `suspended`. A GoTrue ban gates sign-in only (lib/authAccountBan.ts)
// and is never read here, so no public surface pays an auth-admin round trip.
// Suspensions are rare, so every check reads the whole suspended set in ONE
// query, joined to the profile's current handle, and decides its rows locally.

type SuspendedProfiles = {
  profileIds: ReadonlySet<string>;
  handles: ReadonlySet<string>;
};

const memorySuspendedProfiles = new Map<string, string>();

/** Test seam for keyless runs. Production ignores this map when Supabase is configured. */
export function __setMemoryProfileSuspended(
  profile: Pick<ProfileRecord, "id" | "handle">,
  suspended: boolean,
): void {
  if (suspended) memorySuspendedProfiles.set(profile.id, normalizeHandle(profile.handle));
  else memorySuspendedProfiles.delete(profile.id);
}

export function __resetMemoryProfileSuspensions(): void {
  memorySuspendedProfiles.clear();
}

async function readSuspendedProfiles(): Promise<SuspendedProfiles> {
  const profileIds = new Set<string>();
  const handles = new Set<string>();

  const admin = isSupabaseConfigured() ? getSupabaseAdmin() : null;
  if (!admin) {
    for (const [profileId, handle] of memorySuspendedProfiles) {
      profileIds.add(profileId);
      handles.add(handle);
    }
    return { profileIds, handles };
  }

  try {
    const { data, error } = await admin
      .from("private_social_accounts")
      .select("profile_id, profiles(handle)")
      .eq("ownership_state", "suspended");
    if (error) return { profileIds, handles };
    for (const row of data ?? []) {
      const { profile_id: profileId, profiles: profile } = row as {
        profile_id?: unknown;
        profiles?: { handle?: unknown } | null;
      };
      if (typeof profileId === "string") profileIds.add(profileId);
      const handle = normalizeHandle(String(profile?.handle ?? ""));
      if (handle) handles.add(handle);
    }
  } catch {
    // Fail-soft: treat nobody as suspended when the lane cannot answer.
  }
  return { profileIds, handles };
}

export type ProfilePublicPresence = "visible" | "gone" | "withdrawn";

export async function profilePublicPresence(
  profile: Pick<ProfileRecord, "id" | "tombstonedAt"> | null | undefined,
): Promise<ProfilePublicPresence> {
  if (!profile) return "visible";
  if (isProfileTombstoned(profile)) return "gone";
  const suspended = await readSuspendedProfiles();
  return suspended.profileIds.has(profile.id) ? "withdrawn" : "visible";
}

export async function isProfileWithdrawnFromPublic(
  profile: Pick<ProfileRecord, "id" | "tombstonedAt"> | null | undefined,
): Promise<boolean> {
  return (await profilePublicPresence(profile)) === "withdrawn";
}

/** Drop suspended owners from public profile lists (search, directory, founders). */
export async function filterProfilesWithdrawnFromPublic<T extends Pick<ProfileRecord, "id" | "tombstonedAt">>(
  profiles: readonly T[],
): Promise<T[]> {
  if (profiles.length === 0) return [];
  const suspended = await readSuspendedProfiles();
  return profiles.filter(
    (profile) => isProfileTombstoned(profile) || !suspended.profileIds.has(profile.id),
  );
}

/** The normalised handles among `handles` whose profile is suspended. */
export async function withdrawnHandles(handles: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  if (keys.length === 0) return new Set();
  const suspended = await readSuspendedProfiles();
  return new Set(keys.filter((key) => suspended.handles.has(key)));
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
