// Single write-path seam for community "Pint Drops".
//
// Two storage backends behind one API: when Supabase env is present we persist
// to the `visit_reports` table + Storage (lib/pintDropsStore); otherwise we use
// the in-memory store in lib/pintDrops.ts (process memory, resets on restart —
// fine for the prototype). Validation/provenance/rate-limit are shared and run
// before either backend. When Supabase is configured it is the source of truth:
// backend failures return a 503 instead of acknowledging data that would only
// live in process memory.

import {
  validatePintDrop,
  isRateLimited,
  addPintDrop,
  listAllVisiblePintDrops,
  listVisiblePintDrops,
  listByStatus,
  reportPintDrop,
  restorePintDrop,
  keepHiddenPintDrop,
  type PintDropStatus,
} from "@/lib/pintDrops";
import {
  persistDrop,
  listAllVisibleDropsRemote,
  listVisibleDropsRemote,
  listByStatusRemote,
  reportDropRemote,
  moderateDropRemote,
  uploadPhoto,
  deletePhotos,
  toDTO,
  toModeratorDTO,
  type PersistableDrop,
} from "@/lib/pintDropsStore";
import {
  checkRateLimitDurable,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

const STORAGE_UNCONFIGURED_ERROR =
  "Pint Drop production storage is not configured.";

function productionStorageUnavailable(): Response | null {
  return requiresSupabaseStore() && !isSupabaseConfigured()
    ? Response.json({ error: STORAGE_UNCONFIGURED_ERROR }, { status: 503 })
    : null;
}

// Moderator gate. The console passes the token as `x-admin-token` (fetch) or
// `?admin=` (link). When ADMIN_TOKEN is set, the token must match it. When it is
// unset we allow only outside production, as a dev convenience — never in prod.
// The token is compared here and never echoed back to the client.
function isModerator(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  const provided =
    request.headers.get("x-admin-token") ??
    new URL(request.url).searchParams.get("admin") ??
    undefined;
  if (!expected) return process.env.NODE_ENV !== "production";
  return Boolean(provided) && provided === expected;
}

function forbidden(): Response {
  return Response.json({ error: "Not authorised." }, { status: 403 });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// Client IP for rate-limit keying only. It is sha256-hashed (hashIp) before it
// goes anywhere — raw IPs are never stored.
function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Durable (Supabase RPC) limiter when configured; in-memory otherwise. A null
// verdict (client missing / RPC error) also falls back to the in-memory
// backstop, so dev/demo keeps working and a limiter outage can't 500 writes.
async function isLimited(localKey: string, durableKey: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const verdict = await checkRateLimitDurable(durableKey);
    if (typeof verdict === "boolean") return verdict;
  }
  return isRateLimited(localKey);
}

type Photos = { pint: File | null; venue: File | null };

// Parse either a JSON body or a multipart form. For multipart we pull the text
// fields into a plain object (validatePintDrop cleans them) and keep the photo
// Files aside. JSON bodies carry no photos. Returns null on a malformed body.
async function parseBody(
  request: Request,
): Promise<{ fields: Record<string, unknown>; photos: Photos } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields: Record<string, unknown> = {};
    const photos: Photos = { pint: null, venue: null };
    for (const [k, v] of form.entries()) {
      if (k === "pint_photo" && v instanceof File && v.size > 0) photos.pint = v;
      else if (k === "venue_photo" && v instanceof File && v.size > 0) photos.venue = v;
      else if (typeof v === "string") fields[k] = v;
    }
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

  // Public moderation: a report records metadata and hides the drop pending review.
  if (fields.action === "report") {
    const id = readString(fields.id);
    if (!id) {
      return Response.json({ error: "Pint Drop not found." }, { status: 404 });
    }
    const reason = readString(fields.reason);
    // Rate-limit reports per drop so one actor can't spam the report counter.
    if (await isLimited(`report:${id}`, `report:${id}`)) {
      return Response.json({ error: "Too many reports, slow down." }, { status: 429 });
    }
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    if (isSupabaseConfigured()) {
      try {
        const ok = await reportDropRemote(id, reason);
        return ok
          ? Response.json({ ok: true }, { status: 200 })
          : Response.json({ error: "Pint Drop not found." }, { status: 404 });
      } catch {
        return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
      }
    }
    return reportPintDrop(id, reason)
      ? Response.json({ ok: true }, { status: 200 })
      : Response.json({ error: "Pint Drop not found." }, { status: 404 });
  }

  // Moderator decisions: restore (→ visible) or keep_hidden (stay hidden). Both
  // stamp moderated_at so the drop leaves the review queue. 403 without a token.
  if (fields.action === "restore" || fields.action === "keep_hidden") {
    if (!isModerator(request)) return forbidden();
    const id = readString(fields.id);
    if (!id) {
      return Response.json({ error: "Pint Drop not found." }, { status: 404 });
    }
    const note = readString(fields.note);
    const restore = fields.action === "restore";
    const status: PintDropStatus = restore ? "visible" : "hidden";
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    if (isSupabaseConfigured()) {
      try {
        const ok = await moderateDropRemote(id, status, note);
        return ok
          ? Response.json({ ok: true }, { status: 200 })
          : Response.json({ error: "Pint Drop not found." }, { status: 404 });
      } catch {
        return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
      }
    }
    const ok = restore ? restorePintDrop(id, note) : keepHiddenPintDrop(id, note);
    return ok
      ? Response.json({ ok: true }, { status: 200 })
      : Response.json({ error: "Pint Drop not found." }, { status: 404 });
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

  if (isSupabaseConfigured()) {
    const drop: PersistableDrop = { ...result.value };
    const { venueId, id } = drop; // id is generated by validatePintDrop, so keys exist before upload
    const uploaded: string[] = [];
    try {
      // Upload both photos (if present) BEFORE the insert. On a bad file we
      // throw before persisting; on an insert failure we delete what we uploaded.
      if (photos.pint) {
        drop.pintPhotoKey = await uploadPhoto("pint", venueId, id, photos.pint);
        uploaded.push(drop.pintPhotoKey);
      }
      if (photos.venue) {
        drop.venuePhotoKey = await uploadPhoto("venue", venueId, id, photos.venue);
        uploaded.push(drop.venuePhotoKey);
      }
    } catch (err) {
      // An invalid-photo error is the user's fault — surface as 400. Anything
      // uploaded before the bad file still gets cleaned up (no orphan).
      await deletePhotos(uploaded);
      if (err instanceof Error && err.message.startsWith("Photo must")) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
    }
    try {
      await persistDrop(drop);
    } catch {
      // Insert failed after upload — remove the now-orphaned objects, best-effort.
      await deletePhotos(uploaded);
      return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
    }
    return Response.json({ drop: toDTO(drop) }, { status: 201 });
  }

  // Fallback path: in-memory store. Photos are ignored here (no Storage).
  addPintDrop(result.value);
  return Response.json({ drop: toDTO(result.value) }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator read: ?status=hidden|pending → the review queue, WITH metadata.
  const status = params.get("status");
  if (status === "hidden" || status === "pending") {
    if (!isModerator(request)) return forbidden();
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    if (isSupabaseConfigured()) {
      try {
        return Response.json({ drops: await listByStatusRemote(status) }, { status: 200 });
      } catch {
        return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
      }
    }
    return Response.json({ drops: listByStatus(status).map(toModeratorDTO) }, { status: 200 });
  }

  const venueId = params.get("venueId");
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  if (isSupabaseConfigured()) {
    try {
      const rows = venueId
        ? await listVisibleDropsRemote(venueId)
        : await listAllVisibleDropsRemote();
      return Response.json({ drops: rows.map(toDTO) }, { status: 200 });
    } catch {
      return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
    }
  }
  const rows = venueId ? listVisiblePintDrops(venueId) : listAllVisiblePintDrops();
  return Response.json({ drops: rows.map(toDTO) }, { status: 200 });
}
