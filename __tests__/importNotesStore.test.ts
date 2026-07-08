import { describe, it, expect, beforeEach } from "vitest";

import {
  enqueueImportNote,
  listImportNotes,
  resetImportNotesForTests,
  validateImportNote,
} from "@/lib/importNotesStore";

describe("importNotesStore", () => {
  beforeEach(() => {
    resetImportNotesForTests();
  });

  it("rejects empty body and bad provenance", () => {
    expect(validateImportNote({ body: "  ", provenance: "sourced" }).ok).toBe(false);
    expect(validateImportNote({ body: "note", provenance: "demo" }).ok).toBe(false);
  });

  it("accepts a sourced URL note and queues it", () => {
    const validated = validateImportNote({
      body: "https://example.com/pub-history",
      venueId: "venue-abc",
      venueName: "The Example Arms",
      provenance: "sourced",
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const note = enqueueImportNote(validated.note);
    expect(note.status).toBe("queued");
    expect(listImportNotes()).toHaveLength(1);
    expect(listImportNotes()[0].body).toContain("example.com");
  });
});
