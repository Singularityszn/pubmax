// Pint Drop storage layer. ONE interface (PintDropStore), TWO implementations:
// process-memory (wrapping lib/pintDrops.ts, dev/demo only) and Supabase
// (visit_reports table + Storage). The API route picks an implementation at a
// single point and talks to the interface only (M4 / PRD P2.7). Every Supabase
// function assumes admin access exists — if getSupabaseAdmin() is null we
// throw, we don't silently no-op, so the route can 503 deliberately.

import sharp from "sharp";

import type { Provenance } from "@/lib/curation";
import { log } from "@/lib/log";
import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";
import {
  addPintDrop,
  cleanVibeTags,
  keepHiddenPintDrop,
  listAllVisiblePintDrops,
  listByStatus,
  listVisiblePintDrops,
  REPORT_HIDE_THRESHOLD,
  reportPintDrop,
  restorePintDrop,
  type PintDrop,
  type PintDropStatus,
  type VibeTag,
} from "@/lib/pintDrops";

/** Like cleanVibeTags but collapses an empty result to undefined, so the
 *  optional `vibeTags` field stays absent (not `[]`) on drops with no tags. */
function cleanVibeTagsOrUndefined(value: unknown): VibeTag[] | undefined {
  const tags = cleanVibeTags(value);
  return tags.length ? tags : undefined;
}
import { getSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";

const TABLE = "visit_reports";

/** Bounded public reads: the visible listing never returns more than this. */
export const MAX_PUBLIC_DROPS = 500;

// The create path attaches uploaded Storage keys here before persisting. Kept
// off the core PintDrop type in lib/pintDrops.ts (photos are a Supabase-only
// concern); the in-memory store ignores them entirely.
export type PersistableDrop = PintDrop & {
  pintPhotoKey?: string;
  venuePhotoKey?: string;
};

// Public read shape. Storage keys never leave the server — they map to public
// URLs (or null for hidden/pending rows) — and report/moderation metadata is
// stripped: with the report threshold a once-reported drop stays publicly
// visible, and its reporter trail must not ride along. The ONLY transparency
// exception is `reportCount`: a bare count on a still-visible drop (see toDTO)
// so a reporter can see their report registered. Reasons, reporter metadata,
// moderator notes, and hidden photos never leave the server.
export type PintDropDTO = Omit<
  PintDrop,
  "reportedAt" | "reportReason" | "reportCount" | "moderatedAt" | "moderatorNote"
> & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  reportCount?: number;
};

// Moderator read shape. Same photo-URL swap, but a moderator must see the
// evidence they are judging, so photos resolve even on hidden rows and the
// report metadata (reportedAt/reportReason/reportCount) is kept.
export type ModeratorDrop = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

export type PintDropPhotos = { pint: File | null; venue: File | null };

/** The one seam the API route talks to. Both implementations below. */
export type PintDropStore = {
  /** Persist a validated drop (photos where supported); returns the public DTO. Throws on storage failure. */
  create(drop: PintDrop, photos: PintDropPhotos): Promise<PintDropDTO>;
  /** Public read: visible drops + demo seeds, newest-first, capped at MAX_PUBLIC_DROPS. */
  listVisible(venueId?: string): Promise<PintDropDTO[]>;
  /** Moderator review queue: unreviewed drops in a status, with report metadata. */
  listForReview(status: "hidden" | "pending"): Promise<ModeratorDrop[]>;
  /** Public report: record metadata; hides at REPORT_HIDE_THRESHOLD. False = unknown id. */
  report(id: string, reason?: string): Promise<boolean>;
  /** Moderator decision: set the final status and stamp the review. False = unknown id. */
  moderate(id: string, status: PintDropStatus, note?: string): Promise<boolean>;
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

/**
 * Content-sniff the leading bytes against the declared MIME so a client can't
 * pass the type/size check with a mislabelled or crafted file (e.g. a script
 * renamed .jpg). Pure so it is testable without a real File. JPEG = FF D8 FF,
 * PNG = 89 50 4E 47, WebP = "RIFF"....\"WEBP" (bytes 8..11). Unknown MIME is
 * rejected — validatePhoto has already gated the allow-list, this is defence
 * in depth on the same allow-list.
 */
export function magicBytesOk(bytes: Uint8Array, mime: string): boolean {
  const at = (i: number) => bytes[i];
  switch (mime) {
    case "image/jpeg":
      return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    case "image/png":
      return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47;
    case "image/webp":
      // "RIFF" at 0..3 and "WEBP" at 8..11.
      return (
        at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
        at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
      );
    default:
      return false;
  }
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
    // Persisted as a dedicated text[]/jsonb column (`vibe_tags`) — the values
    // are already a server-filtered subset of VIBE_TAGS, so this is a plain
    // one-line map on each side (like every other field here). Defaults to an
    // empty array so an old row / notes-only drop round-trips cleanly.
    vibe_tags: drop.vibeTags ?? [],
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
    // Re-filter on the way out too (defence in depth): a hand-edited or legacy
    // row can't smuggle an off-allowlist tag into a public read. Undefined when
    // empty so the field stays cleanly optional on old rows.
    vibeTags: cleanVibeTagsOrUndefined(row.vibe_tags),
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

/** Public DTO: strip Storage keys AND report/moderation metadata, emit photo
 *  URLs. The only shape the public API returns. `reportCount` is the single
 *  transparency exception — surfaced ONLY as a bare count, ONLY on a visible
 *  drop that has actually been reported (> 0), so a reporter sees their report
 *  land. Reasons, reporter metadata, moderator notes, and hidden photos are
 *  never exposed. */
export function toDTO(drop: PersistableDrop): PintDropDTO {
  const visible = drop.status === "visible";
  const dto: PintDropDTO = {
    id: drop.id,
    venueId: drop.venueId,
    handle: drop.handle,
    drink: drop.drink,
    priceGbp: drop.priceGbp,
    passedDownNote: drop.passedDownNote,
    era: drop.era,
    provenance: drop.provenance,
    status: drop.status,
    createdAt: drop.createdAt,
    pintPhotoUrl: publicUrl(drop.pintPhotoKey, visible),
    venuePhotoUrl: publicUrl(drop.venuePhotoKey, visible),
  };
  // Vibe tags are public, safe content — always exposed when present. Kept
  // additive (absent, not []) so the public JSON shape stays backward-compatible.
  if (drop.vibeTags && drop.vibeTags.length) dto.vibeTags = drop.vibeTags;
  if (visible && (drop.reportCount ?? 0) > 0) dto.reportCount = drop.reportCount;
  return dto;
}

/** Moderator DTO: strip Storage keys but resolve photos even on hidden rows —
 *  the reviewer must see the evidence. Report metadata rides along. */
export function toModeratorDTO(drop: PersistableDrop): ModeratorDrop {
  const { pintPhotoKey, venuePhotoKey, ...rest } = drop;
  return {
    ...rest,
    pintPhotoUrl: publicUrl(pintPhotoKey, true),
    venuePhotoUrl: publicUrl(venuePhotoKey, true),
  };
}

/** L4: the ONE merge point for organic drops + demo seeds — newest-first,
 *  hard-capped. Both implementations route their public read through this. */
function newestFirstCapped<T extends { createdAt: string }>(drops: T[]): T[] {
  return [...drops]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PUBLIC_DROPS);
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Wraps the process-memory primitives in lib/pintDrops.ts. Resets on restart —
// right for dev/demo; production refuses it at the route.
export const memoryPintDropStore: PintDropStore = {
  async create(drop) {
    addPintDrop(drop); // photos ignored: there is no Storage without Supabase
    return toDTO(drop);
  },
  async listVisible(venueId) {
    const rows = venueId ? listVisiblePintDrops(venueId) : listAllVisiblePintDrops();
    return newestFirstCapped(rows).map(toDTO);
  },
  async listForReview(status) {
    return listByStatus(status).map(toModeratorDTO);
  },
  async report(id, reason) {
    return reportPintDrop(id, reason);
  },
  async moderate(id, status, note) {
    return status === "visible" ? restorePintDrop(id, note) : keepHiddenPintDrop(id, note);
  },
};

// Additive-column rollout safety: recognise the specific "the `vibe_tags`
// column does not exist yet" error so create() can retry without that key while
// migration 0005 is still pending on the live DB. This is NOT general error
// swallowing — it matches ONLY a missing-`vibe_tags` column error; every other
// insert error still throws.
//
// Two provider shapes:
//   • Postgres error code 42703 (undefined_column) — the raw Postgres code.
//   • PostgREST PGRST204 — PostgREST's schema cache doesn't know the column
//     (its message reads e.g. "Could not find the 'vibe_tags' column …").
// We require the vibe_tags name to appear so a coincidental 42703 on some other
// column can't silently drop data — it will (correctly) throw.
function isMissingVibeTagsColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentionsVibeTags = message.includes("vibe_tags");
  return (code === "42703" || code === "PGRST204") && mentionsVibeTags;
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabasePintDropStore: PintDropStore = {
  async create(drop, photos) {
    const persistable: PersistableDrop = { ...drop };
    const uploaded: string[] = [];
    try {
      // Photos upload BEFORE the insert — a bad file throws before anything
      // persists; a failed insert leaves exact keys to clean up.
      if (photos.pint) {
        persistable.pintPhotoKey = await uploadPhoto("pint", drop.venueId, drop.id, photos.pint);
        uploaded.push(persistable.pintPhotoKey);
      }
      if (photos.venue) {
        persistable.venuePhotoKey = await uploadPhoto("venue", drop.venueId, drop.id, photos.venue);
        uploaded.push(persistable.venuePhotoKey);
      }
      const row = toRow(persistable);
      // First attempt includes vibe_tags. Once migration 0005 is applied this is
      // the only path that ever runs; the fallback below never fires.
      const { error } = await admin().from(TABLE).insert(row);
      if (error) {
        if (!isMissingVibeTagsColumnError(error)) throw new Error(error.message);
        // Migration 0005 (vibe_tags column) is not applied to this DB yet.
        // Retry the insert WITHOUT vibe_tags so the drop still persists — the
        // rest of the drop is fully valid; only the tags are lost until the
        // migration lands. One-line warning so the pending migration is visible
        // in logs (not silent), then re-throw only if the retry genuinely fails.
        console.warn(
          "[pint-drops] vibe_tags column missing — inserting without it (apply migration 0005):",
          error.message,
        );
        const { vibe_tags: _omit, ...rowWithoutVibeTags } = row;
        void _omit;
        const { error: retryError } = await admin().from(TABLE).insert(rowWithoutVibeTags);
        if (retryError) throw new Error(retryError.message);
      }
    } catch (err) {
      // Log the storage/insert failure (safe fields only — no buffers, no keys)
      // before cleaning up and re-throwing. The route still maps this to the
      // same 503/400 for the user; logging is purely additive observability.
      log("error", "pint_drops.create_failed", {
        dropId: drop.id,
        venueId: drop.venueId,
        uploadedCount: uploaded.length,
        error: err instanceof Error ? err.message : String(err),
      });
      await deletePhotos(uploaded); // no orphans on any failure after an upload
      throw err;
    }
    return toDTO(persistable);
  },

  /** Demo seeds (in-repo, never written to Supabase) merge with the organic
   *  rows in newestFirstCapped so both backends serve one read-merge path. */
  async listVisible(venueId) {
    let query = admin()
      .from(TABLE)
      .select("*")
      .eq("status", "visible")
      .order("created_at", { ascending: false })
      .limit(MAX_PUBLIC_DROPS);
    if (venueId) query = query.eq("venue_id", venueId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const seeds = venueId ? demoDropsFor(venueId) : demoPintDrops;
    return newestFirstCapped((data ?? []).map(fromRow).concat(seeds)).map(toDTO);
  },

  async listForReview(status) {
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq("status", status)
      .is("moderated_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).map(toModeratorDTO);
  },

  /** H4: ONE atomic RPC (migration 0004) increments the count, stamps the
   *  report, and hides at REPORT_HIDE_THRESHOLD in a single UPDATE — two
   *  concurrent reports can't lose an increment. Null data = unknown id. */
  async report(id, reason) {
    const { data, error } = await admin().rpc("report_pint_drop", {
      p_id: id,
      p_reason: reason ?? null,
      p_hide_threshold: REPORT_HIDE_THRESHOLD,
    });
    if (error) {
      console.warn(
        "[pint-drops] report_pint_drop RPC unavailable — falling back to non-atomic report update (apply migration 0004):",
        error.message,
      );
      const { data: rows, error: readError } = await admin()
        .from(TABLE)
        .select("report_count")
        .eq("id", id);
      if (readError) throw new Error(readError.message);
      if (!rows || rows.length === 0) return false;

      const nextCount = Number((rows[0] as { report_count?: number }).report_count ?? 0) + 1;
      const { error: updateError } = await admin()
        .from(TABLE)
        .update({
          report_count: nextCount,
          reported_at: new Date().toISOString(),
          ...(reason ? { report_reason: reason } : {}),
          ...(nextCount >= REPORT_HIDE_THRESHOLD ? { status: "hidden" } : {}),
        })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);
      return true;
    }
    return data !== null && data !== undefined;
  },

  async moderate(id, status, note) {
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
  },
};

// PRD §7.2: we normalize EVERY upload to JPEG, so the stored object is always
// `.jpg` / `image/jpeg` regardless of what the client sent. One output format
// keeps the storage-key + content-type derivation trivial and side-steps
// format-specific metadata quirks; JPEG q80 at ≤1200px is plenty for a pint
// photo. (If we ever want format-preserving output, branch here and in the
// sharp pipeline together.)
const NORMALIZED_EXT = "jpg";
const NORMALIZED_CONTENT_TYPE = "image/jpeg";
const MAX_IMAGE_DIMENSION = 1200;
const JPEG_QUALITY = 80;

/**
 * PRD §7.2 — decode the uploaded bytes and re-emit a privacy-safe, normalized
 * JPEG. Phone photos embed GPS + device data in EXIF; uploading the raw file
 * leaks the contributor's location. sharp strips ALL metadata by default (we
 * never call `.withMetadata()`), and `.rotate()` bakes the EXIF orientation
 * into the pixels before that metadata is dropped so the image still displays
 * upright. We also downscale to a sane max and re-encode so a huge original
 * can't be served verbatim.
 *
 * Throws on a decode/encode failure so the caller can FAIL SAFE — we must never
 * fall back to uploading the raw (EXIF-bearing) bytes, which would defeat the
 * whole point of stripping.
 */
async function normalizeImage(input: Uint8Array): Promise<Buffer> {
  return sharp(input)
    // Apply the EXIF orientation to the pixels, THEN let sharp drop the EXIF
    // (default) — the tag is gone but the image is no longer sideways.
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * Validate + normalize + upload one photo (pint or venue) to Storage. Returns
 * the object key to stash on the drop. Keys are deterministic
 * (`${venueId}/${dropId}/${slot}.${ext}`) so a failed insert has an exact key
 * to clean up — no orphan hunt. Throws a user-safe Error on an invalid file
 * (trust boundary — the client is untrusted, so type/size are checked here, not
 * just in the browser).
 */
export async function uploadPhoto(
  slot: "pint" | "venue",
  venueId: string,
  dropId: string,
  file: File,
): Promise<string> {
  const invalid = validatePhoto(file.type, file.size);
  if (invalid) throw new Error(invalid);

  // Read the bytes once, sniff the signature, then normalize. A
  // mislabelled/crafted file that passed the MIME check is rejected here with
  // the same user-safe "Photo must…" error path (route → 400).
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (!magicBytesOk(buffer, file.type)) {
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }

  // PRD §7.2: strip EXIF (incl. GPS) + normalize BEFORE upload. A processing
  // failure must FAIL SAFE — log it and reject the upload; we never fall
  // through to the raw, EXIF-bearing bytes. `slot`/`dropId`/`venueId` are safe
  // to log (opaque ids); the image bytes are NEVER logged.
  let processed: Buffer;
  try {
    processed = await normalizeImage(buffer);
  } catch (err) {
    log("error", "pint_drops.image_normalize_failed", {
      slot,
      venueId,
      dropId,
      contentType: file.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("Photo could not be processed. Please try a different image.");
  }

  const key = `${venueId}/${dropId}/${slot}.${NORMALIZED_EXT}`;

  const { error } = await admin()
    .storage.from(STORAGE_BUCKET)
    .upload(key, processed, { contentType: NORMALIZED_CONTENT_TYPE, upsert: false });
  if (error) {
    log("error", "pint_drops.photo_upload_failed", {
      slot,
      venueId,
      dropId,
      error: error.message,
    });
    throw new Error(error.message);
  }
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
  } catch (err) {
    // Never re-throw — cleanup must not mask the original failure. But log a
    // warning (safe fields only: a count, not the keys) so orphaned objects are
    // observable rather than silently accumulating.
    log("warn", "pint_drops.photo_cleanup_failed", {
      keyCount: present.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
