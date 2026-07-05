import { createHash, timingSafeEqual } from "node:crypto";

// Single write-path seam for community "Pint Drops".
//
// One PintDropStore interface, two implementations (lib/pintDropsStore):
// Supabase (visit_reports + Storage) when env keys exist, process-memory
// otherwise. store() below is the ONLY place the backend is chosen (M4 / PRD
// P2.7); every handler talks to the interface. Validation/provenance/rate-limit
// run before either backend. When Supabase is configured it is the source of
// truth: backend failures return a 503 instead of acknowledging data that
// would only live in process memory.

import { isLimited, validatePintDrop, type PintDropStatus } from "@/lib/pintDrops";
import {
  memoryPintDropStore,
  supabasePintDropStore,
  type PintDropPhotos,
  type PintDropStore,
} from "@/lib/pintDropsStore";
import { memoryProfileStore, supabaseProfileStore } from "@/lib/profileStore";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";
import { getVenueIndex, venueMapUrl } from "@/lib/venueIndex";

// The single backend selection point. Read per request — env is stubbed per
// test and the check is a cheap env lookup.
function store(): PintDropStore {
  return isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
}

// A pint drop is also the moment a handle first "exists" socially, so we lazily
// create its profile row (foundation for follows / saved lists / a public
// /u/[handle]). Best-effort and non-blocking: a profile hiccup must never fail
// an otherwise-good drop, so failures are logged, not thrown.
async function ensureProfileForHandle(handle: string): Promise<void> {
  try {
    const profiles = isSupabaseConfigured() ? supabaseProfileStore : memoryProfileStore;
    await profiles.ensure(handle);
  } catch (err) {
    console.warn(
      "[pint-drops] could not ensure profile for handle (drop still saved):",
      err instanceof Error ? err.message : err,
    );
  }
}

// The friendly label a card shows when an id has no resolvable pub name — kept
// in step with lib/feed.ts VENUE_FALLBACK_LABEL so server and client agree.
const VENUE_FALLBACK_LABEL = "A London pub";

// PRD §9: enrich each public drop with a human `venueName` + a "/map?sel=…"
// `venueMapUrl`, resolved server-side from the bundled venue index, so no public
// feed/profile/permalink card ever surfaces the raw content-hashed `venue-…` id.
// Batched over the whole page against the one memoized index (a single Map read
// per drop). Never throws: an unreadable index yields the friendly fallback for
// every id, and the drops still render.
async function withVenueNames<T extends { venueId: string }>(
  drops: T[],
): Promise<(T & { venueName: string; venueMapUrl: string })[]> {
  const index = await getVenueIndex();
  return drops.map((drop) => ({
    ...drop,
    venueName: index.get(drop.venueId)?.name ?? VENUE_FALLBACK_LABEL,
    venueMapUrl: venueMapUrl(drop.venueId),
  }));
}

const STORAGE_UNCONFIGURED_ERROR =
  "Pint Drop production storage is not configured.";

function productionStorageUnavailable(): Response | null {
  return requiresSupabaseStore() && !isSupabaseConfigured()
    ? Response.json({ error: STORAGE_UNCONFIGURED_ERROR }, { status: 503 })
    : null;
}

function storageUnavailable(): Response {
  return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
}

function notFound(): Response {
  return Response.json({ error: "Pint Drop not found." }, { status: 404 });
}

function ok(): Response {
  return Response.json({ ok: true }, { status: 200 });
}

// Constant-time token compare (M2): sha256 both sides so lengths always match,
// then timingSafeEqual — a plain === leaks match length/prefix via timing.
function safeTokenEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Moderator gate. The console passes the token as the `x-admin-token` header
// ONLY — query-string tokens are not accepted because they leak through
// browser history, server logs, analytics, and Referer headers. When
// ADMIN_TOKEN is set, the token must match it. When it is unset we DENY
// everywhere except local dev (and the test runner) — keying on "not
// production" would leave e.g. a Vercel preview wide open. The token is
// compared here and never echoed back to the client.
function isModerator(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token") ?? undefined;
  if (!expected) {
    return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  }
  if (!provided) return false;
  return safeTokenEqual(provided, expected);
}

function forbidden(): Response {
  return Response.json({ error: "Not authorised." }, { status: 403 });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// Parse either a JSON body or a multipart form. For multipart we pull the text
// fields into a plain object (validatePintDrop cleans them) and keep the photo
// Files aside. JSON bodies carry no photos. Returns null on a malformed body.
async function parseBody(
  request: Request,
): Promise<{ fields: Record<string, unknown>; photos: PintDropPhotos } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields: Record<string, unknown> = {};
    const photos: PintDropPhotos = { pint: null, venue: null };
    // Vibe tags arrive as a form field: either repeated `vibe_tags` entries or
    // one comma-separated value. Collect into an array; validatePintDrop re-
    // filters against the server allowlist (the client value is never trusted).
    const vibeTags: string[] = [];
    for (const [k, v] of form.entries()) {
      if (k === "pint_photo" && v instanceof File && v.size > 0) photos.pint = v;
      else if (k === "venue_photo" && v instanceof File && v.size > 0) photos.venue = v;
      else if (k === "vibe_tags" && typeof v === "string") {
        vibeTags.push(...v.split(",").map((t) => t.trim()).filter(Boolean));
      } else if (typeof v === "string") fields[k] = v;
    }
    if (vibeTags.length) fields.vibeTags = vibeTags;
    return { fields, photos };
  }
  try {
    return {
      fields: (await request.json()) as Record<string, unknown>,
      photos: { pint: null, venue: null },
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if (!parsed) {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  const { fields, photos } = parsed;

  // Public moderation: a report records metadata; the drop is hidden from
  // public reads once REPORT_HIDE_THRESHOLD reports accumulate (never on the
  // first — see lib/pintDrops.ts).
  if (fields.action === "report") {
    const id = readString(fields.id);
    if (!id) return notFound();
    // Rate-limit reports per drop so one actor can't spam the report counter.
    if (await isLimited(`report:${id}`, `report:${id}`)) {
      return Response.json({ error: "Too many reports, slow down." }, { status: 429 });
    }
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    try {
      return (await store().report(id, readString(fields.reason))) ? ok() : notFound();
    } catch {
      return storageUnavailable();
    }
  }

  // Moderator decisions: restore (→ visible) or keep_hidden (stay hidden). Both
  // stamp moderated_at so the drop leaves the review queue. 403 without a token.
  if (fields.action === "restore" || fields.action === "keep_hidden") {
    if (!isModerator(request)) return forbidden();
    const id = readString(fields.id);
    if (!id) return notFound();
    const status: PintDropStatus = fields.action === "restore" ? "visible" : "hidden";
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    try {
      return (await store().moderate(id, status, readString(fields.note))) ? ok() : notFound();
    } catch {
      return storageUnavailable();
    }
  }

  const result = validatePintDrop(fields);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  // Durable key = handle + hashed IP (PRD P3.9); in-memory fallback stays
  // keyed on handle alone, exactly as before.
  const submitKey = `drop:${result.value.handle.toLowerCase()}:${hashIp(clientIp(request))}`;
  if (await isLimited(result.value.handle, submitKey)) {
    return Response.json({ error: "Too many submissions, slow down." }, { status: 429 });
  }

  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;

  try {
    const drop = await store().create(result.value, photos);
    // Fire-and-forget: the profile bootstrap must never delay or fail the drop
    // response (an awaited Supabase upsert here blocks every submission and hangs
    // unmocked tests). It never rejects — the inner try/catch swallows failures.
    void ensureProfileForHandle(result.value.handle);
    return Response.json({ drop }, { status: 201 });
  } catch (err) {
    // An invalid photo is the user's fault — surface as 400. The store has
    // already cleaned up anything it uploaded (no orphans).
    if (err instanceof Error && err.message.startsWith("Photo must")) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    return storageUnavailable();
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator read: ?status=hidden|pending → the review queue, WITH metadata.
  const status = params.get("status");
  if (status === "hidden" || status === "pending") {
    if (!isModerator(request)) return forbidden();
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    try {
      return Response.json({ drops: await store().listForReview(status) }, { status: 200 });
    } catch {
      return storageUnavailable();
    }
  }

  // Public read: visible drops only, newest-first, hard-capped (MAX_PUBLIC_DROPS).
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    const drops = await store().listVisible(params.get("venueId") ?? undefined);
    return Response.json({ drops: await withVenueNames(drops) }, { status: 200 });
  } catch {
    return storageUnavailable();
  }
}
