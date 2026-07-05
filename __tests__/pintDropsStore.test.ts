import { describe, expect, it, vi } from "vitest";

// Mock the Supabase admin so toDTO/deletePhotos exercise Storage without a live
// project. getPublicUrl is a pure string build in the real client; we mirror it.
const removeMock = vi.fn(async () => ({ data: [], error: null }));
const getPublicUrl = vi.fn((key: string) => ({
  data: { publicUrl: `https://cdn.test/pint-drops/${key}` },
}));
const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ getPublicUrl, remove: removeMock }) },
    rpc: rpcMock,
  }),
  STORAGE_BUCKET: "pint-drops",
}));

import { validatePhoto, magicBytesOk, toDTO, deletePhotos, supabasePintDropStore } from "@/lib/pintDropsStore";
import type { PersistableDrop } from "@/lib/pintDropsStore";
import { REPORT_HIDE_THRESHOLD } from "@/lib/pintDrops";

// Pure validation only — no live Supabase. These run in the same node env as
// the rest of the suite (no keys required).
describe("validatePhoto", () => {
  it("accepts a valid jpeg under the size cap", () => {
    expect(validatePhoto("image/jpeg", 2 * 1024 * 1024)).toBeNull();
  });

  it("accepts png and webp", () => {
    expect(validatePhoto("image/png", 1000)).toBeNull();
    expect(validatePhoto("image/webp", 1000)).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validatePhoto("application/pdf", 1000)).toMatch(/JPEG, PNG, or WebP/);
  });

  it("rejects a file over 5MB", () => {
    expect(validatePhoto("image/jpeg", 5 * 1024 * 1024 + 1)).toMatch(/5MB/);
  });
});

// Content-sniff the real signature so a mislabelled/crafted file can't pass the
// MIME check. Pure over Uint8Array — no File needed.
describe("magicBytesOk", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);

  it("accepts real JPEG/PNG/WebP signatures", () => {
    expect(magicBytesOk(jpeg, "image/jpeg")).toBe(true);
    expect(magicBytesOk(png, "image/png")).toBe(true);
    expect(magicBytesOk(webp, "image/webp")).toBe(true);
  });

  it("rejects a signature that does not match the declared MIME", () => {
    // A PNG-signatured buffer claiming to be a JPEG.
    expect(magicBytesOk(png, "image/jpeg")).toBe(false);
    // RIFF header but not a WEBP container (audio/other RIFF).
    const riffNotWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(magicBytesOk(riffNotWebp, "image/webp")).toBe(false);
  });

  it("rejects a spoofed/garbage buffer and an unknown MIME", () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    expect(magicBytesOk(junk, "image/jpeg")).toBe(false);
    expect(magicBytesOk(jpeg, "application/pdf")).toBe(false);
  });
});

function drop(overrides: Partial<PersistableDrop> = {}): PersistableDrop {
  return {
    id: "d1",
    venueId: "the-crown",
    handle: "ale",
    drink: "",
    priceGbp: 4.2,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toDTO", () => {
  it("maps storage keys to public URLs and never leaks the keys", () => {
    const dto = toDTO(
      drop({ pintPhotoKey: "the-crown/d1/pint.jpg", venuePhotoKey: "the-crown/d1/venue.png" }),
    );
    expect(dto.pintPhotoUrl).toBe("https://cdn.test/pint-drops/the-crown/d1/pint.jpg");
    expect(dto.venuePhotoUrl).toBe("https://cdn.test/pint-drops/the-crown/d1/venue.png");
    expect(dto).not.toHaveProperty("pintPhotoKey");
    expect(dto).not.toHaveProperty("venuePhotoKey");
  });

  it("emits null URLs when a drop has no photos", () => {
    const dto = toDTO(drop());
    expect(dto.pintPhotoUrl).toBeNull();
    expect(dto.venuePhotoUrl).toBeNull();
  });

  it("returns null URLs for a hidden drop even when keys exist", () => {
    const dto = toDTO(
      drop({ status: "hidden", pintPhotoKey: "the-crown/d1/pint.jpg", venuePhotoKey: "the-crown/d1/venue.png" }),
    );
    expect(dto.pintPhotoUrl).toBeNull();
    expect(dto.venuePhotoUrl).toBeNull();
  });

  // Report-count transparency (safe): a visible drop with reports exposes ONLY
  // the bare count — never reasons, reporter metadata, or moderator notes.
  it("exposes reportCount on a visible reported drop, but no reasons/metadata", () => {
    const dto = toDTO(
      drop({
        reportCount: 1,
        reportReason: "wrong price",
        reportedAt: "2026-01-02T00:00:00.000Z",
        moderatorNote: "reviewed, kept",
        moderatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(dto.reportCount).toBe(1);
    // The reporter trail and moderator metadata never leave the server.
    expect(dto).not.toHaveProperty("reportReason");
    expect(dto).not.toHaveProperty("reportedAt");
    expect(dto).not.toHaveProperty("moderatorNote");
    expect(dto).not.toHaveProperty("moderatedAt");
  });

  it("omits reportCount when a visible drop has zero reports", () => {
    expect(toDTO(drop())).not.toHaveProperty("reportCount");
    expect(toDTO(drop({ reportCount: 0 }))).not.toHaveProperty("reportCount");
  });

  it("never exposes reportCount on a hidden drop", () => {
    // A hidden drop is not publicly visible; leaking its count would confirm a
    // takedown. (Public reads never return hidden drops anyway.)
    expect(toDTO(drop({ status: "hidden", reportCount: 5 }))).not.toHaveProperty("reportCount");
  });

  // Vibe tags are public, safe content — the DTO surfaces them. Exposing them
  // must not open any moderation leak.
  it("exposes vibeTags on a drop that has them", () => {
    const dto = toDTO(drop({ vibeTags: ["cheap", "riverside"] }));
    expect(dto.vibeTags).toEqual(["cheap", "riverside"]);
  });

  it("omits vibeTags entirely on a drop without them (backward-compatible)", () => {
    expect(toDTO(drop())).not.toHaveProperty("vibeTags");
  });

  it("exposes vibeTags but still leaks no report/moderation metadata", () => {
    const dto = toDTO(
      drop({
        vibeTags: ["cheap"],
        reportCount: 1,
        reportReason: "wrong price",
        reportedAt: "2026-01-02T00:00:00.000Z",
        moderatorNote: "reviewed, kept",
        moderatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(dto.vibeTags).toEqual(["cheap"]);
    expect(dto.reportCount).toBe(1); // the one sanctioned transparency field
    expect(dto).not.toHaveProperty("reportReason");
    expect(dto).not.toHaveProperty("reportedAt");
    expect(dto).not.toHaveProperty("moderatorNote");
    expect(dto).not.toHaveProperty("moderatedAt");
  });
});

describe("deletePhotos", () => {
  it("removes the given keys and skips empty ones", async () => {
    removeMock.mockClear();
    await deletePhotos(["the-crown/d1/pint.jpg", "the-crown/d1/venue.png"]);
    expect(removeMock).toHaveBeenCalledWith(["the-crown/d1/pint.jpg", "the-crown/d1/venue.png"]);
  });

  it("no-ops (no Storage call) when there is nothing to delete", async () => {
    removeMock.mockClear();
    await deletePhotos([]);
    expect(removeMock).not.toHaveBeenCalled();
  });
});

// H4 / migration 0004: the atomic report_pint_drop RPC. The route maps a false
// return to a 404, so the unknown-id path is a real contract, not a detail.
describe("supabasePintDropStore.report (atomic RPC)", () => {
  it("passes the server-side hide threshold (one report can't hide content) and returns true on success", async () => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: 1, error: null });
    const result = await supabasePintDropStore.report("d1", "spam");
    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("report_pint_drop", {
      p_id: "d1",
      p_reason: "spam",
      p_hide_threshold: REPORT_HIDE_THRESHOLD,
    });
  });

  it("returns false for an unknown id (null data → 404 upstream)", async () => {
    rpcMock.mockClear();
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await supabasePintDropStore.report("nope")).toBe(false);
  });
});
