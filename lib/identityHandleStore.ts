import { profileStore } from "@/lib/profileStore";
import { assessPubmaxxHandle, evaluateHandleRename } from "@/lib/pubmaxxIdentity";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

export type HandleAvailability = {
  handle: string;
  available: boolean;
  reason?: "taken";
};

export type HandleClaimResult =
  | { ok: true; profileId: string; handle: string; claimed: true }
  | { ok: false; code: "taken" | "already_has_handle" | "storage"; error: string };

export type HandleRenameResult =
  | { ok: true; profileId: string; previousHandle: string; handle: string }
  | { ok: false; code: "not_found" | "taken" | "cooldown" | "storage"; error: string; retryAt?: string };

export type HandleResolution = {
  profileId: string;
  requestedHandle: string;
  currentHandle: string;
  redirect: boolean;
};

export type IdentityHandleStore = {
  availability(handle: string): Promise<HandleAvailability>;
  claim(ownerId: string, handle: string): Promise<HandleClaimResult>;
  rename(ownerId: string, handle: string): Promise<HandleRenameResult>;
  resolve(handle: string): Promise<HandleResolution | null>;
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
    return {
      ok: true,
      profileId: String(row.profile_id),
      handle: String(row.handle),
      claimed: true,
    };
  }
  const code = row.code === "already_has_handle" ? "already_has_handle" : row.code === "taken" ? "taken" : "storage";
  return { ok: false, code, error: String(row.error ?? "Profile storage is unavailable.") };
}

export const memoryIdentityHandleStore: IdentityHandleStore = {
  async availability(handle) {
    if (memoryAliases.has(handle)) return { handle, available: false, reason: "taken" };
    const legacy = await profileStore().getByHandle(handle);
    return legacy?.userId
      ? { handle, available: false, reason: "taken" }
      : { handle, available: true };
  },

  async claim(ownerId, handle) {
    const owned = currentByOwner.get(ownerId);
    if (owned) {
      if (owned.currentHandle === handle) {
        return { ok: true, profileId: owned.profileId, handle, claimed: true };
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
    try {
      const profiles = profileStore();
      const existingOwner = await profiles.getByUserId(ownerId);
      if (existingOwner && existingOwner.handle !== handle) {
        const alias: MemoryAlias = {
          profileId: existingOwner.id,
          ownerId,
          handle: existingOwner.handle,
          currentHandle: existingOwner.handle,
          isCurrent: true,
        };
        memoryAliases.set(existingOwner.handle, alias);
        currentByOwner.set(ownerId, alias);
        return {
          ok: false,
          code: "already_has_handle",
          error: `Your PUBMAXX handle is @${existingOwner.handle}. Rename it instead.`,
        };
      }
      const existingHandle = await profiles.getByHandle(handle);
      if (existingHandle?.userId && existingHandle.userId !== ownerId) {
        return { ok: false, code: "taken", error: "That handle is already taken." };
      }
      const profile = await profiles.linkUser(handle, ownerId);
      const alias: MemoryAlias = {
        profileId: profile.id,
        ownerId,
        handle,
        currentHandle: handle,
        isCurrent: true,
      };
      memoryAliases.set(handle, alias);
      currentByOwner.set(ownerId, alias);
      return { ok: true, profileId: profile.id, handle, claimed: true };
    } catch {
      return { ok: false, code: "storage", error: "Profile storage is unavailable." };
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
      return {
        profileId: alias.profileId,
        requestedHandle: handle,
        currentHandle: alias.currentHandle,
        redirect: handle !== alias.currentHandle,
      };
    }
    const profile = await profileStore().getByHandle(handle);
    return profile
      ? { profileId: profile.id, requestedHandle: handle, currentHandle: profile.handle, redirect: false }
      : null;
  },
};

export const supabaseIdentityHandleStore: IdentityHandleStore = {
  async availability(handle) {
    const { data, error } = await requireSupabaseAdmin()
      .from("profile_handle_aliases")
      .select("profile_id,is_current")
      .eq("handle", handle)
      .limit(1);
    if (error) throw new Error(error.message);
    const alias = (data ?? [])[0] as
      | { profile_id?: unknown; is_current?: unknown }
      | undefined;
    if (!alias?.profile_id) return { handle, available: true };
    if (alias.is_current !== true) {
      return { handle, available: false, reason: "taken" };
    }
    const { data: profiles, error: profileError } = await requireSupabaseAdmin()
      .from("profiles")
      .select("user_id")
      .eq("id", String(alias.profile_id))
      .limit(1);
    if (profileError) throw new Error(profileError.message);
    const profile = (profiles ?? [])[0] as { user_id?: unknown } | undefined;
    return profile?.user_id
      ? { handle, available: false, reason: "taken" }
      : { handle, available: true };
  },

  async claim(ownerId, handle) {
    const { data, error } = await requireSupabaseAdmin().rpc("claim_pubmaxx_handle", {
      p_user_id: ownerId,
      p_handle: handle,
    });
    if (error) return { ok: false, code: "storage", error: "Profile storage is unavailable." };
    return rpcClaim(handleFromRpc(data));
  },

  async rename(ownerId, handle) {
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
    if (!alias?.profile_id) return null;
    const { data: profiles, error: profileError } = await requireSupabaseAdmin()
      .from("profiles")
      .select("handle")
      .eq("id", String(alias.profile_id))
      .limit(1);
    if (profileError) throw new Error(profileError.message);
    const current = (profiles ?? [])[0] as { handle?: unknown } | undefined;
    if (!current?.handle) return null;
    return {
      profileId: String(alias.profile_id),
      requestedHandle: handle,
      currentHandle: String(current.handle),
      redirect: handle !== String(current.handle),
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
