// Durable profile identity. ONE interface (ProfileStore), TWO implementations —
// process-memory (dev/demo/test) and Supabase (public.profiles) — chosen at a
// single seam by the API route (isSupabaseConfigured), exactly like
// lib/pintDropsStore.ts.
//
// Identity is still the self-asserted `handle` (no auth yet — profiles.user_id
// is reserved for a future Supabase Auth link, see migration 0006). A profile
// row is created lazily the first time a handle drops a pint (ensure), and the
// public /u/[handle] page overlays any stored display_name/bio/etc on top of the
// stats it derives from that handle's drops. Nothing here overwrites a
// user-edited field on a repeat drop — ensure only fills a row in, update is the
// only path that changes existing columns.

import { normalizeHandle } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase";

export type ProfileRecord = {
  id: string;
  handle: string;
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

export type ProfileStore = {
  /** Read a profile by handle, or null when none exists yet. */
  getByHandle(handle: string): Promise<ProfileRecord | null>;
  /** Get-or-create a minimal row for a handle. Never clobbers existing fields. */
  ensure(handle: string): Promise<ProfileRecord>;
  /** Apply a patch to an existing profile. Returns null when the handle is unknown. */
  update(handle: string, patch: ProfilePatch): Promise<ProfileRecord | null>;
};

const TABLE = "profiles";

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// profiles (snake_case) <-> ProfileRecord (camelCase). One place so a column
// rename is a one-line change on each side.
function fromRow(row: Record<string, unknown>): ProfileRecord {
  return {
    id: String(row.id),
    handle: String(row.handle),
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

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = await this.getByHandle(key);
    if (existing) return existing;

    const { data, error } = await admin()
      .from(TABLE)
      .insert({ handle: key })
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
    const row = patchToRow(patch);
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

  async ensure(handle) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    const existing = memoryProfiles.get(key);
    if (existing) return existing;
    const now = new Date().toISOString();
    const record: ProfileRecord = { id: memoryId(key), handle: key, createdAt: now, updatedAt: now };
    memoryProfiles.set(key, record);
    return record;
  },

  async update(handle, patch) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return null;
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
};

/** Test-only: clear the in-memory profile map between cases. */
export function __resetMemoryProfiles(): void {
  memoryProfiles.clear();
}
