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

import { validatePhoto, toDTO, deletePhotos, supabasePintDropStore } from "@/lib/pintDropsStore";
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
