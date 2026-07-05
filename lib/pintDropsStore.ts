// Pint Drop storage layer. ONE interface (PintDropStore), TWO implementations:
// process-memory (wrapping lib/pintDrops.ts, dev/demo only) and Supabase
// (visit_reports table + Storage). The API route picks an implementation at a
// single point and talks to the interface only (M4 / PRD P2.7). Every Supabase
// function assumes admin access exists — if getSupabaseAdmin() is null we
// throw, we don't silently no-op, so the route can 503 deliberately.

import type { Provenance } from "@/lib/curation";
import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";
import {
  addPintDrop,
  keepHiddenPintDrop,
  listAllVisiblePintDrops,
  listByStatus,
  listVisiblePintDrops,
  REPORT_HIDE_THRESHOLD,
  reportPintDrop,
  restorePintDrop,
  type PintDrop,
  type PintDropStatus,
} from "@/lib/pintDrops";
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
// ponytail: wraps the process-memory primitives in lib/pintDrops.ts. Resets on
// restart — right for dev/demo; production refuses it at the route.
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
      const { error } = await admin().from(TABLE).insert(toRow(persistable));
      if (error) throw new Error(error.message);
    } catch (err) {
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

  // Read the bytes once, sniff the signature, then upload the same buffer. A
  // mislabelled/crafted file that passed the MIME check is rejected here with
  // the same user-safe "Photo must…" error path (route → 400).
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (!magicBytesOk(buffer, file.type)) {
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }

  const key = `${venueId}/${dropId}/${slot}.${ext(file.type)}`;

  const { error } = await admin()
    .storage.from(STORAGE_BUCKET)
    .upload(key, buffer, { contentType: file.type, upsert: false });
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
