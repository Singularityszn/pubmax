// In-memory moderated import-note queue (Wave E stub).
// No Supabase required — notes live in process memory for the demo admin
// console. Never polls Reddit/X; submissions arrive only via the admin form.

export type ImportNoteProvenance = "sourced" | "contributor";

export type ImportNote = {
  id: string;
  /** URL and/or free-text research note. */
  body: string;
  venueId: string | null;
  venueName: string | null;
  provenance: ImportNoteProvenance;
  status: "queued";
  createdAt: string;
};

const MAX_BODY = 2000;
const MAX_VENUE = 120;
const MAX_QUEUE = 200;

const queue: ImportNote[] = [];
let seq = 0;

function nextId(): string {
  seq += 1;
  return `import-note-${Date.now().toString(36)}-${seq}`;
}

export type ImportNoteInput = {
  body: string;
  venueId?: string | null;
  venueName?: string | null;
  provenance: ImportNoteProvenance;
};

export type ImportNoteValidation =
  | { ok: true; note: ImportNoteInput }
  | { ok: false; error: string };

export function validateImportNote(raw: {
  body?: unknown;
  venueId?: unknown;
  venueName?: unknown;
  provenance?: unknown;
}): ImportNoteValidation {
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (!body) return { ok: false, error: "URL or note text is required." };
  if (body.length > MAX_BODY) {
    return { ok: false, error: `Note is too long (max ${MAX_BODY} characters).` };
  }

  const provenance = raw.provenance;
  if (provenance !== "sourced" && provenance !== "contributor") {
    return { ok: false, error: "Provenance must be sourced or contributor." };
  }

  const venueId =
    typeof raw.venueId === "string" && raw.venueId.trim()
      ? raw.venueId.trim().slice(0, MAX_VENUE)
      : null;
  const venueName =
    typeof raw.venueName === "string" && raw.venueName.trim()
      ? raw.venueName.trim().slice(0, MAX_VENUE)
      : null;

  return {
    ok: true,
    note: { body, venueId, venueName, provenance },
  };
}

export function enqueueImportNote(input: ImportNoteInput): ImportNote {
  const note: ImportNote = {
    id: nextId(),
    body: input.body,
    venueId: input.venueId ?? null,
    venueName: input.venueName ?? null,
    provenance: input.provenance,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  queue.unshift(note);
  if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
  return note;
}

export function listImportNotes(): ImportNote[] {
  return [...queue];
}

/** Test helper — clears the in-memory queue. */
export function resetImportNotesForTests(): void {
  queue.length = 0;
  seq = 0;
}
