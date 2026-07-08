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
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { cleanText, isHttpUrl } from "@/lib/textClean";

export type ProfileRecord = {
  id: string;
  handle: string;
  // The linked Supabase Auth user id, or undefined when the handle is still an
  // unlinked (demo / anonymous) identity. Set once on first authenticated touch
  // (see linkUser) — this is what makes a handle un-hijackable (see
  // lib/profileOwnership.ts + migration 0009). NEVER serialized to the public
  // /u/[handle] read — it is an internal ownership key only.
  userId?: string;
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
  /** Get-or-create a minimal row for a handle. Never clobbers existing fields. */
  ensure(handle: string): Promise<ProfileRecord>;
  /** Apply a patch to an existing profile. Returns null when the handle is unknown. */
  update(handle: string, patch: ProfilePatch): Promise<ProfileRecord | null>;
  /**
   * Link an authenticated user id onto a handle's row (account migration, story
   * 32): ensures the row exists, then stamps user_id when it is unset. Idempotent
   * — re-linking the SAME user is a no-op that returns the row; attempting to
   * re-link a row already owned by a DIFFERENT user throws (the ownership check
   * at the API seam rejects that before we ever get here). All the handle's
   * prior activity (drops/saves/follows) is already handle-keyed, so linking the
   * row IS the migration — nothing is copied.
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
  return {
    id: String(row.id),
    handle: String(row.handle),
    userId: row.user_id ? String(row.user_id) : undefined,
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

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("A user id is required to link a profile.");
    const existing = await this.ensure(key);
    // Already linked to this user → nothing to do (idempotent).
    if (existing.userId === userId) return existing;
    // Linked to someone else → refuse. The API seam's ownership check rejects
    // this before we get here; throwing is the last line of defence.
    if (existing.userId && existing.userId !== userId) {
      throw new Error("Handle is already linked to another account.");
    }
    const { data, error } = await admin()
      .from(TABLE)
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq("handle", key)
      // Only stamp when still unlinked — a concurrent link by another user loses
      // this race and returns 0 rows, which we surface as a conflict below.
      .is("user_id", null)
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const linked = (data ?? [])[0];
    if (linked) return fromRow(linked as Record<string, unknown>);
    // 0 rows: someone linked it between our read and write. Re-read; if it is now
    // ours, fine; otherwise it belongs to someone else.
    const after = await this.getByHandle(key);
    if (after?.userId === userId) return after;
    throw new Error("Handle is already linked to another account.");
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

  async linkUser(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("A user id is required to link a profile.");
    const existing = await this.ensure(key);
    if (existing.userId === userId) return existing;
    if (existing.userId && existing.userId !== userId) {
      throw new Error("Handle is already linked to another account.");
    }
    const next: ProfileRecord = {
      ...existing,
      userId,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(key, next);
    return next;
  },
};

/** The single backend selection point (mirrors commentsStore / roundsStore). */
export function profileStore(): ProfileStore {
  return isSupabaseConfigured() ? supabaseProfileStore : memoryProfileStore;
}

/** Test-only: clear the in-memory profile map between cases. */
export function __resetMemoryProfiles(): void {
  memoryProfiles.clear();
}
