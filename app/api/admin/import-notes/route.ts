// Moderated import notes (Wave F3).
//   GET  → { notes: ImportNote[] }   (token-gated; queued by default)
//   POST { body, venueId?, venueName?, provenance } → { ok, note }
//   PATCH { id, action: "dismiss" | "restore" } → { ok, note? }
//
// Persists to .data/import-notes.json when the filesystem allows.
// No Reddit/X polling — staff-entered research notes only.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  dismissImportNote,
  enqueueImportNote,
  listImportNotes,
  restoreImportNote,
  validateImportNote,
} from "@/lib/importNotesStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

function forbidden(): Response {
  return jsonNoStore({ error: "Not authorised." }, { status: 403 });
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const url = new URL(request.url);
  const includeDismissed = url.searchParams.get("includeDismissed") === "1";
  return jsonNoStore(
    { notes: listImportNotes({ includeDismissed }) },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const validated = validateImportNote(body);
  if (!validated.ok) {
    return jsonNoStore({ error: validated.error }, { status: 400 });
  }

  const note = enqueueImportNote(validated.note);
  return jsonNoStore(
    { ok: true, note, message: "Queued for review" },
    { status: 200 },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action;
  if (!id) return jsonNoStore({ error: "Note id is required." }, { status: 400 });
  if (action !== "dismiss" && action !== "restore") {
    return jsonNoStore({ error: "Action must be dismiss or restore." }, { status: 400 });
  }

  const ok = action === "dismiss" ? dismissImportNote(id) : restoreImportNote(id);
  if (!ok) return jsonNoStore({ error: "Note not found." }, { status: 404 });

  const notes = listImportNotes({ includeDismissed: true });
  const note = notes.find((n) => n.id === id) ?? null;
  return jsonNoStore(
    {
      ok: true,
      note,
      message: action === "dismiss" ? "Note dismissed." : "Note restored to queue.",
    },
    { status: 200 },
  );
}
