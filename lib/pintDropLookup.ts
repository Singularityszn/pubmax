import type { Route } from "next";
import "server-only";

import {
  ANON_HANDLE_LABEL,
  canViewOnPublicSurface,
  cleanVisibility,
  findPintDropsByIds,
  isPubliclyReadableDrop,
  visibilityOf,
  type PintDrop,
  type ViewerContext,
  type Visibility,
} from "@/lib/pintDrops";
import { resolveStorageUrl } from "@/lib/pintDropsStore";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { resolveAvatarUrlsForHandles } from "@/lib/avatarResolve";
import {
  authorRetiredAtFromRow,
  contributorHasRetired,
} from "@/lib/retiredContributor";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";
import { normalizeHandle } from "@/lib/profiles";
import { storedVenueName } from "@/lib/storedVenueRef";
import { resolveStoredVenue, venueMapUrl } from "@/lib/venueIndex";

// Standalone Pint Drop permalink lookup (PRD §8). ONE public read: turn a drop
// id into a leak-proof, share-ready DTO for /p/[id] and its OG card. Server-only
// — it reads Supabase / the venue index with node primitives and must never be
// imported into a client bundle.
//
// Leak-proofness is enforced by COLUMN SELECTION, not by post-filtering: the
// Supabase read names ONLY public columns, so a hidden/reported drop can never
// expose its photo keys or any moderation field even if the row is fetched.
// (`.eq("status","visible")` then guarantees a hidden row returns null at all.)

// The exact, public-only column list. NEVER add report_*/moderator_*/moderated_*
// here — a hidden drop's photo keys and moderation trail must not leave the DB.
const PUBLIC_COLUMNS =
  "id,venue_id,handle,drink,price_gbp,passed_down_note,era,provenance,created_at,vibe_tags,visibility,pint_photo_key,venue_photo_key";

// The same list plus the retirement stamp (migration 0150), which decides which
// NAME the reader is given. This lane names its columns rather than selecting
// `*`, so a cluster without 0150 refuses the whole read; the read below falls
// back to PUBLIC_COLUMNS on that one error, and a drop then reads as a live
// author, which on such a cluster it is.
const PUBLIC_COLUMNS_WITH_RETIREMENT = `${PUBLIC_COLUMNS},author_retired_at`;

/** PostgREST's answer for a column this deployment's database does not have. */
function isMissingRetirementColumnError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    (code === "42703" || code === "PGRST204") && message.includes("author_retired_at")
  );
}

// The one shape the permalink page + OG card consume. Photo keys are already
// resolved to public URLs; the raw venue id is enriched to a real pub name and a
// map link so no surface ever renders "venue-1ufn31x".
export type PublicDrop = {
  id: string;
  venueId: string;
  venueName: string;
  venueMapUrl: Route;
  handle: string;
  drink: string;
  priceGbp: number | null;
  note: string;
  era: string;
  provenance: string;
  createdAt: string;
  vibeTags: string[];
  // Per-drop visibility (issue #29). Exposed so a surface can label the lane; the
  // handle is ALREADY the withheld label for an anonymous drop (see below).
  visibility: Visibility;
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  /** Approved owned avatar serve path for linked handles only. */
  avatarUrl?: string;
};

// Shape of the public columns we select from Supabase. Loose on purpose — every
// field is re-normalised below, never trusted as-is.
type VisibleRow = {
  id: string;
  venue_id: string;
  handle: string;
  drink: string | null;
  price_gbp: number | string | null;
  passed_down_note: string | null;
  era: string | null;
  provenance: string | null;
  created_at: string;
  vibe_tags: unknown;
  visibility: unknown;
  pint_photo_key: string | null;
  venue_photo_key: string | null;
};

// The moderation-status union, narrowed safely from an untrusted DB value.
// Anything that isn't a known member falls back to "hidden" — a non-visible
// default, so an unexpected status can never make a drop publicly readable
// (identical to the old `String(status ?? "")` behaviour, which also only
// treated an exact "visible" as readable).
const PINT_DROP_STATUSES: readonly PintDrop["status"][] = ["visible", "hidden", "pending"];
function toPintDropStatus(value: unknown): PintDrop["status"] {
  return typeof value === "string" && (PINT_DROP_STATUSES as readonly string[]).includes(value)
    ? (value as PintDrop["status"])
    : "hidden";
}

// Validate the untyped `.maybeSingle()` result before trusting the VisibleRow
// cast: a row is usable only if it's a non-null object carrying the identity
// fields (`id`, `venue_id`) as strings. A malformed row returns false so the
// caller falls through to the not-found / memory path instead of building a
// bogus DTO from missing keys.
function isVisibleRow(value: unknown): value is VisibleRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id !== "" &&
    typeof row.venue_id === "string" &&
    row.venue_id !== "" &&
    typeof row.created_at === "string"
  );
}

function toPrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === "string");
}

// Build a signed Storage URL from a key for a row we already know is visible.
async function signedPhotoUrl(key: string | null | undefined): Promise<string | null> {
  return resolveStorageUrl(key, true);
}

type EnrichFields = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  note: string;
  era: string;
  provenance: string;
  createdAt: string;
  vibeTags: string[];
  visibility: Visibility;
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

/**
 * Visibility gate for the permalink (issue #29). Applied to a resolved,
 * moderation-visible drop against the requester's self-asserted viewer:
 *   • public / anonymous → always readable (anonymous handle withheld below);
 *   • friends            → author + the author's followers only; otherwise null
 *                          (the page renders "not on the wall" — an honest block
 *                          that never reveals the drop exists to a non-qualified
 *                          viewer, matching the hidden-id 404 posture);
 *   • legacy             → author only; otherwise null (legacy lives on the
 *                          ledger, never a public permalink).
 * Returns the drop's raw handle→display substitution done at the caller.
 */
function permittedOnPermalink(
  drop: Pick<PintDrop, "handle" | "visibility">,
  viewer?: ViewerContext,
): boolean {
  return canViewOnPublicSurface(drop as PintDrop, viewer);
}

// Enrich a gated drop into the shared DTO: withhold the handle for an anonymous
// drop, resolve the venue name + map link. Split out so both backends share one
// exit path. Returns null when the viewer isn't permitted to see the drop.
async function enrich(
  fields: EnrichFields,
  viewer?: ViewerContext,
  /** Set when the account behind `fields.handle` has left (migration 0150). It
   *  is a separate argument rather than a field, because it decides the name
   *  the reader is given and may never travel to the reader itself. */
  authorRetiredAt?: string,
): Promise<PublicDrop | null> {
  if (!permittedOnPermalink(fields, viewer)) return null;
  const venue = await resolveStoredVenue(fields.venueId);
  // ANONYMITY GUARANTEE (issue #29): an anonymous drop's real handle never leaves
  // the server — swap it for the withheld label before it can reach the page/OG
  // card. The author still reads their own anonymous drop with the label (their
  // choice); moderation reads a different, server-only path.
  // A RETIRED AUTHOR is withheld the same way, for the same reason: the account
  // that logged this drop has left (migration 0150, `lib/retiredContributor.ts`).
  // The tombstone already cleared that profile's face, so the avatar lookup is
  // skipped rather than left to answer nothing.
  if ((await withdrawnHandles([fields.handle])).size > 0) return null;
  const withheld =
    fields.visibility === "anonymous" || contributorHasRetired(authorRetiredAt);
  const handle = withheld ? ANON_HANDLE_LABEL : fields.handle;
  const avatarUrls = withheld
    ? new Map<string, string>()
    : await resolveAvatarUrlsForHandles([fields.handle]);
  const avatarUrl = withheld ? undefined : avatarUrls.get(normalizeHandle(fields.handle));
  return {
    ...fields,
    handle,
    venueName: venue ? storedVenueName(venue) : "A London pub",
    venueMapUrl: venueMapUrl(fields.venueId),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

// ── F3: batched parent-drop visibility gate ─────────────────────────────────
// The comments and reactions GETs are UNSCOPED public reads: they carry no
// viewer identity, only drop ids. Before this gate, ANY dropId — including a
// hidden (moderated) drop or a friends/legacy-visibility drop — would happily
// return its comments and reaction counts. This helper answers, in ONE batched
// query, which of the requested ids belong to drops fit for that read.

// Same additive-rollout guard the pint-drops store uses for migration 0012:
// match ONLY a missing-`visibility` column error (42703 undefined_column /
// PGRST204 schema-cache miss naming the column) so the read can retry without
// the column on a pre-0012 DB, where every row is effectively `public`.
function isMissingVisibilityColumnError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("visibility");
}

/**
 * Filter a batch of drop ids down to the ones whose PARENT DROP is fit for an
 * unscoped public read (visible + `public`/`anonymous` — see
 * isPubliclyReadableDrop). One Supabase query for the whole batch (never
 * per-id), then the in-memory store + demo seeds cover ids Supabase doesn't
 * know. Order and duplicates of the input are preserved for the ids kept.
 *
 * Verdicts:
 *   • resolved + publicly readable          → kept.
 *   • resolved + hidden/friends/legacy      → dropped. Callers answer the SAME
 *     empty shape as "no comments/reactions yet" (200, never 404), matching how
 *     the feed silently omits these drops — no existence oracle.
 *   • unresolvable id                       → kept. There is nothing to leak: a
 *     gated drop always resolves (hidden rows stay in pint_drops / the
 *     memory store), while an unknown id simply has no server-side children on
 *     the Supabase path (child tables FK pint_drops) and keeps dev/demo
 *     ergonomics on the memory path.
 *   • Supabase lookup failure               → returns `null` (outage sentinel).
 *     Callers MUST distinguish this from an empty allow-list: a POST maps null
 *     to 503 (dependency outage) while a gated/unknown id stays 404; a GET may
 *     still fail-soft to the empty shape so the feed keeps rendering.
 *
 * Return value: the kept ids (may be empty when all were gated/blank), or
 * `null` when the visibility lookup itself failed and no verdict could be
 * reached. Callers should NOT conflate `[]` with `null`.
 */
export async function filterPubliclyReadableDropIds(
  ids: readonly string[],
): Promise<string[] | null> {
  const requested = ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean);
  if (requested.length === 0) return [];
  const unique = [...new Set(requested)];

  // id → verdict for ids we could RESOLVE; unresolved ids stay absent (kept).
  const verdicts = new Map<string, boolean>();

  if (isSupabaseConfigured()) {
    try {
      const admin = getSupabaseAdmin();
      // Configured-but-broken (admin key missing / factory returned null) is a
      // dependency outage, not a "nobody's readable" answer. Fail CLOSED with a
      // typed sentinel so callers can 503 vs. 404.
      if (!admin) return null;
      const firstRead = await admin
        .from(PINT_DROPS_TABLE)
        .select("id,status,visibility")
        .in("id", unique);
      let data = (firstRead.data ?? null) as
        | Array<{ id: unknown; status?: unknown; visibility?: unknown }>
        | null;
      let error = firstRead.error;
      if (error && isMissingVisibilityColumnError(error)) {
        // Pre-0012 DB: no visibility column means every row is `public`.
        const fallbackRead = await admin.from(PINT_DROPS_TABLE).select("id,status").in("id", unique);
        data = (fallbackRead.data ?? null) as
          | Array<{ id: unknown; status?: unknown; visibility?: unknown }>
          | null;
        error = fallbackRead.error;
      }
      if (error) return null; // outage sentinel — see doc comment
      for (const row of data ?? []) {
        verdicts.set(String(row.id), isPubliclyReadableDrop({
          status: toPintDropStatus(row.status),
          visibility: cleanVisibility(row.visibility),
        }));
      }
    } catch {
      return null; // outage sentinel — see doc comment
    }
  }

  // Memory store + demo seeds resolve whatever Supabase didn't (all of it, on
  // the memory backend). One batched pass, any status — hidden drops must
  // resolve so they can be gated.
  const unresolved = unique.filter((id) => !verdicts.has(id));
  for (const [id, drop] of findPintDropsByIds(unresolved)) {
    verdicts.set(id, isPubliclyReadableDrop(drop));
  }

  return requested.filter((id) => verdicts.get(id) !== false);
}

/**
 * Resolve a single public Pint Drop by id, or null.
 *
 * NEVER throws: any Supabase/venue-index failure resolves to null so the
 * permalink degrades to its friendly empty state rather than 500-ing. A hidden,
 * reported, unknown, OR visibility-gated id resolves to null too — the Supabase
 * read is gated on `status = "visible"`, the memory fallback filters
 * visible-only, and per-drop visibility (issue #29) is applied against the
 * self-asserted `viewer` in dev/test only). Anonymous drops resolve with the handle WITHHELD.
 *
 * Prefer {@link resolveViewerContextFromRequest} from lib/pintDropViewer.ts at
 * API/page seams so friends visibility requires a verified JWT in production;
 * pass the resulting ViewerContext here.
 */
export async function getPintDropById(
  id: string,
  viewer?: ViewerContext,
): Promise<PublicDrop | null> {
  const dropId = typeof id === "string" ? id.trim() : "";
  if (!dropId) return null;

  // Supabase path — leak-proof by column selection.
  if (isSupabaseConfigured()) {
    try {
      const admin = getSupabaseAdmin();
      if (admin) {
        const read = async (columns: string) =>
          admin
            .from(PINT_DROPS_TABLE)
            .select(columns)
            .eq("id", dropId)
            .eq("status", "visible")
            .maybeSingle();
        let { data, error } = await read(PUBLIC_COLUMNS_WITH_RETIREMENT);
        if (isMissingRetirementColumnError(error)) {
          ({ data, error } = await read(PUBLIC_COLUMNS));
        }
        if (!error && isVisibleRow(data)) {
          const row = data;
          const [pintPhotoUrl, venuePhotoUrl] = await Promise.all([
            signedPhotoUrl(row.pint_photo_key),
            signedPhotoUrl(row.venue_photo_key),
          ]);
          return await enrich({
            id: String(row.id),
            venueId: String(row.venue_id),
            handle: String(row.handle ?? ""),
            drink: String(row.drink ?? ""),
            priceGbp: toPrice(row.price_gbp),
            note: String(row.passed_down_note ?? ""),
            era: String(row.era ?? ""),
            provenance: String(row.provenance ?? "anecdote"),
            createdAt: String(row.created_at ?? ""),
            vibeTags: toTags(row.vibe_tags),
            visibility: cleanVisibility(row.visibility),
            pintPhotoUrl,
            venuePhotoUrl,
          }, viewer, authorRetiredAtFromRow(
            (row as { author_retired_at?: unknown }).author_retired_at,
          ));
        }
        // No row (unknown/hidden) or a query error → fall through to memory so a
        // demo-seeded drop id still resolves; if it isn't there either, null.
      }
    } catch {
      // Swallow — degrade to the memory fallback, never surface a 500.
    }
  }

  // Memory / demo fallback: visible-only listing across cities (id lookup must
  // still resolve Manchester demo seeds even when unscoped feeds default to London).
  try {
    const hit = findPintDropsByIds([dropId]).get(dropId);
    if (!hit || hit.status !== "visible") return null;
    return await enrich({
      id: hit.id,
      venueId: hit.venueId,
      handle: hit.handle,
      drink: hit.drink,
      priceGbp: hit.priceGbp,
      note: hit.passedDownNote,
      era: hit.era,
      provenance: hit.provenance,
      createdAt: hit.createdAt,
      vibeTags: hit.vibeTags ? [...hit.vibeTags] : [],
      visibility: visibilityOf(hit),
      // The in-memory store has no Storage, so no photos.
      pintPhotoUrl: null,
      venuePhotoUrl: null,
    }, viewer, hit.authorRetiredAt);
  } catch {
    return null;
  }
}
