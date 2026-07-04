// Supabase-backed persistence for Pint Drops. The in-memory store in
// lib/pintDrops.ts stays the fallback; this file is only reached when
// isSupabaseConfigured() (the route decides). Every function assumes admin
// access exists — if getSupabaseAdmin() is null we throw, we don't silently
// no-op, so the route can catch and fall back deliberately.

import type { Provenance } from "@/lib/curation";
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pintPhotoKey, venuePhotoKey, ...rest } = drop;
  return {
    ...rest,
    pintPhotoUrl: publicUrl(pintPhotoKey, visible),
    venuePhotoUrl: publicUrl(venuePhotoKey, visible),
  };
}

export async function persistDrop(drop: PersistableDrop): Promise<void> {
  const { error } = await admin().from(TABLE).insert(toRow(drop));
  if (error) throw new Error(error.message);
}

/** Public read: newest-first, visible-only. Rows carry keys; map via toDTO. */
export async function listVisibleDropsRemote(venueId: string): Promise<PersistableDrop[]> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("venue_id", venueId)
    .eq("status", "visible")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

export async function listAllVisibleDropsRemote(): Promise<PersistableDrop[]> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("status", "visible")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
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
