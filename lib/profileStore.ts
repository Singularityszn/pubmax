// Durable profile identity. ONE interface (ProfileStore), TWO implementations —
// process-memory (dev/demo/test) and Supabase (public.profiles) — chosen at a
// single seam by the API route (isSupabaseConfigured), exactly like
// lib/pintDropsStore.ts.
//
// A profile handle becomes account-owned when `userId` is set. Migration 0071
// marks pre-existing unlinked rows as frozen legacy records. Rows created by
// `ensure` after that boundary are ephemeral, so established ensure-then-link
// flows can finish without making old self-declared handles claimable.

import { normalizeHandle } from "@/lib/profiles";
import { isReservedContributorHandle } from "@/lib/pubmaxxIdentity";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { cleanText, isHttpUrl } from "@/lib/textClean";

export type ProfileAccountLinkState =
  | "legacy_unlinked"
  | "ephemeral"
  | "account_owned";

export type ProfileRecord = {
  id: string;
  handle: string;
  // The linked Supabase Auth user id, or undefined while a legacy/demo profile
  // remains unlinked. NEVER serialized to the public /u/[handle] read. It is an
  // internal ownership key only.
  userId?: string;
  // Internal provenance for the account-link transition. Never serialized by
  // the public profile route.
  accountLinkState: ProfileAccountLinkState;
  displayName?: string;
  avatarUrl?: string;
  homeCity?: string;
  bio?: string;
  createdAt: string;
  updatedAt: string;
};

// The subset of columns a caller may set. Handle is the identity key and is
// never patchable here (renaming a handle is a different, auth-gated operation).
export type ProfilePatch = {
  displayName?: string | null;
  avatarUrl?: string | null;
  homeCity?: string | null;
  bio?: string | null;
};

export type ProfileSoftDeleteResult =
  | { status: "deleted"; profile: ProfileRecord; ownerUserId: string | null }
  | { status: "not-found" }
  | { status: "forbidden" };

// Editable-field caps — the store is the last line of defence so `update` is
// safe called directly (tests, future callers), independent of the route's own
// trust boundary. The route validates first; this cleans again, cheaply.
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_AVATAR_URL = 400;

// Cleaning is the shared cleanText (lib/textClean): strip inline HTML angle
// brackets + control chars, collapse whitespace, cap. An empty result becomes
// null so the column is cleared rather than stored as "".
function cleanField(value: string | null | undefined, cap: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanText(value, cap);
  return cleaned === "" ? null : cleaned;
}

// An avatar must be an http(s) URL within the cap, or null (cleared). Junk —
// javascript:/data: schemes, a bare string, an over-long URL — is dropped to
// null rather than stored, so nothing that isn't a real remote image URL ever
// reaches the header's <Image src>. Delegates the URL check to the shared
// isHttpUrl (lib/textClean); an invalid/empty value becomes null.
function cleanAvatar(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return isHttpUrl(value, MAX_AVATAR_URL) ?? null;
}

// Clean + cap a raw patch. Only keys present on the input survive, so an edit
// that omits a field leaves that column untouched; a present key with an empty
// or junk value clears the column (null).
function cleanPatch(patch: ProfilePatch): ProfilePatch {
  const out: ProfilePatch = {};
  if ("displayName" in patch) out.displayName = cleanField(patch.displayName, MAX_DISPLAY_NAME);
  if ("bio" in patch) out.bio = cleanField(patch.bio, MAX_BIO);
  if ("homeCity" in patch) out.homeCity = cleanField(patch.homeCity, MAX_HOME_CITY);
  if ("avatarUrl" in patch) out.avatarUrl = cleanAvatar(patch.avatarUrl);
  return out;
}

export type ProfileStore = {
  /** Read a profile by handle, or null when none exists yet. */
  getByHandle(handle: string): Promise<ProfileRecord | null>;
  /**
   * Resolve the handle linked to an auth user id, or null when no profile has
   * claimed that uid yet. Used by messaging (and similar) so an authenticated
   * caller is identified by their linked profile rather than a self-asserted
   * body handle.
   */
  getHandleByUserId(userId: string): Promise<string | null>;
  /** Read a profile by linked auth user id, or null when none exists. */
  getByUserId(userId: string): Promise<ProfileRecord | null>;
  /** Get-or-create a minimal row for a handle. Never clobbers existing fields. */
  ensure(handle: string): Promise<ProfileRecord>;
  /** Apply a patch to an existing profile. Returns null when the handle is unknown. */
  update(handle: string, patch: ProfilePatch): Promise<ProfileRecord | null>;
  /**
   * Atomically authorize and soft-delete a profile. Anonymous callers may
   * clear only a row that is still unlinked. Authenticated callers may clear
   * an unlinked row or their own linked row. Keeping ownership in the UPDATE
   * predicate prevents a concurrent account claim from being deleted after a
   * stale route-level read. The row, handle, and user_id remain so social graph
   * edges are not cascade-destroyed.
   */
  softDeleteForCaller(
    handle: string,
    callerUserId: string | null,
  ): Promise<ProfileSoftDeleteResult>;
  /**
   * Create an account-owned handle or finish an ephemeral ensure-then-link
   * flow. Repeating the same handle and user is idempotent. Frozen legacy rows
   * and different owners are unavailable.
   */
  linkUser(handle: string, userId: string): Promise<ProfileRecord>;
};

const TABLE = "profiles";

function admin() {
  return requireSupabaseAdmin();
}

// profiles (snake_case) <-> ProfileRecord (camelCase). One place so a column
// rename is a one-line change on each side.
function fromRow(row: Record<string, unknown>): ProfileRecord {
  const state = row.account_link_state;
  return {
    id: String(row.id),
    handle: String(row.handle),
    userId: row.user_id ? String(row.user_id) : undefined,
    accountLinkState:
      state === "ephemeral" || state === "account_owned"
        ? state
        : row.user_id
          ? "account_owned"
          : "legacy_unlinked",
    displayName: row.display_name ? String(row.display_name) : undefined,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    homeCity: row.home_city ? String(row.home_city) : undefined,
    bio: row.bio ? String(row.bio) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Only the columns present in `patch` are written — an absent key is left
// untouched; an explicit null clears the column. Handle/id/created_at never map.
function patchToRow(patch: ProfilePatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ("displayName" in patch) row.display_name = patch.displayName;
  if ("avatarUrl" in patch) row.avatar_url = patch.avatarUrl;
  if ("homeCity" in patch) row.home_city = patch.homeCity;
  if ("bio" in patch) row.bio = patch.bio;
  return row;
}

// A Postgres unique_violation — two concurrent ensure() inserts race on the
// handle unique index; the loser re-selects the winner's row.
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseProfileStore: ProfileStore = {
  async getByHandle(handle) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("handle", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async getHandleByUserId(userId) {
    if (!userId) return null;
    const { data, error } = await admin()
      .from(TABLE)
      .select("handle")
      .eq("user_id", userId)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as { handle?: unknown } | undefined;
    return row?.handle ? normalizeHandle(String(row.handle)) || null : null;
  },

  async getByUserId(userId) {
    const key = typeof userId === "string" ? userId.trim() : "";
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("user_id", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = await this.getByHandle(key);
    if (existing) return existing;

    const { data, error } = await admin()
      .from(TABLE)
      .insert({ handle: key, account_link_state: "ephemeral" })
      .select("*")
      .limit(1);
    if (error) {
      // Lost an insert race — the row now exists; read it back.
      if (isUniqueViolation(error)) {
        const row = await this.getByHandle(key);
        if (row) return row;
      }
      throw new Error(error.message);
    }
    return fromRow((data ?? [])[0] as Record<string, unknown>);
  },

  async update(handle, patch) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const row = patchToRow(cleanPatch(patch));
    // No writable fields in the patch → treat as a plain read so callers still
    // get the current row back without an empty UPDATE.
    if (Object.keys(row).length === 0) return this.getByHandle(key);
    row.updated_at = new Date().toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async softDeleteForCaller(handle, callerUserId) {
    const key = normalizeHandle(handle);
    if (!key) return { status: "not-found" };

    const row = patchToRow(cleanPatch({
      displayName: null,
      avatarUrl: null,
      homeCity: null,
      bio: null,
    }));
    row.updated_at = new Date().toISOString();

    let query = admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key);
    const caller = callerUserId?.trim() || null;
    query = caller
      ? query.or(`user_id.is.null,user_id.eq.${caller}`)
      : query.is("user_id", null);

    const { data, error } = await query.select("*").limit(1);
    if (error) throw new Error(error.message);
    const deleted = (data ?? [])[0];
    if (deleted) {
      const profile = fromRow(deleted as Record<string, unknown>);
      return {
        status: "deleted",
        profile,
        ownerUserId: profile.userId ?? null,
      };
    }

    const current = await this.getByHandle(key);
    return current ? { status: "forbidden" } : { status: "not-found" };
  },

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = await this.getByHandle(key);
    if (existing?.userId === userId) return existing;
    if (existing && existing.accountLinkState !== "ephemeral") {
      throw new Error("That handle is not available.");
    }
    if (await this.getByUserId(userId)) {
      throw new Error("That account already has a handle.");
    }
    const query = existing
      ? admin()
          .from(TABLE)
          .update({
            user_id: userId,
            account_link_state: "account_owned",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("account_link_state", "ephemeral")
          .is("user_id", null)
      : admin()
          .from(TABLE)
          .insert({
            handle: key,
            user_id: userId,
            account_link_state: "account_owned",
          });
    const { data, error } = await query.select("*").limit(1);
    if (error) {
      if (isUniqueViolation(error)) {
        const after = await this.getByHandle(key);
        if (after?.userId === userId) return after;
        throw new Error("That handle is not available.");
      }
      throw new Error(error.message);
    }
    const linked = (data ?? [])[0];
    if (linked) return fromRow(linked as Record<string, unknown>);
    const after = await this.getByHandle(key);
    if (after?.userId === userId) return after;
    throw new Error("That handle is not available.");
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Resets on restart — right for dev/demo/test. Keyed by normalized handle.
const memoryProfiles = new Map<string, ProfileRecord>();

// Deterministic-enough id for the memory store: handle-scoped so follows/saved
// can reference it stably within a process. Never leaves dev.
function memoryId(handle: string): string {
  return `mem-profile-${handle}`;
}

export const memoryProfileStore: ProfileStore = {
  async getByHandle(handle) {
    return memoryProfiles.get(normalizeHandle(handle)) ?? null;
  },

  async getHandleByUserId(userId) {
    if (!userId) return null;
    for (const record of memoryProfiles.values()) {
      if (record.userId === userId) return record.handle;
    }
    return null;
  },

  async getByUserId(userId) {
    const key = typeof userId === "string" ? userId.trim() : "";
    if (!key) return null;
    for (const profile of memoryProfiles.values()) {
      if (profile.userId === key) return profile;
    }
    return null;
  },

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = memoryProfiles.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const record: ProfileRecord = {
      id: memoryId(key),
      handle: key,
      accountLinkState: "ephemeral",
      createdAt: now,
      updatedAt: now,
    };
    memoryProfiles.set(key, record);
    return record;
  },

  async update(handle, rawPatch) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return null;
    const patch = cleanPatch(rawPatch);
    const next: ProfileRecord = {
      ...existing,
      ...("displayName" in patch ? { displayName: patch.displayName ?? undefined } : {}),
      ...("avatarUrl" in patch ? { avatarUrl: patch.avatarUrl ?? undefined } : {}),
      ...("homeCity" in patch ? { homeCity: patch.homeCity ?? undefined } : {}),
      ...("bio" in patch ? { bio: patch.bio ?? undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(key, next);
    return next;
  },

  async softDeleteForCaller(handle, callerUserId) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return { status: "not-found" };

    const caller = callerUserId?.trim() || null;
    if (existing.userId && existing.userId !== caller) {
      return { status: "forbidden" };
    }

    const profile: ProfileRecord = {
      ...existing,
      displayName: undefined,
      avatarUrl: undefined,
      homeCity: undefined,
      bio: undefined,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(key, profile);
    return {
      status: "deleted",
      profile,
      ownerUserId: profile.userId ?? null,
    };
  },

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = memoryProfiles.get(key);
    if (existing?.userId === userId) return existing;
    if (existing && existing.accountLinkState !== "ephemeral") {
      throw new Error("That handle is not available.");
    }
    if (await this.getByUserId(userId)) {
      throw new Error("That account already has a handle.");
    }
    const now = new Date().toISOString();
    const next: ProfileRecord = {
      ...(existing ?? { id: memoryId(key), handle: key, createdAt: now }),
      userId,
      accountLinkState: "account_owned",
      updatedAt: now,
    };
    memoryProfiles.set(key, next);
    return next;
  },
};

/** The single backend selection point (mirrors commentsStore / roundsStore). */
export function profileStore(): ProfileStore {
  return selectStore(memoryProfileStore, supabaseProfileStore);
}

/** Test-only: clear the in-memory profile map between cases. */
export function __resetMemoryProfiles(): void {
  memoryProfiles.clear();
}

/** Test-only: model a pre-0071 unlinked row after the in-memory store resets. */
export function __seedMemoryLegacyProfile(handle: string): ProfileRecord {
  const key = normalizeHandle(handle);
  if (!key) throw new Error("A profile needs a non-empty handle.");
  const now = new Date().toISOString();
  const record: ProfileRecord = {
    id: memoryId(key),
    handle: key,
    accountLinkState: "legacy_unlinked",
    createdAt: now,
    updatedAt: now,
  };
  memoryProfiles.set(key, record);
  return record;
}
