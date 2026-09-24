import "server-only";

import { cache } from "react";

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

async function readSupabaseAuthBanned(userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return memoryEnforcement.get(userId)?.authBanned ?? false;
  }
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data.user) {
      return isAuthUserBannedUntil(data.user);
    }
  } catch {
    return false;
  }
  return false;
}

class AccountEnforcementLookup {
  private readonly byUserId = new Map<string, AccountEnforcementState>();

  async ensure(userIds: readonly string[]): Promise<void> {
    const pending = userIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && !this.byUserId.has(id));
    if (pending.length === 0) return;

    if (!isSupabaseConfigured()) {
      for (const userId of pending) {
        this.byUserId.set(
          userId,
          memoryEnforcement.get(userId) ?? { authBanned: false, socialSuspended: false },
        );
      }
      return;
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      for (const userId of pending) {
        this.byUserId.set(
          userId,
          memoryEnforcement.get(userId) ?? { authBanned: false, socialSuspended: false },
        );
      }
      return;
    }

    const socialByUser = new Map<string, boolean>();
    try {
      const { data, error } = await admin
        .from("private_social_accounts")
        .select("supabase_user_id, ownership_state")
        .in("supabase_user_id", pending);
      if (!error) {
        for (const row of data ?? []) {
          const id = String((row as { supabase_user_id?: unknown }).supabase_user_id ?? "");
          if (!id) continue;
          socialByUser.set(
            id,
            (row as { ownership_state?: unknown }).ownership_state === "suspended",
          );
        }
      }
    } catch {
      // Fail-soft: treat as not suspended when the lane cannot answer.
    }

    await Promise.all(
      pending.map(async (userId) => {
        const authBanned = await readSupabaseAuthBanned(userId);
        const socialSuspended = socialByUser.get(userId) ?? false;
        this.byUserId.set(userId, { authBanned, socialSuspended });
      }),
    );
  }

  stateFor(userId: string): AccountEnforcementState {
    const trimmed = userId.trim();
    if (!trimmed) return { authBanned: false, socialSuspended: false };
    return (
      this.byUserId.get(trimmed) ??
      memoryEnforcement.get(trimmed) ?? { authBanned: false, socialSuspended: false }
    );
  }
}

const enforcementLookup = cache((): AccountEnforcementLookup => new AccountEnforcementLookup());

async function readAccountEnforcement(userId: string): Promise<AccountEnforcementState> {
  const trimmed = userId.trim();
  if (!trimmed) return { authBanned: false, socialSuspended: false };
  const lookup = enforcementLookup();
  await lookup.ensure([trimmed]);
  return lookup.stateFor(trimmed);
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

/** Drop banned or suspended owners from public profile lists (search, directory, founders). */
export async function filterProfilesWithdrawnFromPublic<T extends Pick<ProfileRecord, "userId" | "tombstonedAt">>(
  profiles: readonly T[],
): Promise<T[]> {
  if (profiles.length === 0) return [];
  const userIds = profiles
    .map((profile) => profile.userId?.trim() ?? "")
    .filter((userId) => userId.length > 0);
  await enforcementLookup().ensure(userIds);
  const kept: T[] = [];
  for (const profile of profiles) {
    if (!(await isProfileWithdrawnFromPublic(profile))) kept.push(profile);
  }
  return kept;
}
