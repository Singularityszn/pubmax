import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Keep the real store (toDTO, validation, etc.) but let the orphan-cleanup test
// swap upload/persist/delete. vi.hoisted so the spies exist before the hoisted
// mock factory runs. Default behaviour is untouched, so the no-Supabase tests
// below run the real in-memory path.
const { uploadPhoto, persistDrop, deletePhotos } = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  persistDrop: vi.fn(),
  deletePhotos: vi.fn(async () => {}),
}));
vi.mock("@/lib/pintDropsStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDropsStore")>(
    "@/lib/pintDropsStore",
  );
  return { ...actual, uploadPhoto, persistDrop, deletePhotos };
});

import { GET, POST } from "@/app/api/pint-drops/route";
import { __resetPintDrops } from "@/lib/pintDrops";

const URL_BASE = "http://localhost/api/pint-drops";

function post(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

function get(venueId?: string): Promise<Response> {
  const url = venueId ? `${URL_BASE}?venueId=${encodeURIComponent(venueId)}` : URL_BASE;
  return GET(new Request(url));
}

const VENUE = "the-crown";

beforeEach(() => {
  __resetPintDrops();
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/pint-drops (create)", () => {
  it("accepts a priced drop as a contributor", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.provenance).toBe("contributor");
    expect(drop.status).toBe("visible");
  });

  it("accepts a note-only drop as an anecdote", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", passedDownNote: "cheapest in town, 1998" });
    expect(res.status).toBe(201);
    const { drop } = await res.json();
    expect(drop.provenance).toBe("anecdote");
  });

  it("rejects an empty submission (no price, no note)", async () => {
    const res = await post({ venueId: VENUE, handle: "ale" });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range price", async () => {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 40 });
    expect(res.status).toBe(400);
  });

  it("rejects a missing handle", async () => {
    const res = await post({ venueId: VENUE, priceGbp: 4.2 });
    expect(res.status).toBe(400);
  });

  it("rate-limits the 9th rapid submission from one handle", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post({ venueId: VENUE, handle: "flooder", priceGbp: 4 });
    }
    expect(last!.status).toBe(429);
  });
});

describe("GET + moderation", () => {
  it("lists a created drop, then hides it after a report", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    const listed = await get(VENUE);
    expect(listed.status).toBe(200);
    expect((await listed.json()).drops).toHaveLength(1);

    const reported = await POST(
      new Request(URL_BASE, { method: "POST", body: JSON.stringify({ action: "report", id: drop.id }) }),
    );
    expect(reported.status).toBe(200);

    const afterReport = await get(VENUE);
    expect((await afterReport.json()).drops).toHaveLength(0);
  });

  it("lists all visible drops when venueId is omitted", async () => {
    await post({ venueId: "first", handle: "ale", priceGbp: 4.2 });
    await post({ venueId: "second", handle: "mild", passedDownNote: "my dad's old local" });

    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).drops).toHaveLength(2);
  });

  it("refuses the in-memory store in production when Supabase is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    expect(created.status).toBe(503);
    expect(await created.json()).toEqual({
      error: "Pint Drop production storage is not configured.",
    });

    const listed = await get(VENUE);
    expect(listed.status).toBe(503);
  });
});

describe("orphan cleanup (Supabase configured)", () => {
  function multipart(fields: Record<string, string>, photos: Record<string, Blob>): Promise<Response> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const [k, blob] of Object.entries(photos)) form.append(k, blob, `${k}.jpg`);
    return POST(new Request(URL_BASE, { method: "POST", body: form }));
  }

  beforeEach(() => {
    // Pretend Supabase is configured; the store fns are mocked, so no real client.
    process.env.SUPABASE_URL = "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    uploadPhoto.mockReset();
    persistDrop.mockReset();
    deletePhotos.mockReset();
    deletePhotos.mockResolvedValue(undefined);
  });

  it("deletes uploaded objects when the DB insert fails after upload", async () => {
    uploadPhoto
      .mockResolvedValueOnce("the-crown/x/pint.jpg")
      .mockResolvedValueOnce("the-crown/x/venue.jpg");
    persistDrop.mockRejectedValue(new Error("insert failed"));

    const res = await multipart(
      { venueId: VENUE, handle: "ale", priceGbp: "4.2" },
      { pint_photo: new Blob(["p"], { type: "image/jpeg" }), venue_photo: new Blob(["v"], { type: "image/jpeg" }) },
    );

    expect(res.status).toBe(503);
    // Both uploaded keys are removed — no orphaned files.
    expect(deletePhotos).toHaveBeenCalledWith(["the-crown/x/pint.jpg", "the-crown/x/venue.jpg"]);
  });

  it("does not delete anything on a successful insert", async () => {
    uploadPhoto.mockResolvedValue("the-crown/x/pint.jpg");
    persistDrop.mockResolvedValue(undefined);

    const res = await multipart(
      { venueId: VENUE, handle: "ale", priceGbp: "4.2" },
      { pint_photo: new Blob(["p"], { type: "image/jpeg" }) },
    );

    expect(res.status).toBe(201);
    expect(deletePhotos).not.toHaveBeenCalled();
  });
});
