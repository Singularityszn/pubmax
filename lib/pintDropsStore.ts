// Supabase-backed persistence for Pint Drops. The in-memory store in
// lib/pintDrops.ts stays the fallback; this file is only reached when
// isSupabaseConfigured() (the route decides). Every function assumes admin
// access exists — if getSupabaseAdmin() is null we throw, we don't silently
// no-op, so the route can catch and fall back deliberately.

import type { Provenance } from "@/lib/curation";
import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";
import type { PintDrop, PintDropStatus } from "@/lib/pintDrops";
import { getSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

const TABLE = "visit_reports";

// The route attaches uploaded Storage keys here before persisting. Kept off the
// core PintDrop type in lib/pintDrops.ts (photos are a Supabase-only concern);
// the fallback store ignores them entirely.
export type PersistableDrop = PintDrop & {
  pintPhotoKey?: string;
  venuePhotoKey?: string;
};

// Public read shape. Storage keys never leave the server — they map to public
// URLs (or null for hidden/pending rows). This is what GET/POST return.
export type PintDropDTO = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

// Moderator read shape. Same photo-URL swap, but a moderator must see the
// evidence they are judging, so photos resolve even on hidden rows. Report
// metadata (reportedAt/reportReason/reportCount) already lives on PintDrop.
export type ModeratorDrop = PintDropDTO;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Pure photo check so it is testable without a real File. Returns a user-safe
 * error string, or null when the file is acceptable.
 */
export function validatePhoto(type: string, size: number): string | null {
  if (!ALLOWED_TYPES.has(type)) {
    return "Photo must be a JPEG, PNG, or WebP image.";
  }
  if (size > MAX_PHOTO_BYTES) {
    return "Photo must be 5MB or smaller.";
  }
  return null;
}

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase not configured.");
  return client;
}

// visit_reports (snake_case) <-> PintDrop (camelCase). Kept in one place so a
// column rename is a one-line change on each side.
function toRow(drop: PersistableDrop) {
  return {
    id: drop.id,
    venue_id: drop.venueId,
    handle: drop.handle,
    drink: drop.drink,
    price_gbp: drop.priceGbp,
    passed_down_note: drop.passedDownNote,
    era: drop.era,
    pint_photo_key: drop.pintPhotoKey ?? null,
    venue_photo_key: drop.venuePhotoKey ?? null,
    provenance: drop.provenance,
    status: drop.status,
    created_at: drop.createdAt,
    reported_at: drop.reportedAt ?? null,
    report_reason: drop.reportReason ?? null,
    report_count: drop.reportCount ?? 0,
    moderated_at: drop.moderatedAt ?? null,
    moderator_note: drop.moderatorNote ?? null,
  };
}

function fromRow(row: Record<string, unknown>): PersistableDrop {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    handle: String(row.handle),
    drink: String(row.drink ?? ""),
    priceGbp: row.price_gbp === null || row.price_gbp === undefined ? null : Number(row.price_gbp),
    passedDownNote: String(row.passed_down_note ?? ""),
    era: String(row.era ?? ""),
    provenance: row.provenance as Provenance,
    status: row.status as PintDropStatus,
    createdAt: String(row.created_at),
    pintPhotoKey: row.pint_photo_key ? String(row.pint_photo_key) : undefined,
    venuePhotoKey: row.venue_photo_key ? String(row.venue_photo_key) : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    reportCount: row.report_count === null || row.report_count === undefined ? undefined : Number(row.report_count),
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
  };
}

// A Storage key becomes a public URL only for visible rows — hidden/pending
// drops read as null so a reported photo stops being served. Keys never reach
// the client; getPublicUrl is a pure string build (no network call).
function publicUrl(key: string | undefined, visible: boolean): string | null {
  if (!key || !visible) return null;
  return admin().storage.from(STORAGE_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Strip Storage keys, emit public photo URLs. The only shape the API returns. */
export function toDTO(drop: PersistableDrop): PintDropDTO {
  const visible = drop.status === "visible";
  const { pintPhotoKey, venuePhotoKey, ...rest } = drop;
  return {
    ...rest,
    pintPhotoUrl: publicUrl(pintPhotoKey, visible),
    venuePhotoUrl: publicUrl(venuePhotoKey, visible),
  };
}

/** Moderator DTO: strip Storage keys but resolve photos even on hidden rows —
 *  the reviewer must see the evidence. Report metadata rides on PersistableDrop. */
export function toModeratorDTO(drop: PersistableDrop): ModeratorDrop {
  const { pintPhotoKey, venuePhotoKey, ...rest } = drop;
  return {
    ...rest,
    pintPhotoUrl: publicUrl(pintPhotoKey, true),
    venuePhotoUrl: publicUrl(venuePhotoKey, true),
  };
}

export async function persistDrop(drop: PersistableDrop): Promise<void> {
  const { error } = await admin().from(TABLE).insert(toRow(drop));
  if (error) throw new Error(error.message);
}

/** Public read: newest-first, visible-only. Rows carry keys; map via toDTO.
 *  Demo seeds (in-repo, never written to Supabase) are appended after the
 *  organic rows so both backends serve the same single read-merge path. */
export async function listVisibleDropsRemote(venueId: string): Promise<PersistableDrop[]> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("venue_id", venueId)
    .eq("status", "visible")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow).concat(demoDropsFor(venueId));
}

export async function listAllVisibleDropsRemote(): Promise<PersistableDrop[]> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("status", "visible")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow).concat(demoPintDrops);
}

export async function setDropStatusRemote(id: string, status: PintDropStatus): Promise<boolean> {
  const { data, error } = await admin()
    .from(TABLE)
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Moderator decision: set the final status and stamp the review. Used by both
 *  restore ("visible") and keep_hidden ("hidden"). */
export async function moderateDropRemote(
  id: string,
  status: PintDropStatus,
  note?: string,
): Promise<boolean> {
  const { data, error } = await admin()
    .from(TABLE)
    .update({
      status,
      moderated_at: new Date().toISOString(),
      ...(note ? { moderator_note: note } : {}),
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Moderator read: all drops in a status, newest-first, WITH report metadata. */
export async function listByStatusRemote(status: PintDropStatus): Promise<ModeratorDrop[]> {
  let query = admin()
    .from(TABLE)
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (status === "hidden" || status === "pending") {
    query = query.is("moderated_at", null);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow).map(toModeratorDTO);
}

/** Public report: hide the drop and stamp/increment report metadata.
 *  report_count is bumped from the current row (read-then-write — fine at
 *  prototype volume; move to an atomic rpc/`increment` if reports get hot). */
export async function reportDropRemote(id: string, reason?: string): Promise<boolean> {
  const { data: rows, error: readErr } = await admin()
    .from(TABLE)
    .select("report_count")
    .eq("id", id);
  if (readErr) throw new Error(readErr.message);
  if (!rows || rows.length === 0) return false;

  const nextCount = Number((rows[0] as { report_count?: number }).report_count ?? 0) + 1;
  const { error } = await admin()
    .from(TABLE)
    .update({
      status: "hidden",
      reported_at: new Date().toISOString(),
      report_count: nextCount,
      ...(reason ? { report_reason: reason } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}

function ext(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

/**
 * Validate + upload one photo (pint or venue) to Storage. Returns the object key
 * to stash on the drop. Keys are deterministic (`${venueId}/${dropId}/${slot}.${ext}`)
 * so a failed insert has an exact key to clean up — no orphan hunt. Throws a
 * user-safe Error on an invalid file (trust boundary — the client is untrusted,
 * so type/size are checked here, not just in the browser).
 */
export async function uploadPhoto(
  slot: "pint" | "venue",
  venueId: string,
  dropId: string,
  file: File,
): Promise<string> {
  const invalid = validatePhoto(file.type, file.size);
  if (invalid) throw new Error(invalid);

  const key = `${venueId}/${dropId}/${slot}.${ext(file.type)}`;

  const { error } = await admin()
    .storage.from(STORAGE_BUCKET)
    .upload(key, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return key;
}

/** Best-effort delete of uploaded objects — called to undo orphans when the
 *  DB insert fails after upload. Never throws: cleanup must not mask the
 *  original 503. */
export async function deletePhotos(keys: string[]): Promise<void> {
  const present = keys.filter(Boolean);
  if (!present.length) return;
  try {
    await admin().storage.from(STORAGE_BUCKET).remove(present);
  } catch {
    // ponytail: swallow — a stray object is a cleanup-job problem, not a
    // request-path one. Upgrade to a logged retry if orphans pile up.
  }
}
