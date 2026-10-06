import "server-only";

// Pint Drop storage layer. ONE interface (PintDropStore), TWO implementations:
// process-memory (wrapping lib/pintDrops.ts, dev/demo only) and Supabase
// (pint_drops table + Storage). The API route picks an implementation at a
// single point and talks to the interface only (M4 / PRD P2.7). Every Supabase
// function assumes admin access exists — if getSupabaseAdmin() is null we
// throw, we don't silently no-op, so the route can 503 deliberately.

import sharp from "sharp";

import { dropWithdrawnAuthors } from "@/lib/accountPublicAccess.server";
import type { CityId } from "@/lib/cities";
import type { Provenance } from "@/lib/curation";
import {
  cleanDrinkMeasure,
  cleanDrinkMeasureLabel,
  measureIsPint,
} from "@/lib/drinkMeasure";
import { detectImageKind, magicBytesOk as magicBytesOkPure, stripImageMetadata } from "@/lib/imageSafety";
import { log } from "@/lib/log";
import { loadVenueAliasResolver, storedVenueIds } from "@/lib/venueAliases";
import { demoDropsFor, demoPintDropsForCity } from "@/lib/pintDropSeeds";
import {
  confirmationIsLive,
  isPintDropConfirmationBasis,
  type PintDropConfirmation,
} from "@/lib/pintDropConfirmation";
import {
  authorRetiredAtFromRow,
  publicContributorHandle,
} from "@/lib/retiredContributor";
import {
  addPintDrop,
  ANON_HANDLE_LABEL,
  canViewOnPublicSurface,
  confirmPintDrop,
  listConfirmedPintDrops,
  isPubliclyReadableDrop,
  cleanVibeTags,
  cleanVisibility,
  dropMatchesCityScope,
  hasPricedDropToday as hasPricedDropTodayMemory,
  keepHiddenPintDrop,
  listReportedPintDrops,
  listAllVisiblePintDrops,
  listByStatus,
  listLegacyPintDropsForVenue,
  listVisiblePintDrops,
  normalizeViewerHandle,
  REPORT_HIDE_THRESHOLD,
  reportPintDrop,
  restorePintDrop,
  visibilityOf,
  verifiedPintDropReportCount,
  type PintDrop,
  type PintDropReportIdentity,
  type PintDropReviewStatus,
  type PintDropStatus,
  type ViewerContext,
  type VibeTag,
} from "@/lib/pintDrops";

/** Like cleanVibeTags but collapses an empty result to undefined, so the
 *  optional `vibeTags` field stays absent (not `[]`) on drops with no tags. */
function cleanVibeTagsOrUndefined(value: unknown): VibeTag[] | undefined {
  const tags = cleanVibeTags(value);
  return tags.length ? tags : undefined;
}
import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";
import { UPLOAD_PHOTO_MAX_BYTES, uploadPhotoSizeLabel } from "@/lib/uploadBodyLimit";
import { admin, selectStore, whereVenueIdIn } from "@/lib/storeBackend";
import { STORAGE_BUCKET } from "@/lib/supabase";
import { isLiveLastTrainDecision } from "@/lib/lastTrainBadge";
import { londonDayKey } from "@/lib/pintContributions";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";

const TABLE = PINT_DROPS_TABLE;

/**
 * The ceiling on ONE Pint Index build. It is deliberately far above today's
 * confirmed count and the producer FAILS LOUD when it is reached, because a
 * silently truncated Index drops the pubs it could not fit and says nothing.
 */
export const MAX_INDEX_CONFIRMED_DROPS = 5000;

/** Bounded public reads: the visible listing never returns more than this. */
export const MAX_PUBLIC_DROPS = 500;

// The create path attaches uploaded Storage keys here before persisting. Kept
// off the core PintDrop type in lib/pintDrops.ts (photos are a Supabase-only
// concern); the in-memory store ignores them entirely.
export type PersistableDrop = PintDrop & {
  pintPhotoKey?: string;
  venuePhotoKey?: string;
  receiptPhotoKey?: string;
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
  /** The bill behind this price, signed, or null (migration 0153). */
  receiptPhotoUrl: string | null;
  reportCount?: number;
};

// Moderator read shape. Same photo-URL swap, but a moderator must see the
// evidence they are judging, so photos resolve even on hidden rows and the
// report metadata (reportedAt/reportReason/reportCount) is kept.
export type ModeratorDrop = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  receiptPhotoUrl: string | null;
};

export type PintDropPhotos = {
  pint: File | null;
  venue: File | null;
  /**
   * The photo of the BILL behind this price (captain 7 Sept 2026). A third
   * slot rather than a use of `pint`, because the three are three different
   * claims: the pint is what they drank, the venue is where, and the receipt is
   * the evidence for the figure. lib/pintDropReceipt.ts owns when it is owed.
   */
  receipt: File | null;
};

/**
 * What a create says about the rule it is written under. Only the lane that
 * STATES the daily price cap opts in, because a drop paired with a community
 * price is written under a different rule entirely (see dailyCapDay).
 */
type PintDropCreateOptions = {
  readonly underDailyPriceCap?: boolean;
};

/** The one seam the API route talks to. Both implementations below. */
export type PintDropStore = {
  /**
   * Persist a validated drop (photos where supported); returns the public DTO.
   * Throws on storage failure, and throws PintDropDailyCapError when the write
   * opted into the daily cap and the cap refuses it.
   */
  create(
    drop: PintDrop,
    photos: PintDropPhotos,
    options?: PintDropCreateOptions,
  ): Promise<PintDropDTO>;
  /**
   * Public read: visible drops + demo seeds, newest-first, capped at
   * MAX_PUBLIC_DROPS, with per-drop VISIBILITY applied server-side (issue #29).
   *
   * The returned set is what `viewer` is allowed to see on a PUBLIC surface:
   *   • public + anonymous → always (anonymous handle already withheld in the DTO);
   *   • friends → only if the viewer is the author or one of the author's followers;
   *   • legacy → excluded (ledger-only, via listLegacyForVenue) — except the author.
   *
   * `viewer` is the requester's self-asserted identity (handle + the handles they
   * follow). Omitted/anonymous viewer ⇒ public + anonymous only. This is an
   * honest-best-effort courtesy curtain (self-asserted handles, no auth yet), the
   * same trust posture as lib/notifications.ts.
   */
  /**
   * @param authorHandle When set, only drops authored by this handle (normalized)
   *   are returned — used by passport / profile surfaces so clients never pull
   *   the global public feed just to filter client-side.
   */
  listVisible(
    venueId?: string,
    viewer?: ViewerContext,
    authorHandle?: string,
    /** Scopes unscoped reads (no venueId) so Manchester demo seeds stay off London feeds. */
    cityId?: CityId | null,
  ): Promise<PintDropDTO[]>;
  /**
   * The LEGACY (family/heirloom) lane for one venue — the ledger-only capability
   * issue #27 (Family Table) can adopt (issue #29 exposes it, doesn't build its
   * UI). Returns visible `legacy` drops for the venue, newest-first, as public
   * DTOs. Legacy drops are deliberately kept OUT of listVisible's public surface,
   * so the ledger is the one place they read. Author-gating (a family group) is a
   * surface decision left for #27; this returns the venue's legacy drops.
   */
  listLegacyForVenue(venueId: string): Promise<PintDropDTO[]>;
  /** Moderator review queue: unreviewed drops in a status, with report metadata. */
  listForReview(status: PintDropReviewStatus): Promise<ModeratorDrop[]>;
  /**
   * Public report: every server-derived identity records metadata. Only distinct
   * verified accounts advance the atomic auto-hide threshold; anonymous IP
   * reports leave the count unchanged. False means unknown id.
   */
  report(
    id: string,
    reason: string | undefined,
    identity: PintDropReportIdentity,
  ): Promise<boolean>;
  /** Moderator decision: set the final status and stamp the review. False = unknown id. */
  moderate(id: string, status: PintDropStatus, note?: string): Promise<boolean>;
  /**
   * The venue's priced drops a confirmation may be derived from: visible,
   * publicly readable, newest-first, capped. Friends-only and legacy rows are
   * deliberately excluded - the Pint Index publishes what a stranger can read,
   * so a lane nobody else can see may not put a price in a citable edition.
   * The pure finder (lib/pintDropConfirmation.ts) applies the age, tolerance
   * and independence rules to what comes back.
   */
  listConfirmationCandidates(venueId: string): Promise<PintDrop[]>;
  /**
   * Record ONE minted confirmation against the drops it names, in ONE write, so
   * a pair can never end up half-confirmed. Idempotent: a drop already carrying
   * a LIVE confirmation keeps the one it has, because a later agreeing reporter
   * is more evidence rather than a second event. True means this call WROTE;
   * unknown ids and already-confirmed drops both answer false, because both
   * mean nothing changed.
   */
  confirm(
    ids: readonly string[],
    confirmation: PintDropConfirmation,
    now?: number,
  ): Promise<boolean>;
  /**
   * Every publicly readable, priced drop carrying a LIVE confirmation, newest
   * first, for the Pint Index producer. Capped at `MAX_INDEX_CONFIRMED_DROPS`;
   * the producer compares the count against that cap and refuses to publish a
   * truncated Index rather than dropping pubs in silence.
   */
  listConfirmedDrops(now?: number, limit?: number): Promise<PintDrop[]>;
  /**
   * Which of these venues the Index can date: those holding a live confirmation.
   * ONE read for the whole page, because the missions surface asks about up to
   * eight pubs at once and a per-pub read would be eight round trips for a
   * question that is one.
   */
  listConfirmedVenueIds(
    venueIds: readonly string[],
    now?: number,
  ): Promise<Set<string>>;
  /**
   * Duplicate guard (feat/price-drops-v2): true when `handle` has already logged
   * a PRICED drop at `venueId` on the current London calendar day. The route
   * pre-checks this and returns 409 before create, so one identity can't stack
   * multiple price observations at one pub in a day. Note-only anecdotes are
   * exempt (a memory is not a price observation). Both backends enforce the same
   * venue+identity+day rule against their own rows. `now` is injectable (default
   * `Date.now()`) so the London-day comparison is testable against a fixed clock.
   */
  hasPricedDropToday(venueId: string, handle: string, now?: number): Promise<boolean>;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// The wire's own ceiling, never a second figure. This said 5 MB while the
// platform refuses any body over 4.5 MB before a handler runs, so the half
// megabyte between the two was a promise nothing here could keep
// (lib/uploadBodyLimit.ts).
const MAX_PHOTO_BYTES = UPLOAD_PHOTO_MAX_BYTES;

/**
 * Pure photo check so it is testable without a real File. Returns a user-safe
 * error string, or null when the file is acceptable.
 */
export function validatePhoto(type: string, size: number, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (!ALLOWED_TYPES.has(type)) {
    return "Photo must be a JPEG, PNG, or WebP image.";
  }
  if (size > maxBytes) {
    return `Photo must be ${uploadPhotoSizeLabel(maxBytes)} or smaller.`;
  }
  return null;
}

/**
 * Content-sniff the leading bytes against the declared MIME so a client can't
 * pass the type/size check with a mislabelled or crafted file (e.g. a script
 * renamed .jpg). Pure so it is testable without a real File. JPEG = FF D8 FF,
 * PNG = 89 50 4E 47 0D 0A 1A 0A, WebP = "RIFF"....\"WEBP" (bytes 8..11).
 * Unknown MIME is rejected — validatePhoto has already gated the allow-list,
 * this is defence in depth on the same allow-list.
 *
 * Re-exported from lib/imageSafety.ts (Issue #33), which is the pure,
 * dependency-free home for magic-byte detection AND metadata stripping. Kept
 * as a named export here too so existing callers/tests are unaffected.
 */
export const magicBytesOk = magicBytesOkPure;

async function recordAnonymousReport(
  id: string,
  reason: string | undefined,
  actorHash: string,
): Promise<boolean> {
  const { data, error } = await admin().rpc("report_pint_drop_anonymous", {
    p_id: id,
    p_actor_hash: actorHash,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// pint_drops (snake_case) <-> PintDrop (camelCase). Kept in one place so a
// column rename is a one-line change on each side.
function toRow(drop: PersistableDrop, capDay: string | null = null) {
  return {
    id: drop.id,
    venue_id: drop.venueId,
    handle: drop.handle,
    drink: drop.drink,
    // The SERVING the price is about (migration 0147). Written explicitly on
    // every create rather than left to the column default, so a row always
    // states its own lane instead of inheriting one.
    measure: cleanDrinkMeasure(drop.measure),
    measure_label: drop.measureLabel ?? null,
    price_gbp: drop.priceGbp,
    passed_down_note: drop.passedDownNote,
    era: drop.era,
    // Persisted as a dedicated text[]/jsonb column (`vibe_tags`) — the values
    // are already a server-filtered subset of VIBE_TAGS, so this is a plain
    // one-line map on each side (like every other field here). Defaults to an
    // empty array so an old row / notes-only drop round-trips cleanly.
    vibe_tags: drop.vibeTags ?? [],
    // Per-drop visibility (issue #29). Defaults to 'public' so an old row / a
    // write that omits it stays public — matches the DB column default.
    visibility: visibilityOf(drop),
    pint_photo_key: drop.pintPhotoKey ?? null,
    venue_photo_key: drop.venuePhotoKey ?? null,
    receipt_photo_key: drop.receiptPhotoKey ?? null,
    provenance: drop.provenance,
    status: drop.status,
    created_at: drop.createdAt,
    authority_key: drop.authorityKey ?? null,
    // The London day this drop CLAIMS under the daily price cap (migration
    // 0141), or null when it claims none. Passed in rather than derived here,
    // because the cap is a WRITE PATH's rule and not a property of the drop:
    // see dailyCapDay() for which writes claim a day and why.
    price_day: capDay,
    // Confirmation is minted by the server AFTER a drop lands (a drop cannot
    // confirm itself), so a create always writes the empty shape. Kept in this
    // one mapper so a column rename stays a one-line change on each side.
    confirmation_id: drop.confirmation?.confirmationId ?? null,
    confirmed_at: drop.confirmation?.confirmedAt ?? null,
    confirmation_basis: drop.confirmation?.basis ?? null,
    confirming_drop_id: drop.confirmation?.confirmingDropId ?? null,
    reported_at: drop.reportedAt ?? null,
    report_reason: drop.reportReason ?? null,
    report_count: drop.reportCount ?? 0,
    moderated_at: drop.moderatedAt ?? null,
    moderator_note: drop.moderatorNote ?? null,
    // Wave G1 / F0: optional Last Train context captured at Spill compose time.
    // Null when the composer had no live decision (or TfL was down).
    leave_by_iso: drop.leaveByIso ?? null,
    last_train_decision: drop.lastTrainDecision ?? null,
  };
}

/**
 * The minted confirmation a row carries, or undefined. Every field has to be
 * present and the basis has to be one we know, because a half-written
 * confirmation is not evidence: the Pint Index cites `confirmationId`, and a
 * row that cannot say when or on what basis it was confirmed may not be cited.
 */
function confirmationFromRow(
  row: Record<string, unknown>,
): PintDropConfirmation | undefined {
  const confirmationId =
    typeof row.confirmation_id === "string" ? row.confirmation_id.trim() : "";
  const confirmedAt = row.confirmed_at ? String(row.confirmed_at) : "";
  const basis = row.confirmation_basis;
  if (!confirmationId || !confirmedAt || !isPintDropConfirmationBasis(basis)) {
    return undefined;
  }
  const confirmingDropId =
    typeof row.confirming_drop_id === "string" && row.confirming_drop_id.trim()
      ? row.confirming_drop_id
      : undefined;
  return {
    confirmationId,
    confirmedAt: new Date(confirmedAt).toISOString(),
    basis,
    ...(confirmingDropId ? { confirmingDropId } : {}),
  };
}

/**
 * The free measure label a row carries, or undefined. Only an `other` measure
 * may carry one: a label beside `pint` or `half` would be a second name for a
 * measure that already names itself.
 */
function measureLabelFromRow(row: Record<string, unknown>): string | undefined {
  if (cleanDrinkMeasure(row.measure) !== "other") return undefined;
  const label = cleanDrinkMeasureLabel(row.measure_label);
  return label || undefined;
}

export function pintDropReportCountFromRow(row: Record<string, unknown>): number | undefined {
  const value = row.verified_report_count ?? row.report_count;
  return value === null || value === undefined ? undefined : Number(value);
}

function fromRow(row: Record<string, unknown>): PersistableDrop {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    handle: String(row.handle),
    drink: String(row.drink ?? ""),
    // Coerce on the way out too (defence in depth): a row written before 0147,
    // or a hand-edited value, collapses to `pint` - the lane it already had.
    measure: cleanDrinkMeasure(row.measure),
    measureLabel: measureLabelFromRow(row),
    priceGbp: row.price_gbp === null || row.price_gbp === undefined ? null : Number(row.price_gbp),
    passedDownNote: String(row.passed_down_note ?? ""),
    era: String(row.era ?? ""),
    // Re-filter on the way out too (defence in depth): a hand-edited or legacy
    // row can't smuggle an off-allowlist tag into a public read. Undefined when
    // empty so the field stays cleanly optional on old rows.
    vibeTags: cleanVibeTagsOrUndefined(row.vibe_tags),
    provenance: row.provenance as Provenance,
    status: row.status as PintDropStatus,
    // Coerce on the way out too (defence in depth): an old row (pre-0012, column
    // absent → undefined) or a hand-edited value collapses to the safe `public`.
    visibility: cleanVisibility(row.visibility),
    createdAt: String(row.created_at),
    // Absent on a cluster without 0150, and on every row whose author is still
    // here. `select("*")` is what keeps the column additive.
    authorRetiredAt: authorRetiredAtFromRow(row.author_retired_at),
    authorityKey:
      typeof row.authority_key === "string" && row.authority_key.trim()
        ? row.authority_key
        : undefined,
    confirmation: confirmationFromRow(row),
    pintPhotoKey: row.pint_photo_key ? String(row.pint_photo_key) : undefined,
    venuePhotoKey: row.venue_photo_key ? String(row.venue_photo_key) : undefined,
    receiptPhotoKey: row.receipt_photo_key ? String(row.receipt_photo_key) : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    reportCount: pintDropReportCountFromRow(row),
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
    leaveByIso: row.leave_by_iso ? String(row.leave_by_iso) : undefined,
    lastTrainDecision: (() => {
      const raw = row.last_train_decision ? String(row.last_train_decision) : "";
      return isLiveLastTrainDecision(raw) ? raw : undefined;
    })(),
  };
}

// A Storage key becomes a signed URL only when access is granted — hidden/pending
// drops read as null so a reported photo stops being served. Keys never reach
// the client. Signed URLs expire (SIGNED_URL_TTL_SEC) so a previously-shared
// public URL cannot keep working after takedown once the bucket is private.
const SIGNED_URL_TTL_SEC = 3600;

/** Resolve one Storage object to a short-lived signed URL, or null when denied. */
export async function resolveStorageUrl(
  key: string | null | undefined,
  grant: boolean,
): Promise<string | null> {
  if (!key || !grant) return null;
  try {
    const { data, error } = await admin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Resolve many Storage keys to signed URLs in one (or few) Storage API calls. */
async function resolveStorageUrlsBatch(
  keys: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter((k): k is string => typeof k === "string" && k.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const { data, error } = await admin()
        .storage.from(STORAGE_BUCKET)
        .createSignedUrls(chunk, SIGNED_URL_TTL_SEC);
      if (error || !data) continue;
      for (const row of data) {
        if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
      }
    } catch {
      // Fall through — callers treat missing keys as null URLs.
    }
  }
  return out;
}

async function resolveDropPhotoUrls(
  drop: PersistableDrop,
  grant: boolean,
  urlByKey?: Map<string, string>,
): Promise<{ pint: string | null; venue: string | null; receipt: string | null }> {
  if (!grant) return { pint: null, venue: null, receipt: null };
  if (urlByKey) {
    return {
      pint: drop.pintPhotoKey ? (urlByKey.get(drop.pintPhotoKey) ?? null) : null,
      venue: drop.venuePhotoKey ? (urlByKey.get(drop.venuePhotoKey) ?? null) : null,
      receipt: drop.receiptPhotoKey ? (urlByKey.get(drop.receiptPhotoKey) ?? null) : null,
    };
  }
  const [pint, venue, receipt] = await Promise.all([
    resolveStorageUrl(drop.pintPhotoKey, true),
    resolveStorageUrl(drop.venuePhotoKey, true),
    resolveStorageUrl(drop.receiptPhotoKey, true),
  ]);
  return { pint, venue, receipt };
}

/** Public DTO with signed photo URLs (Supabase path). */
export async function toDTOWithPhotos(
  drop: PersistableDrop,
  urlByKey?: Map<string, string>,
): Promise<PintDropDTO> {
  const grant = drop.status === "visible";
  return toDTO(drop, await resolveDropPhotoUrls(drop, grant, urlByKey));
}

/** Moderator DTO with signed photo URLs (evidence must resolve for review). */
async function toModeratorDTOWithPhotos(
  drop: PersistableDrop,
  urlByKey?: Map<string, string>,
): Promise<ModeratorDrop> {
  return toModeratorDTO(drop, await resolveDropPhotoUrls(drop, true, urlByKey));
}

async function toDTOsWithBatchedPhotos(drops: PersistableDrop[]): Promise<PintDropDTO[]> {
  const keys = drops.flatMap((d) =>
    d.status === "visible" ? [d.pintPhotoKey, d.venuePhotoKey, d.receiptPhotoKey] : [],
  );
  const urlByKey = await resolveStorageUrlsBatch(keys);
  return Promise.all(drops.map((d) => toDTOWithPhotos(d, urlByKey)));
}

async function toModeratorDTOsWithBatchedPhotos(drops: PersistableDrop[]): Promise<ModeratorDrop[]> {
  const keys = drops.flatMap((d) => [d.pintPhotoKey, d.venuePhotoKey, d.receiptPhotoKey]);
  const urlByKey = await resolveStorageUrlsBatch(keys);
  return Promise.all(drops.map((d) => toModeratorDTOWithPhotos(d, urlByKey)));
}

/** Public DTO: strip Storage keys AND report/moderation metadata, emit photo
 *  URLs. The only shape the public API returns. `reportCount` is the single
 *  transparency exception — surfaced ONLY as a bare count, ONLY on a visible
 *  drop that has actually been reported (> 0), so a reporter sees their report
 *  land. Reasons, reporter metadata, moderator notes, and hidden photos are
 *  never exposed. Pass `photoUrls` from resolveDropPhotoUrls on the Supabase path. */
export function toDTO(
  drop: PersistableDrop,
  photoUrls?: { pint: string | null; venue: string | null; receipt: string | null },
): PintDropDTO {
  const visible = drop.status === "visible";
  const visibility = visibilityOf(drop);
  // ANONYMITY GUARANTEE (issue #29): an `anonymous` drop's real handle NEVER
  // rides a public DTO — it is swapped for ANON_HANDLE_LABEL here, the ONE public
  // choke point every backend routes through. The real handle stays server-side
  // (row/moderation/rate-limits) and only leaves via toModeratorDTO. The price,
  // note, tags, and photos are still public content on an anonymous drop — only
  // the identity is withheld.
  // A RETIRED AUTHOR reads the same way and for the same reason: the account
  // that logged this price has left, so the observation stays public and the
  // identity does not (migration 0150, `lib/retiredContributor.ts`). It changes
  // the NAME alone — the price, the measure, the date and the authority key
  // below are untouched, so the drop keeps whatever trust state it earned.
  const handle =
    visibility === "anonymous"
      ? ANON_HANDLE_LABEL
      : publicContributorHandle(drop.handle, drop.authorRetiredAt);
  const dto: PintDropDTO = {
    id: drop.id,
    venueId: drop.venueId,
    handle,
    drink: drop.drink,
    // PUBLIC, and it has to be: the browser's own drop lanes (lib/venues.ts)
    // hold a non-pint row out of the pint lane, and a DTO that withheld the
    // measure would leave every reader defaulting a half back to a pint.
    measure: cleanDrinkMeasure(drop.measure),
    priceGbp: drop.priceGbp,
    passedDownNote: drop.passedDownNote,
    era: drop.era,
    provenance: drop.provenance,
    status: drop.status,
    visibility,
    createdAt: drop.createdAt,
    pintPhotoUrl: visible ? (photoUrls?.pint ?? null) : null,
    venuePhotoUrl: visible ? (photoUrls?.venue ?? null) : null,
    receiptPhotoUrl: visible ? (photoUrls?.receipt ?? null) : null,
  };
  if (drop.measureLabel) dto.measureLabel = drop.measureLabel;
  // The authority key is a per-venue pseudonym for one verified account, so on
  // an ANONYMOUS drop it would name the drinker: the same account's public drop
  // at that pub carries the same key beside its real handle. The key rides the
  // public DTO only in the `public` lane; the anonymous row keeps its key
  // server-side, where the confirmation producer reads it (#1436).
  if (drop.authorityKey && visibility !== "anonymous") {
    dto.authorityKey = drop.authorityKey;
  }
  // A confirmation is public: it is the whole point of the green pill, and the
  // record names two drop ids, never two people.
  if (drop.confirmation) dto.confirmation = drop.confirmation;
  // Vibe tags are public, safe content — always exposed when present. Kept
  // additive (absent, not []) so the public JSON shape stays backward-compatible.
  if (drop.vibeTags && drop.vibeTags.length) dto.vibeTags = drop.vibeTags;
  if (visible && (drop.reportCount ?? 0) > 0) dto.reportCount = drop.reportCount;
  if (drop.leaveByIso) dto.leaveByIso = drop.leaveByIso;
  if (drop.lastTrainDecision) dto.lastTrainDecision = drop.lastTrainDecision;
  return dto;
}

/** Moderator DTO: strip Storage keys but resolve photos even on hidden rows —
 *  the reviewer must see the evidence. Report metadata rides along. */
export function toModeratorDTO(
  drop: PersistableDrop,
  photoUrls?: { pint: string | null; venue: string | null; receipt: string | null },
): ModeratorDrop {
  const { pintPhotoKey, venuePhotoKey, receiptPhotoKey, ...rest } = drop;
  void pintPhotoKey;
  void venuePhotoKey;
  void receiptPhotoKey;
  return {
    ...rest,
    pintPhotoUrl: photoUrls?.pint ?? null,
    venuePhotoUrl: photoUrls?.venue ?? null,
    receiptPhotoUrl: photoUrls?.receipt ?? null,
  };
}

/** L4: the ONE merge point for organic drops + demo seeds — newest-first,
 *  hard-capped. Both implementations route their public read through this. */
function newestFirstCapped<T extends { createdAt: string }>(drops: T[]): T[] {
  return [...drops]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PUBLIC_DROPS);
}

/**
 * Keep memory and Supabase report DTOs on one authority boundary. A memory
 * drop may carry a legacy `reportCount`; the verified ledger is authoritative
 * once its column exists, including its zero value for legacy-only rows.
 */
function withVerifiedReportCount(drop: PersistableDrop): PersistableDrop {
  return { ...drop, reportCount: verifiedPintDropReportCount(drop.id) ?? 0 };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Wraps the process-memory primitives in lib/pintDrops.ts. Resets on restart —
// right for dev/demo; production refuses it at the route.
/**
 * Withdrawn authors leave every public read. The author's own read (their
 * export, their own feed) keeps their drops: withdrawal is about what the
 * public sees, never about what an account may read of itself.
 */
function dropWithdrawnFromViewer<T extends { handle: string }>(
  drops: readonly T[],
  viewer?: ViewerContext,
): Promise<T[]> {
  const own = normalizeViewerHandle(viewer?.handle);
  return dropWithdrawnAuthors(drops, (d) =>
    own && normalizeViewerHandle(d.handle) === own ? null : d.handle,
  );
}

/** Each stored id of the requested venues, mapped to the requested id it answers for. */
async function requestedIdByStoredId(venueIds: Iterable<string>): Promise<Map<string, string>> {
  const aliases = await loadVenueAliasResolver();
  const requestedOf = new Map<string, string>();
  for (const venueId of venueIds) {
    for (const storedId of aliases.storedIds(venueId)) {
      if (!requestedOf.has(storedId)) requestedOf.set(storedId, venueId);
    }
  }
  return requestedOf;
}

/** The memory mirror of the daily cap, asked across every id the venue's drops may carry. */
async function hasPricedDropTodayAcrossIds(
  venueId: string,
  handle: string,
  day: Date,
): Promise<boolean> {
  return (await storedVenueIds(venueId)).some((id) => hasPricedDropTodayMemory(id, handle, day));
}

export const memoryPintDropStore: PintDropStore = {
  async create(drop, _photos, options) {
    // The same hard guard the Supabase backend gets from
    // pint_drops_priced_day_unique_idx (0141), over the same writes: the route's
    // pre-check and this create sit either side of an await, so two in-flight
    // requests can both read "no price yet" here exactly as they could against
    // Postgres. Asked against the drop's OWN day, so the row and the rule agree.
    if (
      dailyCapDay(drop, options) !== null &&
      (await hasPricedDropTodayAcrossIds(drop.venueId, drop.handle, new Date(drop.createdAt)))
    ) {
      throw new PintDropDailyCapError();
    }
    addPintDrop(drop); // photos ignored: there is no Storage without Supabase
    return toDTO(drop);
  },
  async listVisible(venueId, viewer, authorHandle, cityId) {
    const rows = venueId
      ? (await storedVenueIds(venueId)).flatMap((id) => listVisiblePintDrops(id))
      : listAllVisiblePintDrops(cityId);
    const author = normalizeViewerHandle(authorHandle);
    // Visibility applied server-side (issue #29). Legacy is EXCLUDED from the
    // public surface for EVERYONE (including the author — they read it via the
    // ledger's listLegacyForVenue, not the feed), matching the Supabase backend's
    // `.neq("visibility","legacy")`. Friends is then gated on the viewer's follow
    // graph; public + anonymous always pass (anonymous handle withheld at toDTO).
    const permitted = rows.filter(
      (d) =>
        visibilityOf(d) !== "legacy" &&
        canViewOnPublicSurface(d, viewer) &&
        (!author || normalizeViewerHandle(d.handle) === author),
    );
    const published = await dropWithdrawnFromViewer(permitted, viewer);
    return newestFirstCapped(published).map((d) => toDTO(withVerifiedReportCount(d)));
  },
  async listLegacyForVenue(venueId) {
    const published = await dropWithdrawnAuthors(
      (await storedVenueIds(venueId)).flatMap((id) => listLegacyPintDropsForVenue(id)),
      (d) => d.handle,
    );
    return newestFirstCapped(published).map((d) =>
      toDTO(withVerifiedReportCount(d)),
    );
  },
  async listForReview(status) {
    const rows =
      status === "reported"
        ? listReportedPintDrops()
        : status === "confirmed"
          ? listConfirmedPintDrops()
          : listByStatus(status);
    return rows
      .slice(0, MAX_PUBLIC_DROPS)
      .map((d) => toModeratorDTO(withVerifiedReportCount(d)));
  },
  async listConfirmationCandidates(venueId) {
    return newestFirstCapped(
      (await storedVenueIds(venueId))
        .flatMap((id) => listVisiblePintDrops(id))
        .filter((d) => d.priceGbp !== null && isPubliclyReadableDrop(d)),
    );
  },
  async confirm(ids, confirmation, now = Date.now()) {
    let wrote = false;
    for (const id of ids) {
      if (confirmPintDrop(id, confirmation, now)) wrote = true;
    }
    return wrote;
  },
  async listConfirmedDrops(now = Date.now(), limit = MAX_INDEX_CONFIRMED_DROPS) {
    return listConfirmedPintDrops()
      .filter(
        (drop) =>
          drop.priceGbp !== null &&
          isPubliclyReadableDrop(drop) &&
          confirmationIsLive(drop.confirmation, now),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
  async listConfirmedVenueIds(venueIds, now = Date.now()) {
    const requestedOf = await requestedIdByStoredId(venueIds);
    const dated = new Set<string>();
    for (const drop of listConfirmedPintDrops()) {
      const requested = requestedOf.get(drop.venueId);
      if (!requested) continue;
      if (!isPubliclyReadableDrop(drop)) continue;
      if (!confirmationIsLive(drop.confirmation, now)) continue;
      dated.add(requested);
    }
    return dated;
  },
  async report(id, reason, identity) {
    return reportPintDrop(id, reason, identity);
  },
  async moderate(id, status, note) {
    return status === "visible" ? restorePintDrop(id, note) : keepHiddenPintDrop(id, note);
  },
  async hasPricedDropToday(venueId, handle, now = Date.now()) {
    return hasPricedDropTodayAcrossIds(venueId, handle, new Date(now));
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

// Same additive-rollout guard as isMissingVibeTagsColumnError, for the
// `visibility` column (migration 0012). Matches ONLY a missing-`visibility`
// column error (42703 undefined_column / PGRST204 schema-cache miss that names
// the column), so a coincidental 42703 on some other column still throws.
function isMissingVisibilityColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("visibility");
}

// Additive-rollout guard for verified Pint Price authority (migration 0117).
// A pre-migration database may still keep the Pint Drop, but it must keep it as
// provisional. The retry therefore removes the key from both the inserted row
// and the returned DTO.
function isMissingAuthorityKeyColumnError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    (code === "42703" || code === "PGRST204") &&
    message.includes("authority_key")
  );
}

// Additive-rollout guard for the confirmation columns (migration 0140). The
// code ships before the owner applies the migration, so a create must keep the
// drop and simply carry no confirmation: a drinker's price is not worth losing
// over a standing nobody has earned yet.
function isMissingConfirmationColumnError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentions =
    message.includes("confirmation_id") ||
    message.includes("confirmed_at") ||
    message.includes("confirmation_basis") ||
    message.includes("confirming_drop_id");
  return (code === "42703" || code === "PGRST204") && mentions;
}

// Additive-rollout guard for the daily-cap day stamp (migration 0141). The code
// ships before the owner applies the migration, so a create must keep the drop
// and simply carry no stamp: on that server the cap is the pre-check alone,
// exactly as it was before this change.
function isMissingPriceDayColumnError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("price_day");
}

/**
 * WHICH WRITES THE DAILY CAP GOVERNS, in one function (migration 0141).
 *
 * The cap is stated by POST /api/pint-drops and enforced there: one PRICED drop
 * per venue + identity + London day. It is NOT a rule about the table, because
 * POST /api/price-submit pairs a Pint Drop with every community price a drinker
 * sends, and that lane deliberately takes several from one account at one pub in
 * one day (its own rate limiter is the only thing that stops it). A guard over
 * every row would refuse the second of those, so the caller says whether its
 * write is under the cap and only those writes claim a day.
 *
 * The day itself is londonDayKey() of the drop's own createdAt, the same
 * function hasPricedDropToday() compares against, so the soft pre-check and the
 * hard index behind it cannot read one day differently. A note-only memory
 * claims nothing: it is not a price observation.
 */
function dailyCapDay(
  drop: PersistableDrop,
  options: PintDropCreateOptions | undefined,
): string | null {
  if (!options?.underDailyPriceCap) return null;
  if (drop.priceGbp === null) return null;
  return londonDayKey(drop.createdAt) || null;
}

/**
 * The daily cap, refused by the DATABASE rather than by the pre-check in front
 * of it (migration 0141, pentest F-1). A concurrent burst is exactly the case
 * the pre-check cannot see: every request reads "no price yet" before any row
 * lands. `pint_drops_priced_day_unique_idx` is what actually holds the rule, so
 * one of those inserts wins and the rest arrive here.
 *
 * It is a REFUSAL, not a fault: the route answers it with the same 409 and the
 * same sentence the pre-check gives, so a drinker cannot tell which enforcer
 * turned them away.
 */
export class PintDropDailyCapError extends Error {
  readonly code = "PINT_DROP_DAILY_PRICE_CAP";
  constructor() {
    super("A priced Pint Drop for this venue, handle and London day already exists.");
    this.name = "PintDropDailyCapError";
  }
}

/** The one question a caller asks about that refusal. */
export function isPintDropDailyCapError(error: unknown): error is PintDropDailyCapError {
  return error instanceof PintDropDailyCapError;
}

// 23505 on the daily-cap index alone. Named, because pint_drops carries other
// unique indexes (the primary key) and a bare 23505 would answer 409 for a
// collision that is not this rule at all.
function isDailyPriceCapViolation(error: {
  code?: string;
  message?: string;
  details?: string;
} | null): boolean {
  if (!error) return false;
  if ((error.code ?? "") !== "23505") return false;
  const said = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return said.includes("pint_drops_priced_day_unique_idx");
}

/**
 * Additive-rollout guard for the measure columns (migration 0147).
 *
 * A PINT retries without the two columns and loses nothing: an absent measure
 * reads as `pint` at every reader, which is exactly what the lane assumed of
 * every row written before 0147.
 *
 * A HALF DOES NOT. Dropping the column there would store the figure as a pint
 * and hand it to pin colour, the cheapest buckets and the Pint Index - battle
 * test D04, reintroduced by a retry. `create` therefore keeps the refusal for a
 * non-pint drop on a pre-0147 database, and the route answers the ordinary 503,
 * so the drinker is told the price did not land rather than seeing it land as
 * something they did not report.
 */
function isMissingMeasureColumnError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentions =
    message.includes("measure_label") || message.includes("measure");
  return (code === "42703" || code === "PGRST204") && mentions;
}

/**
 * Additive-rollout guard for the receipt column (migration 0153).
 *
 * The RULE is the write door's (lib/pintDropReceipt.ts) and it reads no column,
 * so a deploy that lands before the captain applies 0153 still refuses a price
 * with no bill. What it must not do is refuse the price because it cannot store
 * the key: the drop is saved without it, and a photo is lost where a price
 * would have been.
 */
function isMissingReceiptColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("receipt_photo_key");
}

// Additive-rollout guard for Wave G1 Last Train columns (migration 0021).
function isMissingLastTrainColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentions =
    message.includes("leave_by_iso") || message.includes("last_train_decision");
  return (code === "42703" || code === "PGRST204") && mentions;
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabasePintDropStore: PintDropStore = {
  async create(drop, photos, options) {
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
      if (photos.receipt) {
        // A BILL WE COULD NOT STORE MAY NOT COST THE PRICE. The file is still
        // refused when the file is the problem (PhotoRefusalError → 400), but a
        // Storage outage is a fact about US, and this module's own law is that
        // nothing here fails a Pint Drop over one. The drop lands with its
        // figure and no receipt key, and the loss is logged rather than shown
        // to a drinker who did exactly what was asked.
        try {
          persistable.receiptPhotoKey = await uploadPhoto(
            "receipt",
            drop.venueId,
            drop.id,
            photos.receipt,
          );
          uploaded.push(persistable.receiptPhotoKey);
        } catch (err) {
          if (err instanceof PhotoRefusalError) throw err;
          log("warn", "pint_drops.receipt_upload_failed", {
            venueId: drop.venueId,
            dropId: drop.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      let row = toRow(persistable, dailyCapDay(drop, options));
      // EVERY insert attempt goes through here, because the daily cap is now a
      // unique index (0141) and a retry can hit it just as the first attempt
      // can. A cap violation leaves the try immediately: it is the rule working,
      // not a storage fault, and the catch below tells the two apart.
      const insert = async (candidate: typeof row) => {
        const { error: insertError } = await admin().from(TABLE).insert(candidate);
        if (isDailyPriceCapViolation(insertError)) throw new PintDropDailyCapError();
        return insertError;
      };
      // First attempt includes vibe_tags + Last Train columns. Once migrations
      // 0005 / 0021 are applied this is the only path that ever runs.
      let error = await insert(row);
      if (error && isMissingPriceDayColumnError(error)) {
        console.warn(
          "[pint-drops] price_day missing - the daily cap is the pre-check alone until migration 0141 is applied:",
          error.message,
        );
        const { price_day: _omitPriceDay, ...rowWithoutPriceDay } = row;
        void _omitPriceDay;
        row = rowWithoutPriceDay as typeof row;
        error = await insert(row);
      }
      if (error && isMissingAuthorityKeyColumnError(error)) {
        console.warn(
          "[pint-drops] authority_key missing - saving this drop as provisional (apply migration 0117):",
          error.message,
        );
        const { authority_key: _omitAuthority, ...rowWithoutAuthority } = row;
        void _omitAuthority;
        delete persistable.authorityKey;
        row = rowWithoutAuthority as typeof row;
        error = await insert(row);
      }
      if (error && isMissingConfirmationColumnError(error)) {
        console.warn(
          "[pint-drops] confirmation columns missing - saving this drop unconfirmed (apply migration 0140):",
          error.message,
        );
        const {
          confirmation_id: _omitConfirmationId,
          confirmed_at: _omitConfirmedAt,
          confirmation_basis: _omitBasis,
          confirming_drop_id: _omitConfirmingDrop,
          ...rowWithoutConfirmation
        } = row;
        void _omitConfirmationId;
        void _omitConfirmedAt;
        void _omitBasis;
        void _omitConfirmingDrop;
        delete persistable.confirmation;
        row = rowWithoutConfirmation as typeof row;
        error = await insert(row);
      }
      if (error && isMissingReceiptColumnError(error)) {
        console.warn(
          "[pint-drops] receipt_photo_key missing - saving this drop without its bill photo (apply migration 0153):",
          error.message,
        );
        const { receipt_photo_key: _omitReceipt, ...rowWithoutReceipt } = row;
        void _omitReceipt;
        delete persistable.receiptPhotoKey;
        row = rowWithoutReceipt as typeof row;
        error = await insert(row);
      }
      if (error && isMissingMeasureColumnError(error)) {
        if (!measureIsPint(persistable.measure)) {
          // The one retry this ladder refuses. See the guard's own note: a half
          // stored without its measure is a half published as a pint.
          throw new Error(
            "This pub's price store cannot record a measure yet (apply migration 0147).",
          );
        }
        console.warn(
          "[pint-drops] measure columns missing - inserting this pint without them (apply migration 0147):",
          error.message,
        );
        const {
          measure: _omitMeasure,
          measure_label: _omitMeasureLabel,
          ...rowWithoutMeasure
        } = row;
        void _omitMeasure;
        void _omitMeasureLabel;
        row = rowWithoutMeasure as typeof row;
        error = await insert(row);
      }
      if (error && isMissingLastTrainColumnError(error)) {
        console.warn(
          "[pint-drops] leave_by_iso/last_train_decision missing — inserting without them (apply migration 0021):",
          error.message,
        );
        const {
          leave_by_iso: _omitLeave,
          last_train_decision: _omitDecision,
          ...rowWithoutLastTrain
        } = row;
        void _omitLeave;
        void _omitDecision;
        row = rowWithoutLastTrain as typeof row;
        error = await insert(row);
      }
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
        const retryError = await insert(rowWithoutVibeTags as typeof row);
        if (retryError) throw new Error(retryError.message);
      }
    } catch (err) {
      // A cap refusal is the rule holding, not an outage, so it may not be
      // logged as one: an error line per refused duplicate would read as a
      // storage failure in every dashboard. It still cleans up its photos and
      // still rethrows, and the route answers the ordinary 409.
      if (isPintDropDailyCapError(err)) {
        log("warn", "pint_drops.daily_cap_conflict", {
          dropId: drop.id,
          venueId: drop.venueId,
          uploadedCount: uploaded.length,
        });
        await deletePhotos(uploaded);
        throw err;
      }
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
    return toDTOWithPhotos(persistable);
  },

  /** Demo seeds (in-repo, never written to Supabase) merge with the organic
   *  rows in newestFirstCapped so both backends serve one read-merge path. */
  async listVisible(venueId, viewer, authorHandle, cityId) {
    const author = normalizeViewerHandle(authorHandle);
    const venueIds = venueId ? await storedVenueIds(venueId) : [];
    // Base visible read, newest-first, capped. Split from the visibility filter
    // so we can retry WITHOUT it if migration 0012 isn't applied to this DB yet
    // (pre-0012 every row is effectively `public`, so an unfiltered read is safe).
    const base = () => {
      let q = admin()
        .from(TABLE)
        .select("*")
        .eq("status", "visible")
        .order("created_at", { ascending: false })
        .limit(MAX_PUBLIC_DROPS);
      if (venueIds.length === 1) q = q.eq("venue_id", venueIds[0]);
      else if (venueIds.length > 1) q = q.in("venue_id", venueIds);
      if (author) q = q.eq("handle", author);
      return q;
    };
    // Legacy (family/heirloom) drops NEVER ride the public surface — they read
    // only via listLegacyForVenue (the ledger). Excluding them at the DB keeps
    // their price/note/handle out of every public signal (issue #29). `friends`
    // gating is per-viewer, applied in memory below.
    let { data, error } = await base().neq("visibility", "legacy");
    if (error && isMissingVisibilityColumnError(error)) {
      console.warn(
        "[pint-drops] visibility column missing — reading without the visibility filter (apply migration 0012):",
        error.message,
      );
      ({ data, error } = await base());
    }
    if (error) throw new Error(error.message);
    // Per-venue: all city seeds for that id. Unscoped: city-scoped seeds so
    // Manchester demo drops never noise the London feed/landing.
    const seeds = (
      venueId ? venueIds.flatMap((id) => demoDropsFor(id)) : demoPintDropsForCity(cityId)
    ).filter(
      (d) => !author || normalizeViewerHandle(d.handle) === author,
    );
    // Apply the same pure predicate the memory store uses over the fetched page.
    // Legacy is already excluded above; public + anonymous always pass, friends
    // gate on the viewer's follow graph. Unscoped reads also city-scope organic
    // rows by venue id prefix (venue-mcr- ↔ Manchester).
    const permitted = (data ?? [])
      .map(fromRow)
      .concat(seeds)
      .filter((d) => venueId || dropMatchesCityScope(d.venueId, cityId))
      .filter((d) => canViewOnPublicSurface(d, viewer));
    const published = await dropWithdrawnFromViewer(permitted, viewer);
    const capped = newestFirstCapped(published);
    return toDTOsWithBatchedPhotos(capped);
  },

  /** The LEGACY lane for one venue (ledger-only capability for issue #27).
   *  Visible `legacy` rows for the venue, newest-first, as public DTOs. */
  async listLegacyForVenue(venueId) {
    const venueIds = await storedVenueIds(venueId);
    const scoped = admin()
      .from(TABLE)
      .select("*")
      .eq("status", "visible")
      .eq("visibility", "legacy");
    const query = (
      venueIds.length === 1 ? scoped.eq("venue_id", venueIds[0]) : scoped.in("venue_id", venueIds)
    )
      .order("created_at", { ascending: false })
      .limit(MAX_PUBLIC_DROPS);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const published = await dropWithdrawnAuthors((data ?? []).map(fromRow), (d) => d.handle);
    const rows = newestFirstCapped(published);
    return toDTOsWithBatchedPhotos(rows);
  },

  async listForReview(status) {
    const reviewQuery = () => {
      if (status === "reported") {
        return admin()
          .from(TABLE)
          .select("*")
          .eq("status", "visible")
          .not("reported_at", "is", null)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(MAX_PUBLIC_DROPS);
      }
      if (status === "confirmed") {
        return admin()
          .from(TABLE)
          .select("*")
          .eq("status", "visible")
          .not("confirmation_id", "is", null)
          .order("confirmed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(MAX_PUBLIC_DROPS);
      }
      return admin()
        .from(TABLE)
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(MAX_PUBLIC_DROPS);
    };
    const { data, error } = await reviewQuery();
    if (error) throw new Error(error.message);
    return toModeratorDTOsWithBatchedPhotos((data ?? []).map(fromRow));
  },

  /** The venue's publicly readable priced drops, newest-first. The window,
   *  tolerance and independence rules stay in the pure finder. */
  async listConfirmationCandidates(venueId) {
    const { data, error } = await whereVenueIdIn(
      admin().from(TABLE).select("*").eq("status", "visible"),
      await storedVenueIds(venueId),
    )
      .in("visibility", ["public", "anonymous"])
      .not("price_gbp", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_PUBLIC_DROPS);
    if (error) throw new Error(error.message);
    return newestFirstCapped((data ?? []).map(fromRow));
  },

  /**
   * ONE statement over both named drops, so a pair is confirmed together or not
   * at all. The `or` filter is the idempotence guard the memory mirror applies
   * in JS: write only where nothing is confirmed yet, or where the confirmation
   * on record has already aged out of the trust window. Returns the ids it
   * actually wrote, so a replay reports honestly that it changed nothing.
   */
  async confirm(ids, confirmation, now = Date.now()) {
    if (ids.length === 0) return false;
    const staleBefore = new Date(now - PRICE_AUTHORITY_MAX_AGE_MS).toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .update({
        confirmation_id: confirmation.confirmationId,
        confirmed_at: confirmation.confirmedAt,
        confirmation_basis: confirmation.basis,
        confirming_drop_id: confirmation.confirmingDropId ?? null,
      })
      .in("id", [...ids])
      .or(`confirmation_id.is.null,confirmed_at.lt.${staleBefore}`)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },

  async listConfirmedDrops(now = Date.now(), limit = MAX_INDEX_CONFIRMED_DROPS) {
    const liveSince = new Date(now - PRICE_AUTHORITY_MAX_AGE_MS).toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .select("*")
      .eq("status", "visible")
      .in("visibility", ["public", "anonymous"])
      .not("price_gbp", "is", null)
      .not("confirmation_id", "is", null)
      .gte("confirmed_at", liveSince)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow);
  },

  async listConfirmedVenueIds(venueIds, now = Date.now()) {
    if (venueIds.length === 0) return new Set<string>();
    const requestedOf = await requestedIdByStoredId(venueIds);
    const liveSince = new Date(now - PRICE_AUTHORITY_MAX_AGE_MS).toISOString();
    const { data, error } = await admin()
      .from(TABLE)
      .select("venue_id")
      .eq("status", "visible")
      .in("visibility", ["public", "anonymous"])
      .in("venue_id", [...requestedOf.keys()])
      .not("confirmation_id", "is", null)
      .gte("confirmed_at", liveSince);
    if (error) throw new Error(error.message);
    return new Set(
      (data ?? []).flatMap((row) => {
        const requested = requestedOf.get(String(row.venue_id));
        return requested ? [requested] : [];
      }),
    );
  },

  /** ONE atomic RPC (migration 0112) writes the verified-account report ledger
   *  (pint_drop_verified_reports, unique (pint_drop_id, actor_hash)) and increments /
   *  stamps / hides pint_drops in a single statement. Two concurrent
   *  reports cannot lose an increment, and a same-account duplicate is an
   *  idempotent no-op. Null data means unknown id. */
  async report(id, reason, identity) {
    if (identity.kind === "anonymous_ip") {
      return recordAnonymousReport(id, reason, identity.actorHash);
    }

    const { data: v2Data, error: v2Error } = await admin().rpc("report_pint_drop_v2", {
      p_id: id,
      p_actor_hash: identity.actorHash,
      p_reason: reason ?? null,
      p_hide_threshold: REPORT_HIDE_THRESHOLD,
    });
    if (v2Error) throw new Error(v2Error.message);
    const reported = v2Data !== null && v2Data !== undefined;
    return reported;
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
    const ok = (data ?? []).length > 0;
    return ok;
  },

  /**
   * Duplicate guard: the contributor's most recent PRICED drop at this venue,
   * compared against the current London day in JS. We read the single newest
   * priced row (indexed by migration 0040's
   * (venue_id, handle, created_at) partial index) rather than computing a
   * London-day boundary in SQL — `timezone('Europe/London', ...)` is only STABLE,
   * not IMMUTABLE, so it can't anchor a durable unique index, and a one-row read
   * keeps the day-bucket logic in the same londonDayKey() the streak uses (no
   * drift). Handles are normalized on write, so the equality match is exact.
   */
  async hasPricedDropToday(venueId, handle, now = Date.now()) {
    const who = normalizeViewerHandle(handle);
    if (!who) return false;
    const { data, error } = await whereVenueIdIn(
      admin().from(TABLE).select("created_at"),
      await storedVenueIds(venueId),
    )
      .eq("handle", who)
      .not("price_gbp", "is", null)
      .neq("status", "hidden")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const latest = (data ?? [])[0] as { created_at?: string } | undefined;
    if (!latest?.created_at) return false;
    return londonDayKey(latest.created_at) === londonDayKey(new Date(now));
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
/** The single backend selection point (mirrors the other stores). */
export function pintDropsStore(): PintDropStore {
  return selectStore(memoryPintDropStore, supabasePintDropStore);
}

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
/**
 * A refusal ABOUT THE FILE, as against a failure about US.
 *
 * The two used to be one `Error`, told apart by the route only by the fact that
 * both ended a create. They are not one thing: a mislabelled or corrupt image
 * is the drinker's to fix and is worth a 400, and a Storage outage is ours and
 * must never cost a price (`create` keeps a drop whose BILL could not be
 * stored, and logs it).
 */
export class PhotoRefusalError extends Error {}

/**
 * What an image the normaliser cannot open is refused with.
 *
 * Its own sentence, because it is the one refusal that is not about a rule the
 * drinker broke: the type was right and the size was fine, and the bytes still
 * did not open. It says what to do rather than naming the encoder, and it never
 * invites a retry of the same file.
 */
export const UNREADABLE_PHOTO_REFUSAL =
  "That photo could not be read. Choose a different image.";

export async function uploadPhoto(
  slot: "pint" | "venue" | "receipt",
  venueId: string,
  dropId: string,
  file: File,
  maxBytes = MAX_PHOTO_BYTES,
): Promise<string> {
  const invalid = validatePhoto(file.type, file.size, maxBytes);
  if (invalid) throw new PhotoRefusalError(invalid);

  // Read the bytes once, sniff the signature, then strip + normalize. A
  // mislabelled/crafted file that passed the MIME check is refused here as a
  // PhotoRefusalError, which both write doors answer with a 400.
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (!magicBytesOk(buffer, file.type)) {
    throw new PhotoRefusalError("Photo must be a JPEG, PNG, or WebP image.");
  }

  // Issue #33: pure-TypeScript, dependency-free metadata strip (JPEG segment /
  // PNG chunk / WebP RIFF-chunk rewrite — see lib/imageSafety.ts) BEFORE the
  // sharp re-encode below. This is an explicit, auditable belt-and-braces
  // layer on top of sharp's own metadata drop: it never trusts a native
  // binary to be the only thing standing between an uploaded file and a
  // leaked GPS tag, and it fails closed on a malformed/truncated byte stream
  // that magicBytesOk's leading-signature check wouldn't catch. Order:
  // magic-byte check → strip → normalize → upload. A strip failure is FAIL
  // CLOSED — reject, never fall through to the original (unstripped) bytes.
  const kind = detectImageKind(buffer);
  if (!kind) {
    // Should be unreachable given magicBytesOk just passed, but keep the
    // fail-closed guarantee explicit rather than assuming the two checks can
    // never disagree.
    throw new PhotoRefusalError("Photo must be a JPEG, PNG, or WebP image.");
  }
  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(buffer, kind);
  } catch (err) {
    log("error", "pint_drops.metadata_strip_failed", {
      slot,
      venueId,
      dropId,
      contentType: file.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PhotoRefusalError("Photo must be a valid, uncorrupted image.");
  }

  // PRD §7.2: strip EXIF (incl. GPS) + normalize BEFORE upload. A processing
  // failure must FAIL SAFE — log it and reject the upload; we never fall
  // through to the raw, EXIF-bearing bytes. `slot`/`dropId`/`venueId` are safe
  // to log (opaque ids); the image bytes are NEVER logged.
  let processed: Buffer;
  try {
    processed = await normalizeImage(stripped);
  } catch (err) {
    log("error", "pint_drops.image_normalize_failed", {
      slot,
      venueId,
      dropId,
      contentType: file.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new PhotoRefusalError(UNREADABLE_PHOTO_REFUSAL);
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
