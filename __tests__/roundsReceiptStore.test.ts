import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { downloadUploadedImageObject } from "@/lib/uploadedImage.server";

import { __resetMemoryRounds, memoryRoundsStore, roundsStore } from "@/lib/roundsStore";

const ROUND_ID = "11111111-1111-4111-8111-111111111111";
const CODE = "ABCD23";
const PNG = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
));
let rows: Record<string, unknown>[];
let uploads: string[];
let missingColumn: string | null;
let insertAttempts: number;
let objects: Set<string>;
let storedBytes: Map<string, Buffer>;
let corruptWrites: boolean;
let failedDownloads: boolean;
let deleted: string[];
let uploadBarrier: (() => Promise<void>) | null;
let insertFailure: { code: string; message: string; status: number } | null;
let loseInsertResponse: boolean;
let failReadAfterInsert: boolean;

const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "rounds-receipt.test") throw new Error("Unexpected fixture host");
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.pathname === "/rest/v1/rounds") {
    if (failReadAfterInsert && rows.length) return new Response(null, { status: 503 });
    return Response.json({ id: ROUND_ID, code: CODE, title: "Friday", created_by_handle: "ken" });
  }
  if (url.pathname === "/rest/v1/round_members") return Response.json([{ handle: "ken" }]);
  if (url.pathname === "/rest/v1/round_stops") {
    return Response.json([{ id: "stop-1", venue_id: "venue-1", venue_name: "The Ship" }]);
  }
  if (url.pathname === "/rest/v1/round_spends") {
    if (method === "GET") return Response.json(rows);
    if (method !== "POST") throw new Error("Unexpected spend method");
    insertAttempts += 1;
    const row = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (missingColumn && "receipt_photo_key" in row) {
      return Response.json({ code: missingColumn, message: "Missing receipt_photo_key column" }, { status: 400 });
    }
    if (insertFailure) return Response.json(insertFailure, { status: insertFailure.status });
    if (rows.some((saved) => saved.client_ref === row.client_ref)) {
      return Response.json({ code: "23505", message: "Duplicate client_ref" }, { status: 409 });
    }
    rows.push(row);
    if (loseInsertResponse) throw new Error("Insert response lost");
    return new Response(null, { status: 201 });
  }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    if (method === "DELETE") {
      const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
      for (const key of prefixes) {
        objects.delete(key);
        storedBytes.delete(key);
        deleted.push(key);
      }
      return Response.json([]);
    }
    if (method === "GET") {
      if (failedDownloads) return new Response(null, { status: 503 });
      const bytes = storedBytes.get(url.pathname.split("/").slice(5).join("/"));
      return bytes ? new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }) : new Response(null, { status: 404 });
    }
    if (method !== "POST") throw new Error("Unexpected storage method");
    const body = init?.body;
    const image = body instanceof FormData
      ? [...body.values()].find((value): value is File => value instanceof File)
      : null;
    let bytes = image
      ? Buffer.from(await image.arrayBuffer())
      : Buffer.from(Buffer.from(body as Uint8Array).toString("utf8"), "utf8");
    if (corruptWrites) bytes = Buffer.from(bytes.toString("utf8"), "utf8");
    storedBytes.set(url.pathname.split("/").slice(5).join("/"), bytes);
    uploads.push(url.pathname);
    objects.add(url.pathname.split("/").slice(5).join("/"));
    await uploadBarrier?.();
    return Response.json({ Key: url.pathname });
  }
  throw new Error(`Unexpected fixture path: ${url.pathname}`);
};

beforeEach(() => {
  rows = [];
  uploads = [];
  missingColumn = null;
  insertAttempts = 0;
  objects = new Set();
  storedBytes = new Map();
  corruptWrites = false;
  failedDownloads = false;
  deleted = [];
  uploadBarrier = null;
  insertFailure = null;
  loseInsertResponse = false;
  failReadAfterInsert = false;
  __resetMemoryRounds();
  vi.stubEnv("SUPABASE_URL", "https://rounds-receipt.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubGlobal("fetch", fixtureFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function spend() {
  return {
    clientRef: "billed-spend",
    payerHandle: "ken",
    recordedByHandle: "ken",
    venueId: "venue-1",
    venueName: "The Ship",
    totalGbp: 6.2,
    receipt: new File([PNG], "bill.png", { type: "image/png" }),
  };
}

it("retains the uploaded bill key on a Supabase spend and its replay", async () => {
  const store = roundsStore();
  const saved = await store.recordSpend(CODE, spend());
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error("Spend was not saved");
  const key = `venue-1/${saved.state.spends[0]?.id}/receipt.jpg`;
  expect(rows[0]?.receipt_photo_key).toBe(key);
  expect(saved.state.spends[0]?.receiptPhotoKey).toBe(key);
  expect(uploads).toHaveLength(1);
  expect(objects).toEqual(new Set([key]));
  expect(deleted).toEqual([]);
  expect(uploads[0]).toMatch(new RegExp(`/venue-1/${saved.state.spends[0]?.id}/receipt\\.jpg$`));
  const replay = await store.recordSpend(CODE, spend());
  expect(replay).toMatchObject({ ok: true, created: false, state: { spends: [{ receiptPhotoKey: key }] } });
  expect(insertAttempts).toBe(1);
  expect(uploads).toHaveLength(1);
});

it.each(["42703", "PGRST204"])("saves the spend without the unavailable receipt column (%s)", async (code) => {
  missingColumn = code;
  const saved = await roundsStore().recordSpend(CODE, spend());
  expect(saved).toMatchObject({ ok: true, created: true, state: { spends: [{ totalPence: 620 }] } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty("receipt_photo_key");
  expect(insertAttempts).toBe(2);
  expect(uploads).toHaveLength(1);
  expect(objects.size).toBe(0);
  expect(deleted).toHaveLength(1);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"event":"rounds.receipt_column_missing"'));
});

it.each([
  { code: "23514", message: "Spend constraint refused", status: 400 },
  { code: "42501", message: "Spend permission refused", status: 403 },
  { code: "XX000", message: "Database insert failed", status: 500 },
])("removes the bill after a confirmed insert rejection ($code)", async (failure) => {
  insertFailure = failure;
  expect(await roundsStore().recordSpend(CODE, spend())).toEqual({ ok: false, error: "error" });
  expect(rows).toHaveLength(0);
  expect(uploads).toHaveLength(1);
  expect(deleted).toHaveLength(1);
  expect(objects.size).toBe(0);
});

it.each(["lost insert response", "failed read after insert"])("preserves the committed bill after a %s", async (failure) => {
  loseInsertResponse = failure === "lost insert response";
  failReadAfterInsert = failure === "failed read after insert";
  expect(await roundsStore().recordSpend(CODE, spend())).toEqual({ ok: false, error: "error" });
  expect(rows).toHaveLength(1);
  expect(objects).toEqual(new Set([rows[0]?.receipt_photo_key]));
  expect(deleted).toEqual([]);
});

it.each(["supabase", "memory", "memory with another owner"])("removes only the losing bill in a duplicate race (%s)", async (backend) => {
  const store = backend === "supabase" ? roundsStore() : memoryRoundsStore;
  let code = CODE;
  if (backend !== "supabase") {
    const created = await store.create({ title: "Friday", createdByHandle: "ken" });
    if (!created.ok) throw new Error("Round was not created");
    code = created.state.round.code;
    await store.addStop(code, { venueId: "venue-1", venueName: "The Ship", addedByHandle: "ken" });
  }
  let release!: () => void;
  const bothUploaded = new Promise<void>((resolve) => { release = resolve; });
  uploadBarrier = async () => {
    if (uploads.length === 2) release();
    await bothUploaded;
  };
  const results = await Promise.all([
    store.recordSpend(code, { ...spend(), promotionActor: "profile:ken" }),
    store.recordSpend(code, { ...spend(), promotionActor: backend === "memory with another owner" ? "profile:other" : "profile:ken" }),
  ]);
  expect(results.filter((result) => result.ok && result.created)).toHaveLength(1);
  if (backend === "memory with another owner") {
    expect(results).toContainEqual({ ok: false, error: "forbidden" });
  } else {
    expect(results.filter((result) => result.ok && !result.created)).toHaveLength(1);
  }
  const saved = await store.getByCode(code);
  expect(saved?.spends).toHaveLength(1);
  const key = saved?.spends[0]?.receiptPhotoKey;
  expect(key).toEqual(expect.any(String));
  expect(uploads).toHaveLength(2);
  expect(deleted).toHaveLength(1);
  expect(deleted).not.toContain(key);
  expect(objects).toEqual(new Set([key]));
});

// Exercise the real store, Storage SDK and image reader against the same bucket.
it("makes a Round bill readable after its Storage round trip", async () => {
  const saved = await roundsStore().recordSpend(CODE, spend());
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error("Spend was not saved");
  const key = saved.state.spends[0]?.receiptPhotoKey;
  expect(key).toEqual(expect.any(String));
  const image = await downloadUploadedImageObject(key!);
  expect(image).not.toBeNull();
  const metadata = await sharp(image!.bytes).metadata();
  expect(metadata).toMatchObject({ format: "jpeg", width: 1, height: 1 });
  const decoded = await sharp(image!.bytes).raw().toBuffer({ resolveWithObject: true });
  expect(decoded.info).toMatchObject({ width: 1, height: 1, channels: 3 });
  expect([...decoded.data]).toEqual([255, 255, 255]);
});


it("keeps the spend without accepting a receipt whose stored bytes are corrupt", async () => {
  corruptWrites = true;
  const saved = await roundsStore().recordSpend(CODE, spend());
  expect(saved).toMatchObject({ ok: true, created: true, state: { spends: [{ totalPence: 620 }] } });
  if (!saved.ok) throw new Error("Spend was not saved");
  expect(saved.state.spends[0]).not.toHaveProperty("receiptPhotoKey");
  expect(rows[0]?.receipt_photo_key).toBeNull();
  expect(objects.size).toBe(0);
});


it("keeps the bill when its write cannot be read back during a storage outage", async () => {
  failedDownloads = true;
  const saved = await roundsStore().recordSpend(CODE, spend());
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error("Spend was not saved");
  const key = saved.state.spends[0]?.receiptPhotoKey;
  expect(key).toEqual(expect.any(String));
  expect(objects).toEqual(new Set([key]));
  expect(deleted).toEqual([]);
});
