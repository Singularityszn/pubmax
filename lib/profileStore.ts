// Durable profile identity. ONE interface (ProfileStore), TWO implementations —
// process-memory (dev/demo/test) and Supabase (public.profiles) — chosen at a
// single seam by the API route (isSupabaseConfigured), exactly like
// lib/pintDropsStore.ts.
//
// A profile handle becomes account-owned when `userId` is set. Every unowned
// row is frozen against later account ownership. Authenticated creation uses a
// distinct atomic operation that never exposes an unowned intermediate row.

import { normalizeHandle } from "@/lib/profiles";
import { isReservedContributorHandle } from "@/lib/pubmaxxIdentity";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { cleanText, isHttpUrl } from "@/lib/textClean";

/** Owned-avatar moderation states persisted on profiles (migration 0089). */
export type ProfileAvatarModerationState =
  | "pending"
  | "approved"
  | "needs_review"
  | "hidden";

export type ProfileOwnedAvatar = {
  objectKey: string;
  generation: string;
  moderationState: ProfileAvatarModerationState;
};

/**
 * A reported or hidden owned avatar as the moderator queue sees it. Carries the
 * report metadata a reviewer needs and NOTHING that identifies a reporter - the
 * actor hashes stay inside the store.
 */
export type ModeratorProfileAvatar = {
  handle: string;
  profileId: string;
  generation: string;
  moderationState: ProfileAvatarModerationState;
  reportCount: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
  /** Public serve path while the face is still approved; absent once hidden. */
  previewUrl?: string;
};

export type ProfileRecord = {
  id: string;
  handle: string;
  // The linked Supabase Auth user id, or undefined while a legacy/demo profile
  // remains unlinked. NEVER serialized to the public /u/[handle] read. It is an
  // internal ownership key only. Null alone is NOT a tombstone — production
  // still holds live anonymous-era rows with user_id null.
  userId?: string;
  /**
   * Set when the linked auth.users row is deleted (migration 0078). Null means
   * live, including legacy user_id-null handles. Public "gone" gates on this.
   */
  tombstonedAt?: string;
  displayName?: string;
  avatarUrl?: string;
  /**
   * Owned avatar object key under our bucket (`avatars/{id}/{generation}/image.jpg`).
   * Internal: never crosses the public profile wire; use {@link publicOwnedAvatarUrl}.
   */
  avatarObjectKey?: string;
  /** Opaque generation id for the current owned avatar. Internal. */
  avatarGeneration?: string;
  /** Moderation state for the owned avatar. Internal. */
  avatarModerationState?: ProfileAvatarModerationState;
  /** Distinct hashed reporters for the current owned avatar. Internal. */
  avatarReportActors?: string[];
  /** Distinct reporter count derived from {@link avatarReportActors}. */
  avatarReportCount?: number;
  /** When the latest distinct avatar report was recorded. */
  avatarReportedAt?: string;
  /** Latest reader reason for the avatar report queue. */
  avatarReportReason?: string;
  /** When a moderator last kept-visible or hid the owned avatar. */
  avatarModeratedAt?: string;
  /** Optional moderator note on the latest avatar decision. */
  avatarModeratorNote?: string;
  homeCity?: string;
  bio?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Public served path for an approved owned avatar. Absent, pending, flagged,
 * or hidden faces yield undefined so callers fall back to initials.
 */
export function publicOwnedAvatarUrl(
  profile: Pick<
    ProfileRecord,
    "id" | "avatarObjectKey" | "avatarGeneration" | "avatarModerationState"
  >,
): string | undefined {
  if (profile.avatarModerationState !== "approved") return undefined;
  if (!profile.avatarObjectKey || !profile.avatarGeneration || !profile.id) {
    return undefined;
  }
  return `/api/avatar/${profile.id}/${profile.avatarGeneration}`;
}

/** True only when the auth-deletion trigger stamped tombstoned_at. */
export function isProfileTombstoned(
  profile: Pick<ProfileRecord, "tombstonedAt"> | null | undefined,
): boolean {
  return typeof profile?.tombstonedAt === "string" && profile.tombstonedAt.length > 0;
}

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
  /** Read a profile by stable id, or null when none exists. */
  getById(id: string): Promise<ProfileRecord | null>;
  /**
   * One query: approved owned avatars for linked handles only. Keys are
   * normalised handles; values are public serve paths.
   */
  getApprovedAvatarUrlsByHandles(handles: readonly string[]): Promise<ReadonlyMap<string, string>>;
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
  /** Atomically create an absent handle already owned by an account. */
  createOwned(handle: string, userId: string): Promise<ProfileRecord>;
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
   * Confirm current ownership. Repeating the same handle and user is
   * idempotent. Absent, unowned, and differently owned handles are unavailable.
   */
  linkUser(handle: string, userId: string): Promise<ProfileRecord>;
  /**
   * Set or clear the owned (uploaded) avatar fields. Passing null clears the
   * object key, generation, and moderation state together. A new or cleared
   * face also clears report/hide stamps so provenance cannot attach to the
   * wrong generation. Does not touch the legacy hotlinked `avatarUrl` column.
   */
  setOwnedAvatar(
    handle: string,
    avatar: ProfileOwnedAvatar | null,
  ): Promise<ProfileRecord | null>;
  /**
   * Queue a reader flag on the current owned avatar. Never changes public
   * visibility. Same-actor duplicates are idempotent.
   */
  reportOwnedAvatar(
    handle: string,
    reason: string | undefined,
    actorHash: string,
  ): Promise<boolean>;
  /**
   * Moderator hide or restore. Hide stamps `hidden` and stops public serving;
   * restore returns the face to `approved`. Neither deletes storage or report
   * provenance.
   */
  moderateOwnedAvatar(
    handle: string,
    action: "hide" | "restore",
    note?: string,
  ): Promise<boolean>;
  /** Reported, still-public owned avatars awaiting a moderator decision. */
  listReportedAvatars(limit?: number): Promise<ModeratorProfileAvatar[]>;
  /** Already-hidden owned avatars (hide stays reversible from this lane). */
  listHiddenAvatars(limit?: number): Promise<ModeratorProfileAvatar[]>;
  /**
   * Prefix search over claimed, non-tombstoned handles only (WP7 find-your-lot).
   * Never returns unowned or tombstoned rows. Bounded; ordered by handle.
   */
  searchClaimedByHandlePrefix(
    prefix: string,
    limit?: number,
  ): Promise<ProfileRecord[]>;
};

const TABLE = "profiles";

function admin() {
  return requireSupabaseAdmin();
}

// profiles (snake_case) <-> ProfileRecord (camelCase). One place so a column
// rename is a one-line change on each side.
function avatarModerationFromRow(
  value: unknown,
): ProfileAvatarModerationState | undefined {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "needs_review" ||
    value === "hidden"
  ) {
    return value;
  }
  return undefined;
}

function avatarReportActorsFromRow(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actors = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry);
  return actors.length ? actors : undefined;
}

function fromRow(row: Record<string, unknown>): ProfileRecord {
  const reportActors = avatarReportActorsFromRow(row.avatar_report_actors);
  const reportCountRaw = row.avatar_report_count;
  const reportCount =
    typeof reportCountRaw === "number" && Number.isFinite(reportCountRaw)
      ? reportCountRaw
      : reportActors?.length;
  return {
    id: String(row.id),
    handle: String(row.handle),
    userId: row.user_id ? String(row.user_id) : undefined,
    tombstonedAt: row.tombstoned_at ? String(row.tombstoned_at) : undefined,
    displayName: row.display_name ? String(row.display_name) : undefined,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    avatarObjectKey: row.avatar_object_key ? String(row.avatar_object_key) : undefined,
    avatarGeneration: row.avatar_generation ? String(row.avatar_generation) : undefined,
    avatarModerationState: avatarModerationFromRow(row.avatar_moderation_state),
    ...(reportActors ? { avatarReportActors: reportActors } : {}),
    ...(reportCount && reportCount > 0 ? { avatarReportCount: reportCount } : {}),
    avatarReportedAt: row.avatar_reported_at ? String(row.avatar_reported_at) : undefined,
    avatarReportReason: row.avatar_report_reason
      ? String(row.avatar_report_reason)
      : undefined,
    avatarModeratedAt: row.avatar_moderated_at ? String(row.avatar_moderated_at) : undefined,
    avatarModeratorNote: row.avatar_moderator_note
      ? String(row.avatar_moderator_note)
      : undefined,
    homeCity: row.home_city ? String(row.home_city) : undefined,
    bio: row.bio ? String(row.bio) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const AVATAR_REVIEW_LIMIT = 100;
const MAX_AVATAR_REPORT_REASON = 280;

function cleanAvatarReportReason(reason: string | undefined): string | undefined {
  if (typeof reason !== "string") return undefined;
  const cleaned = cleanText(reason, MAX_AVATAR_REPORT_REASON);
  return cleaned === "" ? undefined : cleaned;
}

function clearAvatarReportRow(): Record<string, unknown> {
  return {
    avatar_report_count: 0,
    avatar_reported_at: null,
    avatar_report_reason: null,
    avatar_report_actors: [],
    avatar_moderated_at: null,
    avatar_moderator_note: null,
  };
}

function toModeratorAvatar(profile: ProfileRecord): ModeratorProfileAvatar | null {
  if (!profile.avatarGeneration || !profile.avatarModerationState || !profile.avatarObjectKey) {
    return null;
  }
  const previewUrl = publicOwnedAvatarUrl(profile);
  return {
    handle: profile.handle,
    profileId: profile.id,
    generation: profile.avatarGeneration,
    moderationState: profile.avatarModerationState,
    reportCount: profile.avatarReportCount ?? profile.avatarReportActors?.length ?? 0,
    ...(profile.avatarReportedAt ? { reportedAt: profile.avatarReportedAt } : {}),
    ...(profile.avatarReportReason ? { reportReason: profile.avatarReportReason } : {}),
    ...(profile.avatarModeratedAt ? { moderatedAt: profile.avatarModeratedAt } : {}),
    ...(profile.avatarModeratorNote ? { moderatorNote: profile.avatarModeratorNote } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function isReportedAvatarQueueRow(profile: ProfileRecord): boolean {
  const reports = profile.avatarReportCount ?? profile.avatarReportActors?.length ?? 0;
  return (
    reports > 0 &&
    !profile.avatarModeratedAt &&
    profile.avatarModerationState === "approved" &&
    Boolean(profile.avatarObjectKey && profile.avatarGeneration)
  );
}

function isHiddenAvatarQueueRow(profile: ProfileRecord): boolean {
  return (
    profile.avatarModerationState === "hidden" &&
    Boolean(profile.avatarObjectKey && profile.avatarGeneration)
  );
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
const AVATAR_BATCH_COLUMNS =
  "id, handle, user_id, tombstoned_at, avatar_object_key, avatar_generation, avatar_moderation_state";

function approvedAvatarUrlForProfile(profile: ProfileRecord): string | undefined {
  if (!profile.userId?.trim() || isProfileTombstoned(profile)) return undefined;
  return publicOwnedAvatarUrl(profile);
}

export const supabaseProfileStore: ProfileStore = {
  async getByHandle(handle) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("handle", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async getById(id) {
    const key = typeof id === "string" ? id.trim() : "";
    if (!key) return null;
    const { data, error } = await admin().from(TABLE).select("*").eq("id", key).limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async getApprovedAvatarUrlsByHandles(handles) {
    const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
    if (keys.length === 0) return new Map();
    const { data, error } = await admin()
      .from(TABLE)
      .select(AVATAR_BATCH_COLUMNS)
      .in("handle", keys)
      .not("user_id", "is", null);
    if (error) throw new Error(error.message);
    const out = new Map<string, string>();
    for (const row of data ?? []) {
      const profile = fromRow(row as Record<string, unknown>);
      const url = approvedAvatarUrlForProfile(profile);
      if (url) out.set(profile.handle, url);
    }
    return out;
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

  async createOwned(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const { data, error } = await admin().rpc("claim_pubmaxx_handle", {
      p_user_id: userId,
      p_handle: key,
    });
    if (error) throw new Error(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as
      | Record<string, unknown>
      | null;
    if (result?.ok === true) {
      const profile = await this.getByHandle(key);
      if (profile?.userId === userId) return profile;
      throw new Error("Profile storage is unavailable.");
    }
    if (result?.code === "already_has_handle") {
      throw new Error("That account already has a handle.");
    }
    if (result?.code === "taken") {
      throw new Error("That handle is not available.");
    }
    throw new Error("Profile storage is unavailable.");
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
    row.avatar_object_key = null;
    row.avatar_generation = null;
    row.avatar_moderation_state = null;
    Object.assign(row, clearAvatarReportRow());
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
    throw new Error("That handle is not available.");
  },

  async setOwnedAvatar(handle, avatar) {
    const key = normalizeHandle(handle);
    if (!key) return null;
    const row: Record<string, unknown> = {
      avatar_object_key: avatar?.objectKey ?? null,
      avatar_generation: avatar?.generation ?? null,
      avatar_moderation_state: avatar?.moderationState ?? null,
      // A new generation is a different face; old flags must not travel with it.
      ...clearAvatarReportRow(),
      updated_at: new Date().toISOString(),
    };
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

  async reportOwnedAvatar(handle, reason, actorHash) {
    const key = normalizeHandle(handle);
    const actor = typeof actorHash === "string" ? actorHash.trim() : "";
    if (!key || !actor) return false;
    const existing = await this.getByHandle(key);
    if (
      !existing?.avatarObjectKey ||
      !existing.avatarGeneration ||
      existing.avatarModerationState !== "approved"
    ) {
      return false;
    }
    const actors = existing.avatarReportActors ?? [];
    if (actors.includes(actor)) return true;
    const nextActors = [...actors, actor];
    const cleanedReason = cleanAvatarReportReason(reason);
    const row: Record<string, unknown> = {
      avatar_report_actors: nextActors,
      avatar_report_count: nextActors.length,
      avatar_reported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // A fresh flag after "keep visible" re-opens the reported lane.
      avatar_moderated_at: null,
    };
    if (cleanedReason) row.avatar_report_reason = cleanedReason;
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .eq("avatar_moderation_state", "approved")
      .select("id")
      .limit(1);
    if (error) throw new Error(error.message);
    return Boolean((data ?? [])[0]);
  },

  async moderateOwnedAvatar(handle, action, note) {
    const key = normalizeHandle(handle);
    if (!key) return false;
    const existing = await this.getByHandle(key);
    if (!existing?.avatarObjectKey || !existing.avatarGeneration || !existing.avatarModerationState) {
      return false;
    }
    if (action === "hide" && existing.avatarModerationState === "hidden") {
      // Idempotent hide still refreshes the decision stamp / note.
    } else if (action === "restore" && existing.avatarModerationState === "hidden") {
      // restore from hidden -> approved
    } else if (action === "restore" && existing.avatarModerationState === "approved") {
      // keep visible: stamp decision, leave the face public
    } else if (action === "hide" && existing.avatarModerationState === "approved") {
      // hide from reported lane
    } else {
      return false;
    }

    const cleanedNote = cleanAvatarReportReason(note);
    const row: Record<string, unknown> = {
      avatar_moderation_state: action === "hide" ? "hidden" : "approved",
      avatar_moderated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (cleanedNote) row.avatar_moderator_note = cleanedNote;
    const { data, error } = await admin()
      .from(TABLE)
      .update(row)
      .eq("handle", key)
      .select("id")
      .limit(1);
    if (error) throw new Error(error.message);
    return Boolean((data ?? [])[0]);
  },

  async listReportedAvatars(limit = AVATAR_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), AVATAR_REVIEW_LIMIT);
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq("avatar_moderation_state", "approved")
      .gt("avatar_report_count", 0)
      .is("avatar_moderated_at", null)
      .not("avatar_object_key", "is", null)
      .order("avatar_reported_at", { ascending: false, nullsFirst: false })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => toModeratorAvatar(fromRow(row as Record<string, unknown>)))
      .filter((row): row is ModeratorProfileAvatar => row !== null);
  },

  async listHiddenAvatars(limit = AVATAR_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), AVATAR_REVIEW_LIMIT);
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq("avatar_moderation_state", "hidden")
      .not("avatar_object_key", "is", null)
      .order("avatar_moderated_at", { ascending: false, nullsFirst: false })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => toModeratorAvatar(fromRow(row as Record<string, unknown>)))
      .filter((row): row is ModeratorProfileAvatar => row !== null);
  },

  async searchClaimedByHandlePrefix(prefix, limit = 8) {
    const key = normalizeHandle(prefix);
    if (!key || key.length < 2) return [];
    const bounded = Math.min(Math.max(limit, 1), 12);
    // Claimed = user_id set; live = tombstoned_at null. ilike prefix only.
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .not("user_id", "is", null)
      .is("tombstoned_at", null)
      .ilike("handle", `${key}%`)
      .order("handle", { ascending: true })
      .limit(bounded);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as Record<string, unknown>));
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

  async getById(id) {
    const key = typeof id === "string" ? id.trim() : "";
    if (!key) return null;
    for (const profile of memoryProfiles.values()) {
      if (profile.id === key) return profile;
    }
    return null;
  },

  async getApprovedAvatarUrlsByHandles(handles) {
    const out = new Map<string, string>();
    for (const raw of handles) {
      const key = normalizeHandle(raw);
      if (!key) continue;
      const profile = memoryProfiles.get(key);
      if (!profile) continue;
      const url = approvedAvatarUrlForProfile(profile);
      if (url) out.set(profile.handle, url);
    }
    return out;
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
      createdAt: now,
      updatedAt: now,
    };
    memoryProfiles.set(key, record);
    return record;
  },

  async createOwned(handle, userId) {
    const key = normalizeHandle(handle);
    if (!key) throw new Error("A profile needs a non-empty handle.");
    if (!userId) throw new Error("User id is missing.");
    if (isReservedContributorHandle(key)) {
      throw new Error("That handle is not available.");
    }
    const existing = memoryProfiles.get(key);
    if (existing?.userId === userId) return existing;
    if (existing) throw new Error("That handle is not available.");
    for (const profile of memoryProfiles.values()) {
      if (profile.userId === userId) {
        throw new Error("That account already has a handle.");
      }
    }
    const now = new Date().toISOString();
    const record: ProfileRecord = {
      id: memoryId(key),
      handle: key,
      userId,
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
      avatarObjectKey: undefined,
      avatarGeneration: undefined,
      avatarModerationState: undefined,
      avatarReportActors: undefined,
      avatarReportCount: undefined,
      avatarReportedAt: undefined,
      avatarReportReason: undefined,
      avatarModeratedAt: undefined,
      avatarModeratorNote: undefined,
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
    throw new Error("That handle is not available.");
  },

  async setOwnedAvatar(handle, avatar) {
    const key = normalizeHandle(handle);
    const existing = memoryProfiles.get(key);
    if (!existing) return null;
    const next: ProfileRecord = {
      ...existing,
      avatarObjectKey: avatar?.objectKey,
      avatarGeneration: avatar?.generation,
      avatarModerationState: avatar?.moderationState,
      // A new generation is a different face; old flags must not travel with it.
      avatarReportActors: undefined,
      avatarReportCount: undefined,
      avatarReportedAt: undefined,
      avatarReportReason: undefined,
      avatarModeratedAt: undefined,
      avatarModeratorNote: undefined,
      updatedAt: new Date().toISOString(),
    };
    if (!avatar) {
      delete next.avatarObjectKey;
      delete next.avatarGeneration;
      delete next.avatarModerationState;
    }
    memoryProfiles.set(key, next);
    return next;
  },

  async reportOwnedAvatar(handle, reason, actorHash) {
    const key = normalizeHandle(handle);
    const actor = typeof actorHash === "string" ? actorHash.trim() : "";
    if (!key || !actor) return false;
    const existing = memoryProfiles.get(key);
    if (
      !existing?.avatarObjectKey ||
      !existing.avatarGeneration ||
      existing.avatarModerationState !== "approved"
    ) {
      return false;
    }
    const actors = existing.avatarReportActors ?? [];
    if (actors.includes(actor)) return true;
    const nextActors = [...actors, actor];
    const cleanedReason = cleanAvatarReportReason(reason);
    const next: ProfileRecord = {
      ...existing,
      avatarReportActors: nextActors,
      avatarReportCount: nextActors.length,
      avatarReportedAt: new Date().toISOString(),
      avatarModeratedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    if (cleanedReason) next.avatarReportReason = cleanedReason;
    memoryProfiles.set(key, next);
    return true;
  },

  async moderateOwnedAvatar(handle, action, note) {
    const key = normalizeHandle(handle);
    if (!key) return false;
    const existing = memoryProfiles.get(key);
    if (!existing?.avatarObjectKey || !existing.avatarGeneration || !existing.avatarModerationState) {
      return false;
    }
    if (
      action === "hide" &&
      existing.avatarModerationState !== "approved" &&
      existing.avatarModerationState !== "hidden"
    ) {
      return false;
    }
    if (
      action === "restore" &&
      existing.avatarModerationState !== "approved" &&
      existing.avatarModerationState !== "hidden"
    ) {
      return false;
    }
    const cleanedNote = cleanAvatarReportReason(note);
    const next: ProfileRecord = {
      ...existing,
      avatarModerationState: action === "hide" ? "hidden" : "approved",
      avatarModeratedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (cleanedNote) next.avatarModeratorNote = cleanedNote;
    memoryProfiles.set(key, next);
    return true;
  },

  async listReportedAvatars(limit = AVATAR_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), AVATAR_REVIEW_LIMIT);
    return [...memoryProfiles.values()]
      .filter(isReportedAvatarQueueRow)
      .sort((a, b) =>
        (b.avatarReportedAt ?? b.updatedAt).localeCompare(a.avatarReportedAt ?? a.updatedAt),
      )
      .slice(0, bounded)
      .map((profile) => toModeratorAvatar(profile))
      .filter((row): row is ModeratorProfileAvatar => row !== null);
  },

  async listHiddenAvatars(limit = AVATAR_REVIEW_LIMIT) {
    const bounded = Math.min(Math.max(limit, 1), AVATAR_REVIEW_LIMIT);
    return [...memoryProfiles.values()]
      .filter(isHiddenAvatarQueueRow)
      .sort((a, b) =>
        (b.avatarModeratedAt ?? b.updatedAt).localeCompare(a.avatarModeratedAt ?? a.updatedAt),
      )
      .slice(0, bounded)
      .map((profile) => toModeratorAvatar(profile))
      .filter((row): row is ModeratorProfileAvatar => row !== null);
  },

  async searchClaimedByHandlePrefix(prefix, limit = 8) {
    const key = normalizeHandle(prefix);
    if (!key || key.length < 2) return [];
    const bounded = Math.min(Math.max(limit, 1), 12);
    return [...memoryProfiles.values()]
      .filter(
        (profile) =>
          Boolean(profile.userId) &&
          !isProfileTombstoned(profile) &&
          profile.handle.startsWith(key),
      )
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .slice(0, bounded);
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
    createdAt: now,
    updatedAt: now,
  };
  memoryProfiles.set(key, record);
  return record;
}

/** Test-only: model a production-linked row, including reserved contributor handles. */
export function __seedMemoryOwnedProfile(handle: string, userId: string): ProfileRecord {
  const record = __seedMemoryLegacyProfile(handle);
  const key = normalizeHandle(handle);
  const owned: ProfileRecord = {
    ...record,
    userId,
    updatedAt: new Date().toISOString(),
  };
  memoryProfiles.set(key, owned);
  return owned;
}

/**
 * Test-only: model auth.users deletion.
 * Trigger stamps tombstoned_at; FK then clears user_id. Row and handle stay
 * (attribution + reservation). Legacy null-user_id rows are NOT tombstones.
 * Avatar fields are nulled to mirror migration 0089's tombstone path.
 */
export function __tombstoneMemoryProfile(handle: string): ProfileRecord | null {
  const key = normalizeHandle(handle);
  if (!key) return null;
  const existing = memoryProfiles.get(key);
  if (!existing) return null;
  const now = new Date().toISOString();
  const next: ProfileRecord = {
    ...existing,
    userId: undefined,
    tombstonedAt: existing.tombstonedAt ?? now,
    avatarUrl: undefined,
    avatarObjectKey: undefined,
    avatarGeneration: undefined,
    avatarModerationState: undefined,
    avatarReportActors: undefined,
    avatarReportCount: undefined,
    avatarReportedAt: undefined,
    avatarReportReason: undefined,
    avatarModeratedAt: undefined,
    avatarModeratorNote: undefined,
    updatedAt: now,
  };
  memoryProfiles.set(key, next);
  return next;
}

/** Convenience wrappers used by the avatar report/admin routes and tests. */
export function reportProfileAvatar(
  handle: string,
  reason: string | undefined,
  actorHash: string,
): Promise<boolean> {
  return profileStore().reportOwnedAvatar(handle, reason, actorHash);
}

export function moderateProfileAvatar(
  handle: string,
  action: "hide" | "restore",
  note?: string,
): Promise<boolean> {
  return profileStore().moderateOwnedAvatar(handle, action, note);
}

export function listReportedProfileAvatars(
  limit?: number,
): Promise<ModeratorProfileAvatar[]> {
  return profileStore().listReportedAvatars(limit);
}

export function listHiddenProfileAvatars(
  limit?: number,
): Promise<ModeratorProfileAvatar[]> {
  return profileStore().listHiddenAvatars(limit);
}
