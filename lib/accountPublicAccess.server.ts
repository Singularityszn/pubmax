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
// round trip, held for a minute per process. When it cannot (a deploy ahead of
// the apply answers PGRST202), the miss is logged once a minute and the same
// rule is read directly for the profiles in question only, with each owner's
// auth ban held for a minute. Moderation never fails open: when neither read
// answers, the error reaches the caller, and a public surface refuses rather
// than shows. A failed read is never held.

type WithdrawnRow = { profileId: string; handle: string };

type WithdrawnProfiles = {
  profileIds: ReadonlySet<string>;
  handles: ReadonlySet<string>;
};

/** The profiles a caller is deciding, by id or by any handle they wear. */
type WithdrawnQuery = {
  profileIds?: readonly string[];
  handles?: readonly string[];
};

const WITHDRAWN_HOLD_MS = 60_000;
const AUTH_BAN_HOLD_MAX = 5_000;

let heldRpcRows: { rows: WithdrawnRow[]; readAt: number } | null = null;
let rpcMissedAt: number | null = null;
const heldAuthBans = new Map<string, { banned: boolean; readAt: number }>();

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
  heldRpcRows = null;
  rpcMissedAt = null;
  heldAuthBans.clear();
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

type Answer = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

async function rowsOf<T>(answer: Answer): Promise<T[]> {
  const { data, error } = await answer;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

async function readAuthBanned(admin: SupabaseClient, userId: string, now: number): Promise<boolean> {
  const held = heldAuthBans.get(userId);
  if (held && now - held.readAt < WITHDRAWN_HOLD_MS) return held.banned;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  const banned = isAuthUserBannedUntil(data.user, now);
  if (heldAuthBans.size >= AUTH_BAN_HOLD_MAX) heldAuthBans.clear();
  heldAuthBans.set(userId, { banned, readAt: now });
  return banned;
}

type ProfileRow = { id: string; handle: string; user_id: string | null };

/** The 0157 rule read directly, for the profiles in question only. */
async function readWithdrawnDirect(
  admin: SupabaseClient,
  query: WithdrawnQuery,
  now: number,
): Promise<WithdrawnRow[]> {
  const handles = query.handles ?? [];
  const aliasHits = handles.length === 0
    ? []
    : await rowsOf<{ profile_id: string; handle: string }>(
        admin.from("profile_handle_aliases").select("profile_id, handle").in("handle", handles),
      );
  const ids = [...new Set([...(query.profileIds ?? []), ...aliasHits.map((row) => row.profile_id)])];
  const [byHandle, byId] = await Promise.all([
    handles.length === 0
      ? []
      : rowsOf<ProfileRow>(
          admin.from("profiles").select("id, handle, user_id").in("handle", handles).is("tombstoned_at", null),
        ),
    ids.length === 0
      ? []
      : rowsOf<ProfileRow>(
          admin.from("profiles").select("id, handle, user_id").in("id", ids).is("tombstoned_at", null),
        ),
  ]);
  const profiles = [...new Map([...byHandle, ...byId].map((row) => [row.id, row])).values()];
  if (profiles.length === 0) return [];

  const [suspended, banned] = await Promise.all([
    rowsOf<{ profile_id: string }>(
      admin
        .from("private_social_accounts")
        .select("profile_id")
        .eq("ownership_state", "suspended")
        .in("profile_id", profiles.map((profile) => profile.id)),
    ),
    Promise.all(
      profiles.map((profile) =>
        profile.user_id ? readAuthBanned(admin, profile.user_id, now) : false,
      ),
    ),
  ]);
  const suspendedIds = new Set(suspended.map((row) => row.profile_id));
  const withdrawnIds = new Set(
    profiles
      .filter((profile, at) => banned[at] || suspendedIds.has(profile.id))
      .map((profile) => profile.id),
  );

  return [
    ...profiles.filter((profile) => withdrawnIds.has(profile.id)),
    ...aliasHits
      .filter((row) => withdrawnIds.has(row.profile_id))
      .map((row) => ({ id: row.profile_id, handle: row.handle })),
  ].map((row) => ({ profileId: row.id, handle: row.handle }));
}

async function readWithdrawnRows(query: WithdrawnQuery): Promise<WithdrawnRow[]> {
  const admin = isSupabaseConfigured() ? getSupabaseAdmin() : null;
  if (!admin) return readMemoryWithdrawn();
  const now = Date.now();
  if (heldRpcRows && now - heldRpcRows.readAt < WITHDRAWN_HOLD_MS) return heldRpcRows.rows;
  if (rpcMissedAt === null || now - rpcMissedAt >= WITHDRAWN_HOLD_MS) {
    try {
      const rows = await readWithdrawnByRpc(admin);
      heldRpcRows = { rows, readAt: now };
      rpcMissedAt = null;
      return rows;
    } catch (error) {
      rpcMissedAt = now;
      log("error", "account_public_access.withdrawn_rpc_failed", {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return readWithdrawnDirect(admin, query, now);
}

async function readWithdrawnProfiles(query: WithdrawnQuery): Promise<WithdrawnProfiles> {
  const profileIds = new Set<string>();
  const handles = new Set<string>();
  for (const row of await readWithdrawnRows(query)) {
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
  const withdrawn = await readWithdrawnProfiles({ profileIds: [profile.id] });
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
  const live = profiles.filter((profile) => !isProfileTombstoned(profile));
  if (live.length === 0) return [...profiles];
  const withdrawn = await readWithdrawnProfiles({ profileIds: live.map((profile) => profile.id) });
  return profiles.filter(
    (profile) => isProfileTombstoned(profile) || !withdrawn.profileIds.has(profile.id),
  );
}

/** The normalised handles among `handles` whose live profile is withdrawn. */
export async function withdrawnHandles(handles: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  if (keys.length === 0) return new Set();
  const withdrawn = await readWithdrawnProfiles({ handles: keys });
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
