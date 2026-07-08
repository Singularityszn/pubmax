// Moderated import-note stub (Wave E).
//   GET  → { notes: ImportNote[] }   (token-gated)
//   POST { body, venueId?, venueName?, provenance } → { ok, note }
//
// Stores in process memory when no Supabase is wired. No Reddit/X polling.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  enqueueImportNote,
  listImportNotes,
  validateImportNote,
} from "@/lib/importNotesStore";

function forbidden(): Response {
  return jsonNoStore({ error: "Not authorised." }, { status: 403 });
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  return jsonNoStore({ notes: listImportNotes() }, { status: 200 });
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
    { ok: true, note, message: "Queued for review (demo)" },
    { status: 200 },
  );
}
