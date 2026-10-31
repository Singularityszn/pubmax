import "server-only";

import { parseFoundingMemberNumber } from "@/lib/foundingMembers";
import { isProfileWithdrawnFromPublic } from "@/lib/accountPublicAccess.server";
import { isProfileTombstoned, profileStore } from "@/lib/profileStore";
import {
  assessPubmaxxHandle,
  evaluateHandleRename,
  isReservedContributorHandle,
} from "@/lib/pubmaxxIdentity";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { admin as storeAdmin, selectStore } from "@/lib/storeBackend";

type HandleAvailability = {
  handle: string;
  available: boolean;
  reason?: "taken";
};

type HandleClaimResult =
  | {
      ok: true;
      profileId: string;
      handle: string;
      claimed: true;
      /**
       * The founding number this claim was granted, when the cohort still had
       * room. Absent means the first hundred are already spoken for, which is
       * the ordinary case and never an error.
       */
      foundingMemberNumber?: number;
    }
  | { ok: false; code: "taken" | "already_has_handle" | "storage"; error: string };

type HandleRenameResult =
  | { ok: true; profileId: string; previousHandle: string; handle: string }
  | { ok: false; code: "not_found" | "taken" | "cooldown" | "storage"; error: string; retryAt?: string };

/**
 * Live resolution or a reserved tombstone.
 * Gone is gated strictly on `profiles.tombstoned_at` (auth-deletion trigger).
 * A null `user_id` alone is NOT a tombstone: production still holds live
 * legacy anonymous-era handles with user_id null. The handle stays reserved
 * either way so attribution attacks cannot reclaim it.
 */
/**
 * Every handle one account has worn, found from any one of them. A Pint Drop
 * keeps the handle text it was posted under, so an author read matches all of
 * these. The alias table holds each handle once, for one profile, for ever,
 * so a handle here can never also belong to a different account.
 */
export type WornHandles = {
  currentHandle: string;
  handles: string[];
};

type HandleResolution = {
  profileId: string;
  requestedHandle: string;
  currentHandle: string;
  redirect: boolean;
  status: "live" | "gone";
};

export type IdentityHandleStore = {
  aliasProfileId(handle: string): Promise<string | null>;
  availability(handle: string): Promise<HandleAvailability>;
  claim(ownerId: string, handle: string): Promise<HandleClaimResult>;
  rename(ownerId: string, handle: string): Promise<HandleRenameResult>;
  resolve(handle: string): Promise<HandleResolution | null>;
  ownedHandle(
    ownerId: string,
    handles: readonly string[],
  ): Promise<string | null>;
  /** Null when no account holds the handle in the alias history. */
  wornHandles(handle: string): Promise<WornHandles | null>;
};

type MemoryAlias = {
  profileId: string;
  ownerId: string;
  handle: string;
  currentHandle: string;
  isCurrent: boolean;
  changedAt?: string;
};

const memoryAliases = new Map<string, MemoryAlias>();
const currentByOwner = new Map<string, MemoryAlias>();

function handleFromRpc(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) return (data[0] ?? {}) as Record<string, unknown>;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function rpcClaim(row: Record<string, unknown>): HandleClaimResult {
  if (row.ok === true) {
    const founding = parseFoundingMemberNumber(row.founding_member_number);
    return {
      ok: true,
      profileId: String(row.profile_id),
      handle: String(row.handle),
      claimed: true,
      ...(founding === null ? {} : { foundingMemberNumber: founding }),
    };
  }
  const code = row.code === "already_has_handle" ? "already_has_handle" : row.code === "taken" ? "taken" : "storage";
  return { ok: false, code, error: String(row.error ?? "Profile storage is unavailable.") };
}

export const memoryIdentityHandleStore: IdentityHandleStore = {
  async aliasProfileId(handle) {
    return memoryAliases.get(handle)?.profileId ?? null;
  },
  async availability(handle) {
    if (isReservedContributorHandle(handle)) {
      return { handle, available: false, reason: "taken" };
    }
    if (await this.aliasProfileId(handle)) return { handle, available: false, reason: "taken" };
    const profile = await profileStore().getByHandle(handle);
    return profile
      ? { handle, available: false, reason: "taken" }
      : { handle, available: true };
  },

  async claim(ownerId, handle) {
    if (isReservedContributorHandle(handle)) {
      return { ok: false, code: "taken", error: "That handle is not available." };
    }
    const owned = currentByOwner.get(ownerId);
    if (owned) {
      if (owned.currentHandle === handle) {
        const held = await profileStore().getByHandle(handle);
        return {
          ok: true,
          profileId: owned.profileId,
          handle,
          claimed: true,
          ...(held?.foundingMemberNumber === undefined
            ? {}
            : { foundingMemberNumber: held.foundingMemberNumber }),
        };
      }
      return {
        ok: false,
        code: "already_has_handle",
        error: `Your PUBMAXX handle is @${owned.currentHandle}. Rename it instead.`,
      };
    }
    const collision = memoryAliases.get(handle);
    if (collision && collision.ownerId !== ownerId) {
      return { ok: false, code: "taken", error: "That handle is already taken." };
    }
    const profiles = profileStore();
    try {
      const existingOwner = await profiles.getByUserId(ownerId);
      if (existingOwner) {
        const alias: MemoryAlias = {
          profileId: existingOwner.id,
          ownerId,
          handle: existingOwner.handle,
          currentHandle: existingOwner.handle,
          isCurrent: true,
        };
        memoryAliases.set(existingOwner.handle, alias);
        currentByOwner.set(ownerId, alias);
        if (existingOwner.handle === handle) {
          return {
            ok: true,
            profileId: existingOwner.id,
            handle,
            claimed: true,
            ...(existingOwner.foundingMemberNumber === undefined
              ? {}
              : { foundingMemberNumber: existingOwner.foundingMemberNumber }),
          };
        }
        return {
          ok: false,
          code: "already_has_handle",
          error: `Your PUBMAXX handle is @${existingOwner.handle}. Rename it instead.`,
        };
      }
      const existingHandle = await profiles.getByHandle(handle);
      if (existingHandle) {
        return { ok: false, code: "taken", error: "That handle is already taken." };
      }
      const profile = await profiles.createOwned(handle, ownerId);
      const alias: MemoryAlias = {
        profileId: profile.id,
        ownerId,
        handle,
        currentHandle: handle,
        isCurrent: true,
      };
      memoryAliases.set(handle, alias);
      currentByOwner.set(ownerId, alias);
      return {
        ok: true,
        profileId: profile.id,
        handle,
        claimed: true,
        ...(profile.foundingMemberNumber === undefined
          ? {}
          : { foundingMemberNumber: profile.foundingMemberNumber }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already has a handle/i.test(message)) {
        const current = await profiles.getByUserId(ownerId);
        return {
          ok: false,
          code: "already_has_handle",
          error: current
            ? `Your PUBMAXX handle is @${current.handle}. Rename it instead.`
            : "Your account already has a PUBMAXX handle. Rename it instead.",
        };
      }
      return /not available/i.test(message)
        ? { ok: false, code: "taken", error: "That handle is already taken." }
        : { ok: false, code: "storage", error: "Profile storage is unavailable." };
    }
  },

  async rename(ownerId, handle) {
    let owned = currentByOwner.get(ownerId);
    if (!owned) {
      const profile = await profileStore().getByUserId(ownerId);
      if (!profile) return { ok: false, code: "not_found", error: "Claim a PUBMAXX handle first." };
      owned = {
        profileId: profile.id,
        ownerId,
        handle: profile.handle,
        currentHandle: profile.handle,
        isCurrent: true,
      };
      memoryAliases.set(profile.handle, owned);
      currentByOwner.set(ownerId, owned);
    }
    if (owned.currentHandle === handle) {
      return { ok: true, profileId: owned.profileId, previousHandle: handle, handle };
    }
    if (isReservedContributorHandle(handle)) {
      return { ok: false, code: "taken", error: "That handle is not available." };
    }
    const decision = evaluateHandleRename({ changedAt: owned.changedAt });
    if (!decision.allowed) {
      return {
        ok: false,
        code: "cooldown",
        error: "You can rename your handle once every 30 days.",
        retryAt: decision.retryAt,
      };
    }
    if (memoryAliases.has(handle) || (await profileStore().getByHandle(handle))) {
      return { ok: false, code: "taken", error: "That handle is already taken." };
    }
    const previousHandle = owned.currentHandle;
    const changedAt = new Date().toISOString();
    const retired = { ...owned, isCurrent: false, currentHandle: handle, changedAt };
    const current: MemoryAlias = {
      ...owned,
      handle,
      currentHandle: handle,
      isCurrent: true,
      changedAt,
    };
    memoryAliases.set(previousHandle, retired);
    memoryAliases.set(handle, current);
    currentByOwner.set(ownerId, current);
    return { ok: true, profileId: owned.profileId, previousHandle, handle };
  },

  async resolve(handle) {
    const alias = memoryAliases.get(handle);
    if (alias) {
      // Memory rename keeps aliases but may not move the profiles.handle
      // column; prefer owner lookup so a live rename still resolves.
      const current =
        (await profileStore().getByHandle(alias.currentHandle)) ??
        (await profileStore().getByUserId(alias.ownerId)) ??
        (await profileStore().getByHandle(handle));
      if (!current) return null;
      // Auth-deletion stamp only — legacy user_id null stays live.
      if (await isProfileWithdrawnFromPublic(current)) return null;
      if (isProfileTombstoned(current)) {
        return {
          profileId: alias.profileId,
          requestedHandle: handle,
          currentHandle: alias.currentHandle,
          redirect: false,
          status: "gone",
        };
      }
      return {
        profileId: alias.profileId,
        requestedHandle: handle,
        currentHandle: alias.currentHandle,
        redirect: handle !== alias.currentHandle,
        status: "live",
      };
    }
    const profile = await profileStore().getByHandle(handle);
    if (!profile) return null;
    if (await isProfileWithdrawnFromPublic(profile)) return null;
    if (isProfileTombstoned(profile)) {
      return {
        profileId: profile.id,
        requestedHandle: handle,
        currentHandle: profile.handle,
        redirect: false,
        status: "gone",
      };
    }
    return {
      profileId: profile.id,
      requestedHandle: handle,
      currentHandle: profile.handle,
      redirect: false,
      status: "live",
    };
  },

  async ownedHandle(ownerId, handles) {
    const candidates = new Set(handles);
    if (candidates.size === 0) return null;
    const owned = currentByOwner.get(ownerId);
    if (owned) {
      for (const handle of candidates) {
        if (memoryAliases.get(handle)?.profileId === owned.profileId) {
          return handle;
        }
      }
    }
    const profile = await profileStore().getByUserId(ownerId);
    if (!profile) return null;
    if (candidates.has(profile.handle)) return profile.handle;
    for (const handle of candidates) {
      if (memoryAliases.get(handle)?.profileId === profile.id) return handle;
    }
    return null;
  },

  async wornHandles(handle) {
    const alias = memoryAliases.get(handle);
    if (!alias) return null;
    const handles: string[] = [];
    let currentHandle = alias.currentHandle;
    for (const [worn, entry] of memoryAliases) {
      if (entry.profileId !== alias.profileId) continue;
      handles.push(worn);
      if (entry.isCurrent) currentHandle = worn;
    }
    return { currentHandle, handles: handles.sort() };
  },
};

export const supabaseIdentityHandleStore: IdentityHandleStore = {
  async aliasProfileId(handle) {
    const { data, error } = await requireSupabaseAdmin()
      .from("profile_handle_aliases")
      .select("profile_id")
      .eq("handle", handle)
      .limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.profile_id ? String(data[0].profile_id) : null;
  },
  async availability(handle) {
    if (isReservedContributorHandle(handle)) {
      return { handle, available: false, reason: "taken" };
    }
    const admin = requireSupabaseAdmin();
    if (await this.aliasProfileId(handle)) {
      return { handle, available: false, reason: "taken" };
    }
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("handle", handle)
      .limit(1);
    if (profileError) throw new Error(profileError.message);
    return (profiles ?? []).length > 0
      ? { handle, available: false, reason: "taken" }
      : { handle, available: true };
  },

  async claim(ownerId, handle) {
    if (isReservedContributorHandle(handle)) {
      return { ok: false, code: "taken", error: "That handle is not available." };
    }
    const { data, error } = await requireSupabaseAdmin().rpc("claim_pubmaxx_handle", {
      p_user_id: ownerId,
      p_handle: handle,
    });
    if (error) return { ok: false, code: "storage", error: "Profile storage is unavailable." };
    return rpcClaim(handleFromRpc(data));
  },

  async rename(ownerId, handle) {
    const current = await profileStore().getByUserId(ownerId);
    if (current?.handle === handle) {
      return {
        ok: true,
        profileId: current.id,
        previousHandle: current.handle,
        handle: current.handle,
      };
    }
    if (isReservedContributorHandle(handle)) {
      return { ok: false, code: "taken", error: "That handle is not available." };
    }
    const { data, error } = await requireSupabaseAdmin().rpc("rename_pubmaxx_handle", {
      p_user_id: ownerId,
      p_handle: handle,
    });
    if (error) return { ok: false, code: "storage", error: "Profile storage is unavailable." };
    const row = handleFromRpc(data);
    if (row.ok === true) {
      return {
        ok: true,
        profileId: String(row.profile_id),
        previousHandle: String(row.previous_handle),
        handle: String(row.handle),
      };
    }
    const code = row.code;
    return {
      ok: false,
      code: code === "not_found" || code === "taken" || code === "cooldown" ? code : "storage",
      error: String(row.error ?? "Profile storage is unavailable."),
      ...(typeof row.retry_at === "string" ? { retryAt: row.retry_at } : {}),
    };
  },

  async resolve(handle) {
    const { data: aliases, error } = await requireSupabaseAdmin()
      .from("profile_handle_aliases")
      .select("profile_id,is_current")
      .eq("handle", handle)
      .limit(1);
    if (error) throw new Error(error.message);
    const alias = (aliases ?? [])[0] as { profile_id?: unknown; is_current?: unknown } | undefined;
    if (alias?.profile_id) {
      const { data: profiles, error: profileError } = await requireSupabaseAdmin()
        .from("profiles")
        .select("handle,user_id,tombstoned_at")
        .eq("id", String(alias.profile_id))
        .limit(1);
      if (profileError) throw new Error(profileError.message);
      const current = (profiles ?? [])[0] as
        | { handle?: unknown; user_id?: unknown; tombstoned_at?: unknown }
        | undefined;
      if (!current?.handle) return null;
      const currentHandle = String(current.handle);
      // Gone only when auth-deletion stamped tombstoned_at. user_id null alone
      // is a live legacy row.
      if (await isProfileWithdrawnFromPublic({ id: String(alias.profile_id), handle: currentHandle, tombstonedAt: current.tombstoned_at ? String(current.tombstoned_at) : undefined })) return null;
      if (current.tombstoned_at) {
        return {
          profileId: String(alias.profile_id),
          requestedHandle: handle,
          currentHandle,
          redirect: false,
          status: "gone",
        };
      }
      return {
        profileId: String(alias.profile_id),
        requestedHandle: handle,
        currentHandle,
        redirect: handle !== currentHandle,
        status: "live",
      };
    }
    // Alias miss: fall back to the profiles row so a pre-alias handle still
    // resolves, and an explicit tombstone still answers gone.
    const { data: rows, error: profileError } = await requireSupabaseAdmin()
      .from("profiles")
      .select("id,handle,user_id,tombstoned_at")
      .eq("handle", handle)
      .limit(1);
    if (profileError) throw new Error(profileError.message);
    const row = (rows ?? [])[0] as
      | { id?: unknown; handle?: unknown; user_id?: unknown; tombstoned_at?: unknown }
      | undefined;
    if (!row?.id || !row.handle) return null;
    if (await isProfileWithdrawnFromPublic({ id: String(row.id), handle: String(row.handle), tombstonedAt: row.tombstoned_at ? String(row.tombstoned_at) : undefined })) return null;
    if (row.tombstoned_at) {
      return {
        profileId: String(row.id),
        requestedHandle: handle,
        currentHandle: String(row.handle),
        redirect: false,
        status: "gone",
      };
    }
    return {
      profileId: String(row.id),
      requestedHandle: handle,
      currentHandle: String(row.handle),
      redirect: false,
      status: "live",
    };
  },

  async ownedHandle(ownerId, handles) {
    const candidates = [...new Set(handles)];
    if (!ownerId || candidates.length === 0) return null;
    const { data: profiles, error: profileError } =
      await requireSupabaseAdmin()
        .from("profiles")
        .select("id,handle")
        .eq("user_id", ownerId)
        .limit(1);
    if (profileError) throw new Error(profileError.message);
    const profile = (profiles ?? [])[0] as
      | { id?: unknown; handle?: unknown }
      | undefined;
    if (!profile?.id) return null;
    const current =
      typeof profile.handle === "string" ? profile.handle : "";
    if (current && candidates.includes(current)) return current;
    const { data: aliases, error } = await requireSupabaseAdmin()
      .from("profile_handle_aliases")
      .select("handle")
      .eq("profile_id", String(profile.id))
      .in("handle", candidates)
      .limit(1);
    if (error) throw new Error(error.message);
    const alias = (aliases ?? [])[0] as { handle?: unknown } | undefined;
    return typeof alias?.handle === "string" ? alias.handle : null;
  },

  async wornHandles(handle) {
    // Read through the store seam, the same client the Pint Drop author reads use.
    const admin = storeAdmin();
    const { data: held, error } = await admin
      .from("profile_handle_aliases")
      .select("profile_id")
      .eq("handle", handle)
      .limit(1);
    if (error) throw new Error(error.message);
    const profileId = ((held ?? [])[0] as { profile_id?: unknown } | undefined)?.profile_id;
    if (typeof profileId !== "string" || !profileId) return null;
    const { data: worn, error: wornError } = await admin
      .from("profile_handle_aliases")
      .select("handle,is_current")
      .eq("profile_id", profileId)
      .limit(100);
    if (wornError) throw new Error(wornError.message);
    const rows = (worn ?? []) as { handle?: unknown; is_current?: unknown }[];
    const handles = rows.flatMap((row) => (typeof row.handle === "string" && row.handle ? [row.handle] : []));
    if (!handles.includes(handle)) handles.push(handle);
    const current = rows.find((row) => row.is_current === true && typeof row.handle === "string");
    return {
      currentHandle: typeof current?.handle === "string" ? current.handle : handle,
      handles: handles.sort(),
    };
  },
};

export function identityHandleStore(): IdentityHandleStore {
  return selectStore(memoryIdentityHandleStore, supabaseIdentityHandleStore);
}

export function __resetMemoryIdentityHandles(): void {
  memoryAliases.clear();
  currentByOwner.clear();
}

export function validateHandleForStore(raw: unknown) {
  return assessPubmaxxHandle(raw);
}
