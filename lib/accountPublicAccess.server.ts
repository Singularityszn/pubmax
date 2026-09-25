import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isAuthUserBannedUntil } from "@/lib/authAccountBan";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export type AccountEnforcementState = {
  authBanned: boolean;
  socialSuspended: boolean;
};

const memoryEnforcement = new Map<string, AccountEnforcementState>();

/** Test seam for keyless runs. Production ignores this map when Supabase is configured. */
export function __setMemoryAccountEnforcement(
  userId: string,
  state: AccountEnforcementState | null,
): void {
  if (state) memoryEnforcement.set(userId, state);
  else memoryEnforcement.delete(userId);
}

export function __resetMemoryAccountEnforcement(): void {
  memoryEnforcement.clear();
  authBanMemo.clear();
}

/**
 * Public feeds ask about the same few authors on every request, and each auth
 * read is a GoTrue admin round trip, so a successful answer is held briefly per
 * process. A ban lands within this window; a failed read is never held.
 */
const AUTH_BAN_MEMO_MS = 60_000;
const AUTH_BAN_MEMO_MAX = 5_000;
const authBanMemo = new Map<string, { banned: boolean; readAt: number }>();

async function readAuthBanned(admin: SupabaseClient, userId: string): Promise<boolean> {
  const now = Date.now();
  const held = authBanMemo.get(userId);
  if (held && now - held.readAt < AUTH_BAN_MEMO_MS) return held.banned;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) return false;
    const banned = isAuthUserBannedUntil(data.user, now);
    if (authBanMemo.size >= AUTH_BAN_MEMO_MAX) authBanMemo.clear();
    authBanMemo.set(userId, { banned, readAt: now });
    return banned;
  } catch {
    return false;
  }
}

async function readSocialSuspended(
  admin: SupabaseClient,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const suspended = new Set<string>();
  try {
    const { data, error } = await admin
      .from("private_social_accounts")
      .select("supabase_user_id, ownership_state")
      .in("supabase_user_id", userIds);
    if (error) return suspended;
    for (const row of data ?? []) {
      const { supabase_user_id: id, ownership_state: state } = row as {
        supabase_user_id?: unknown;
        ownership_state?: unknown;
      };
      if (typeof id === "string" && state === "suspended") suspended.add(id);
    }
  } catch {
    // Fail-soft: treat as not suspended when the lane cannot answer.
  }
  return suspended;
}

/**
 * The withdrawn owners among `userIds`, read in one pass: one social query and
 * one auth read per distinct id, all in flight together. Callers hold the set
 * for the whole list they are deciding, so no row pays for a second read.
 */
async function readWithdrawnUserIds(userIds: readonly string[]): Promise<ReadonlySet<string>> {
  const pending = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const withdrawn = new Set<string>();
  if (pending.length === 0) return withdrawn;

  const admin = isSupabaseConfigured() ? getSupabaseAdmin() : null;
  if (!admin) {
    for (const userId of pending) {
      const state = memoryEnforcement.get(userId);
      if (state?.authBanned || state?.socialSuspended) withdrawn.add(userId);
    }
    return withdrawn;
  }

  const [suspended, banned] = await Promise.all([
    readSocialSuspended(admin, pending),
    Promise.all(pending.map((userId) => readAuthBanned(admin, userId))),
  ]);
  pending.forEach((userId, at) => {
    if (banned[at] || suspended.has(userId)) withdrawn.add(userId);
  });
  return withdrawn;
}

export type ProfilePublicPresence = "visible" | "gone" | "withdrawn";

export async function profilePublicPresence(
  profile: Pick<ProfileRecord, "userId" | "tombstonedAt"> | null | undefined,
): Promise<ProfilePublicPresence> {
  if (!profile) return "visible";
  if (isProfileTombstoned(profile)) return "gone";
  const userId = profile.userId?.trim();
  if (!userId) return "visible";
  const withdrawn = await readWithdrawnUserIds([userId]);
  return withdrawn.has(userId) ? "withdrawn" : "visible";
}

export async function isProfileWithdrawnFromPublic(
  profile: Pick<ProfileRecord, "userId" | "tombstonedAt"> | null | undefined,
): Promise<boolean> {
  return (await profilePublicPresence(profile)) === "withdrawn";
}

/** Drop banned or suspended owners from public profile lists (search, directory, founders). */
export async function filterProfilesWithdrawnFromPublic<T extends Pick<ProfileRecord, "userId" | "tombstonedAt">>(
  profiles: readonly T[],
): Promise<T[]> {
  const live = profiles.filter((profile) => !isProfileTombstoned(profile));
  const withdrawn = await readWithdrawnUserIds(live.map((profile) => profile.userId ?? ""));
  return profiles.filter(
    (profile) => isProfileTombstoned(profile) || !withdrawn.has(profile.userId?.trim() ?? ""),
  );
}

/** The normalised handles among `handles` whose owning account is banned or suspended. */
export async function withdrawnHandles(handles: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  if (keys.length === 0) return new Set();
  const owners = await profileStore().getOwnerUserIdsByHandles(keys);
  const withdrawn = await readWithdrawnUserIds([...owners.values()]);
  const out = new Set<string>();
  for (const [handle, userId] of owners) {
    if (withdrawn.has(userId)) out.add(handle);
  }
  return out;
}

/** Drop contributions whose author account is withdrawn from public view. */
export async function dropWithdrawnAuthors<T>(
  items: readonly T[],
  authorHandle: (item: T) => string | null | undefined,
): Promise<T[]> {
  if (items.length === 0) return [];
  const hidden = await withdrawnHandles(items.map((item) => authorHandle(item) ?? ""));
  if (hidden.size === 0) return [...items];
  return items.filter((item) => !hidden.has(normalizeHandle(authorHandle(item) ?? "")));
}
