import "server-only";

import { isAuthUserBannedUntil } from "@/lib/authAccountBan";
import { isProfileTombstoned, type ProfileRecord } from "@/lib/profileStore";
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
}

async function readSupabaseEnforcement(userId: string): Promise<AccountEnforcementState> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return memoryEnforcement.get(userId) ?? { authBanned: false, socialSuspended: false };
  }

  let authBanned = false;
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data.user) {
      authBanned = isAuthUserBannedUntil(data.user);
    }
  } catch {
    authBanned = false;
  }

  let socialSuspended = false;
  try {
    const { data, error } = await admin
      .from("private_social_accounts")
      .select("ownership_state")
      .eq("supabase_user_id", userId)
      .limit(1);
    if (!error) {
      const row = (data ?? [])[0] as { ownership_state?: unknown } | undefined;
      socialSuspended = row?.ownership_state === "suspended";
    }
  } catch {
    socialSuspended = false;
  }

  return { authBanned, socialSuspended };
}

async function readAccountEnforcement(
  userId: string,
): Promise<AccountEnforcementState> {
  const trimmed = userId.trim();
  if (!trimmed) return { authBanned: false, socialSuspended: false };
  if (!isSupabaseConfigured()) {
    return memoryEnforcement.get(trimmed) ?? { authBanned: false, socialSuspended: false };
  }
  return readSupabaseEnforcement(trimmed);
}

export type ProfilePublicPresence = "visible" | "gone" | "withdrawn";

export async function profilePublicPresence(
  profile: Pick<ProfileRecord, "userId" | "tombstonedAt"> | null | undefined,
): Promise<ProfilePublicPresence> {
  if (!profile) return "visible";
  if (isProfileTombstoned(profile)) return "gone";
  const userId = profile.userId?.trim();
  if (!userId) return "visible";
  const enforcement = await readAccountEnforcement(userId);
  if (enforcement.authBanned || enforcement.socialSuspended) return "withdrawn";
  return "visible";
}

export async function isProfileWithdrawnFromPublic(
  profile: Pick<ProfileRecord, "userId" | "tombstonedAt"> | null | undefined,
): Promise<boolean> {
  return (await profilePublicPresence(profile)) === "withdrawn";
}
