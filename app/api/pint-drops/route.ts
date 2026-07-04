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
  reportPintDrop,
} from "@/lib/pintDrops";
import {
  persistDrop,
  listAllVisibleDropsRemote,
  listVisibleDropsRemote,
  setDropStatusRemote,
  uploadPintPhoto,
  type PersistableDrop,
} from "@/lib/pintDropsStore";
import { isSupabaseConfigured } from "@/lib/supabase";

// Parse either a JSON body or a multipart form. For multipart we pull the text
// fields into a plain object (validatePintDrop cleans them) and keep the photo
// File aside. Returns null on a malformed body.
async function parseBody(
  request: Request,
): Promise<{ fields: Record<string, unknown>; photo: File | null } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields: Record<string, unknown> = {};
    let photo: File | null = null;
    for (const [k, v] of form.entries()) {
      if (k === "photo" && v instanceof File && v.size > 0) photo = v;
      else if (typeof v === "string") fields[k] = v;
    }
    return { fields, photo };
  }
  try {
    return { fields: (await request.json()) as Record<string, unknown>, photo: null };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if (!parsed) {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  const { fields, photo } = parsed;

  // Moderation: a report hides the drop pending review.
  if (fields.action === "report") {
    const id = fields.id;
    if (typeof id !== "string") {
      return Response.json({ error: "Pint Drop not found." }, { status: 404 });
    }
    if (isSupabaseConfigured()) {
      try {
        const ok = await setDropStatusRemote(id, "hidden");
        return ok
          ? Response.json({ ok: true }, { status: 200 })
          : Response.json({ error: "Pint Drop not found." }, { status: 404 });
      } catch {
        return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
      }
    }
    return reportPintDrop(id)
      ? Response.json({ ok: true }, { status: 200 })
      : Response.json({ error: "Pint Drop not found." }, { status: 404 });
  }

  const result = validatePintDrop(fields);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  if (isRateLimited(result.value.handle)) {
    return Response.json({ error: "Too many submissions, slow down." }, { status: 429 });
  }

  if (isSupabaseConfigured()) {
    try {
      const drop: PersistableDrop = { ...result.value };
      if (photo) drop.pintPhotoKey = await uploadPintPhoto(photo); // user-safe throw on bad file
      await persistDrop(drop);
      return Response.json({ drop }, { status: 201 });
    } catch (err) {
      // An invalid-photo error is the user's fault, not a backend hiccup — surface
      // it as a 400 rather than silently falling back and dropping their photo.
      if (photo && err instanceof Error && err.message.startsWith("Photo must")) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
    }
  }

  // Fallback path: in-memory store. Photos are ignored here (no Storage).
  addPintDrop(result.value);
  return Response.json({ drop: result.value }, { status: 201 });
}

export async function GET(request: Request): Promise<Response> {
  const venueId = new URL(request.url).searchParams.get("venueId");
  if (isSupabaseConfigured()) {
    try {
      const drops = venueId
        ? await listVisibleDropsRemote(venueId)
        : await listAllVisibleDropsRemote();
      return Response.json({ drops }, { status: 200 });
    } catch {
      return Response.json({ error: "Pint Drop storage is unavailable." }, { status: 503 });
    }
  }
  return Response.json(
    { drops: venueId ? listVisiblePintDrops(venueId) : listAllVisiblePintDrops() },
    { status: 200 },
  );
}
