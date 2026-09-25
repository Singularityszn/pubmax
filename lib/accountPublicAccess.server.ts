import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isAuthUserBannedUntil } from "@/lib/authAccountBan";
import { log } from "@/lib/log";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// Public withdrawal is a moderation fact about a LIVE profile: its owner is
// banned in Supabase auth, or its private Social account is suspended. A
// DELETED (tombstoned) profile is never withdrawn: its contributions stay
// public under the retired label (migration 0150), and `profilePublicPresence`
// answers it as `gone`. A withdrawn profile answers every handle it has worn,
// because a rename never rewrites what it authored.
//
// Migration 0157's `public_withdrawn_profiles()` answers the whole set in ONE
// round trip. When it cannot (a deploy ahead of the apply answers PGRST202),
// the failure is logged and the same rule is read directly in a few batched
// reads. Moderation never fails open: when neither read answers, the error
// reaches the caller, and a public surface refuses rather than shows.

type WithdrawnRow = { profileId: string; handle: string };

type WithdrawnProfiles = {
  profileIds: ReadonlySet<string>;
  handles: ReadonlySet<string>;
};

const memoryWithdrawnProfiles = new Map<string, readonly string[]>();

/** Test seam for keyless runs. Production ignores this map when Supabase is configured. */
export function __setMemoryProfileWithdrawn(
  profileId: string,
  withdrawn: boolean,
  previousHandles: readonly string[] = [],
): void {
  if (withdrawn) memoryWithdrawnProfiles.set(profileId, previousHandles);
  else memoryWithdrawnProfiles.delete(profileId);
}

export function __resetMemoryProfileWithdrawals(): void {
  memoryWithdrawnProfiles.clear();
}

async function readMemoryWithdrawn(): Promise<WithdrawnRow[]> {
  const rows: WithdrawnRow[] = [];
  for (const [profileId, previousHandles] of memoryWithdrawnProfiles) {
    const profile = await profileStore().getById(profileId);
    if (!profile || isProfileTombstoned(profile)) continue;
    for (const handle of [profile.handle, ...previousHandles]) rows.push({ profileId, handle });
  }
  return rows;
}

async function readWithdrawnByRpc(admin: SupabaseClient): Promise<WithdrawnRow[]> {
  const { data, error } = await admin.rpc("public_withdrawn_profiles");
  if (error) throw new Error(`${error.code ?? "rpc"}: ${error.message}`);
  return ((data ?? []) as Array<{ profile_id?: unknown; handle?: unknown }>).map((row) => ({
    profileId: String(row.profile_id ?? ""),
    handle: String(row.handle ?? ""),
  }));
}

const AUTH_USER_PAGE_SIZE = 1_000;

async function readBannedUserIds(admin: SupabaseClient): Promise<string[]> {
  const banned: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    for (const user of data.users) {
      if (isAuthUserBannedUntil(user)) banned.push(user.id);
    }
    if (data.users.length < AUTH_USER_PAGE_SIZE) return banned;
  }
}

/** The 0157 rule read directly: batched auth bans, suspended Social rows, and aliases. */
async function readWithdrawnDirect(admin: SupabaseClient): Promise<WithdrawnRow[]> {
  const bannedUserIds = await readBannedUserIds(admin);
  const [banned, suspended] = await Promise.all([
    bannedUserIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : admin
          .from("profiles")
          .select("id, handle")
          .in("user_id", bannedUserIds)
          .is("tombstoned_at", null),
    admin
      .from("private_social_accounts")
      .select("profiles!inner(id, handle, tombstoned_at)")
      .eq("ownership_state", "suspended")
      .is("profiles.tombstoned_at", null),
  ]);
  if (banned.error) throw new Error(banned.error.message);
  if (suspended.error) throw new Error(suspended.error.message);

  const rows: WithdrawnRow[] = [];
  for (const row of (banned.data ?? []) as Array<{ id?: unknown; handle?: unknown }>) {
    rows.push({ profileId: String(row.id ?? ""), handle: String(row.handle ?? "") });
  }
  for (const row of (suspended.data ?? []) as Array<{ profiles?: { id?: unknown; handle?: unknown } | null }>) {
    rows.push({ profileId: String(row.profiles?.id ?? ""), handle: String(row.profiles?.handle ?? "") });
  }

  const profileIds = [...new Set(rows.map((row) => row.profileId).filter(Boolean))];
  if (profileIds.length === 0) return rows;
  const aliases = await admin
    .from("profile_handle_aliases")
    .select("profile_id, handle")
    .in("profile_id", profileIds);
  if (aliases.error) throw new Error(aliases.error.message);
  for (const row of (aliases.data ?? []) as Array<{ profile_id?: unknown; handle?: unknown }>) {
    rows.push({ profileId: String(row.profile_id ?? ""), handle: String(row.handle ?? "") });
  }
  return rows;
}

async function readWithdrawnRows(): Promise<WithdrawnRow[]> {
  const admin = isSupabaseConfigured() ? getSupabaseAdmin() : null;
  if (!admin) return readMemoryWithdrawn();
  try {
    return await readWithdrawnByRpc(admin);
  } catch (error) {
    log("error", "account_public_access.withdrawn_rpc_failed", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return readWithdrawnDirect(admin);
  }
}

async function readWithdrawnProfiles(): Promise<WithdrawnProfiles> {
  const profileIds = new Set<string>();
  const handles = new Set<string>();
  for (const row of await readWithdrawnRows()) {
    if (row.profileId) profileIds.add(row.profileId);
    const handle = normalizeHandle(row.handle);
    if (handle) handles.add(handle);
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
