import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";

const fixture = vi.hoisted(() => ({
  lookup: vi.fn(), readDrop: vi.fn(), rpc: vi.fn(), insert: vi.fn(),
  upload: vi.fn(), remove: vi.fn(),
  objects: new Map<string, Blob>(),
}));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  STORAGE_BUCKET: "pint-drops",
  requireSupabaseAdmin: () => ({
    from: (table: string) => ({
      insert: fixture.insert,
      select: () => ({ eq: () => ({
        maybeSingle: fixture.lookup,
        single: table === "pint_drops" ? fixture.readDrop : fixture.lookup,
      }) }),
    }),
    rpc: fixture.rpc,
    storage: { from: () => ({
      upload: fixture.upload, remove: fixture.remove,
      download: async (key: string) => ({ data: fixture.objects.get(key), error: null }),
      createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://fixture.invalid/${key}` }, error: null }),
      createSignedUrls: async (keys: string[]) => ({
        data: keys.map(path => ({ path, signedUrl: `https://fixture.invalid/${path}` })), error: null,
      }),
    }) },
  }),
}));
import { supabasePintDropStore } from "@/lib/pintDropsStore";
import type { PintDropPhotos } from "@/lib/pintDropsStore";
import { validatePintDrop } from "@/lib/pintDrops";
import { pintDropCreateRequest, PintDropCommitUncertainError } from "@/lib/pintDropCreate.server";

beforeEach(() => {
  vi.resetAllMocks();
  fixture.objects.clear();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network access prohibited."); }));
  fixture.lookup.mockResolvedValue({ data: null, error: null });
  fixture.upload.mockImplementation(async (key: string, blob: Blob) => {
    fixture.objects.set(key, blob);
    return { data: { path: key }, error: null };
  });
  fixture.remove.mockImplementation(async (keys: string[]) => {
    keys.forEach(key => fixture.objects.delete(key));
    return { data: [], error: null };
  });
});
async function input() {
  const parsed = validatePintDrop({ venueId: "fixture-pub", handle: "alice", priceGbp: "5.80" });
  if (!parsed.ok) throw new Error(parsed.error);
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).jpeg().toBuffer();
  const photos: PintDropPhotos = { pint: null, venue: null, receipt: new File([new Uint8Array(jpeg)], "bill.jpg", { type: "image/jpeg" }) };
  const request = await pintDropCreateRequest("11111111-1111-4111-8111-111111111111", "fixture-submission-key", parsed.value, photos);
  return { drop: parsed.value, photos, options: { underDailyPriceCap: true, request } };
}
it("recovers a committed insert whose RPC response was lost, retaining its actual photo", async () => {
  const { drop, photos, options } = await input();
  fixture.rpc.mockImplementationOnce(async (_name, args) => {
    fixture.lookup.mockResolvedValue({ data: { request_digest: options.request.requestDigest, drop_id: drop.id }, error: null });
    fixture.readDrop.mockResolvedValue({ data: args.p_drop, error: null });
    return { data: null, error: { message: "The response was lost." } };
  });
  const result = await supabasePintDropStore.create(drop, photos, options);
  expect(result.id).toBe(drop.id);
  expect(result.receiptPhotoUrl).toContain(drop.id);
  expect(fixture.objects.size).toBe(1);
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(fixture.insert).not.toHaveBeenCalled();
});
it.each(["absent", "unavailable"])('retains uncertain media when replay lookup is %s', async (state) => {
  const { drop, photos, options } = await input();
  fixture.rpc.mockImplementationOnce(async () => {
    fixture.lookup.mockResolvedValue(state === "absent" ? { data: null, error: null } : { data: null, error: { message: "Read unavailable" } });
    throw new Error("Connection closed after request dispatch");
  });
  await expect(supabasePintDropStore.create(drop, photos, options)).rejects.toBeInstanceOf(PintDropCommitUncertainError);
  expect(fixture.objects.size).toBe(1);
  expect(fixture.remove).not.toHaveBeenCalled();
});
it("cleans only the losing attempt's photo after the atomic RPC identifies another winner", async () => {
  const { drop, photos, options } = await input();
  const winnerId = randomUUID();
  const winnerPhoto = `${drop.venueId}/${winnerId}/receipt.jpg`;
  const winnerBlob = new Blob(["winner photo"]);
  fixture.objects.set(winnerPhoto, winnerBlob);
  fixture.rpc.mockImplementationOnce(async (_name, args) => ({
    data: { outcome: "replayed", drop: { ...args.p_drop, id: winnerId, receipt_photo_key: winnerPhoto } }, error: null,
  }));
  const result = await supabasePintDropStore.create(drop, photos, options);
  expect(result.id).toBe(winnerId);
  expect([...fixture.objects.keys()]).toEqual([winnerPhoto]);
  expect(fixture.objects.get(winnerPhoto)).toBe(winnerBlob);
  expect(fixture.remove).toHaveBeenCalledWith([`${drop.venueId}/${drop.id}/receipt.jpg`]);
});
it("refuses missing replay schema before uploading or using the unkeyed insert", async () => {
  const { drop, photos, options } = await input();
  fixture.lookup.mockResolvedValue({ data: null, error: { code: "42P01", message: "Missing request table" } });
  await expect(supabasePintDropStore.create(drop, photos, options)).rejects.toThrow("Missing request table");
  expect(fixture.upload).not.toHaveBeenCalled();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(fixture.insert).not.toHaveBeenCalled();
});
it("keeps the price when receipt Storage fails, including an exact replay", async () => {
  const { drop, photos, options } = await input();
  fixture.upload.mockResolvedValue({ data: null, error: { message: "Storage unavailable" } });
  fixture.rpc.mockImplementationOnce(async (_name, args) => {
    fixture.lookup.mockResolvedValue({ data: { request_digest: options.request.requestDigest, drop_id: drop.id }, error: null });
    fixture.readDrop.mockResolvedValue({ data: args.p_drop, error: null });
    return { data: { outcome: "created", drop: args.p_drop }, error: null };
  });
  const first = await supabasePintDropStore.create(drop, photos, options);
  const replay = await supabasePintDropStore.create({ ...drop, id: randomUUID() }, photos, options);
  expect(first).toMatchObject({ id: drop.id, priceGbp: 5.8, receiptPhotoUrl: null });
  expect(replay).toEqual(first);
  expect(fixture.upload).toHaveBeenCalledTimes(1);
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});
it.each(["conflict", "daily_cap"])("cleans rejected attempt media after a definite %s result", async (outcome) => {
  const { drop, photos, options } = await input();
  fixture.rpc.mockResolvedValue({ data: { outcome }, error: null });
  await expect(supabasePintDropStore.create(drop, photos, options)).rejects.toThrow();
  expect(fixture.objects.size).toBe(0);
  expect(fixture.remove).toHaveBeenCalledTimes(1);
});

it("refuses a missing atomic RPC without falling back to an unkeyed insert", async () => {
  const { drop, photos, options } = await input();
  fixture.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Missing create_pint_drop_idempotent" } });
  await expect(supabasePintDropStore.create(drop, photos, options)).rejects.toBeInstanceOf(PintDropCommitUncertainError);
  expect(fixture.insert).not.toHaveBeenCalled();
  expect(fixture.remove).not.toHaveBeenCalled();
});
it("projects a stored moderated replay without photo URLs or moderation notes", async () => {
  const { drop, options } = await input();
  fixture.lookup.mockResolvedValue({ data: { request_digest: options.request.requestDigest, drop_id: drop.id }, error: null });
  fixture.readDrop.mockResolvedValue({ data: {
    id: drop.id, venue_id: drop.venueId, handle: drop.handle, price_gbp: 5.8,
    visibility: "anonymous", status: "hidden", created_at: drop.createdAt,
    receipt_photo_key: "private-bill-key", moderator_note: "Private review note",
    authority_key: "original-account-authority",
  }, error: null });
  const result = await supabasePintDropStore.findCreation(options.request);
  expect(result?.drop).toMatchObject({ id: drop.id, status: "hidden", receiptPhotoUrl: null });
  expect(JSON.stringify(result?.drop)).not.toMatch(/private-bill-key|Private review note|original-account-authority/);
  expect(result?.authorHandle).toBe(drop.handle);
  expect(result?.authorityKey).toBe("original-account-authority");
});
