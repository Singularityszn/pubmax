import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real store, metadata stripping and JPEG normalisation. Only the database
// and Storage service are doubles. This cannot prove a deployed bucket works.
const service = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  rows: [] as Record<string, unknown>[],
  acceptedUploads: 0,
  mode: "corrupt" as "corrupt" | "healthy" | "different-jpeg" | "unreadable" | "upload-outage",
  replacementBytes: null as Buffer | null,
  uploadedBytes: null as Buffer | null,
  receiptColumnMissing: false,
  insertError: false,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  const admin = {
    auth: {
      async getUser(token: string) {
        return token === "receipt-test-owner-token"
          ? { data: { user: { id: "receipt-test-owner" } }, error: null }
          : { data: { user: null }, error: { status: 401, message: "Invalid token" } };
      },
    },
    async rpc() {
      return { data: false, error: null };
    },
    from: (table: string) => ({
      select() {
        let rows: Record<string, unknown>[] = table === "profiles"
          ? [{ id: "receipt-test-profile", handle: "drinker", user_id: "receipt-test-owner" }]
          : [];
        type Query = {
          eq(column: string, value: unknown): Query;
          not(): Query;
          neq(): Query;
          order(): Query;
          limit(): Promise<{ data: Record<string, unknown>[]; error: null }>;
        };
        const query: Query = {
          eq(column: string, value: unknown) {
            rows = rows.filter((row) => row[column] === value);
            return query;
          },
          not: () => query,
          neq: () => query,
          order: () => query,
          async limit() { return { data: rows, error: null }; },
        };
        return query;
      },
      async insert(row: Record<string, unknown>) {
        if (service.insertError) {
          return { data: null, error: { message: "Database insert refused" } };
        }
        if (service.receiptColumnMissing && "receipt_photo_key" in row) {
          return {
            data: null,
            error: { code: "42703", message: "column receipt_photo_key does not exist" },
          };
        }
        service.rows.push({ ...row });
        return { data: null, error: null };
      },
    }),
    storage: {
      from: (bucket: string) => ({
        async upload(path: string, body: unknown, options: { upsert?: boolean }) {
          if (service.mode === "upload-outage") {
            return { data: null, error: { message: "Storage upload unavailable" } };
          }
          if (!options.upsert && service.objects.has(`${bucket}/${path}`)) {
            return { data: null, error: { message: "Object already exists" } };
          }
          const bytes = body instanceof Blob
            ? Buffer.from(await body.arrayBuffer())
            : Buffer.from(body as Uint8Array);
          service.uploadedBytes = bytes;
          // The corrupt mode mangles even Blob writes. Healthy mode models
          // the historical raw-body failure. A Blob alone cannot detect the
          // different valid JPEG accepted by the substitution mode.
          const stored = service.mode === "different-jpeg"
            ? service.replacementBytes!
            : service.mode === "corrupt" || (service.mode === "healthy" && !(body instanceof Blob))
              ? Buffer.from(bytes.toString("utf8"), "utf8")
              : bytes;
          service.objects.set(`${bucket}/${path}`, stored);
          service.acceptedUploads += 1;
          return { data: { path }, error: null };
        },
        async download(path: string) {
          if (service.mode === "unreadable") {
            return { data: null, error: { message: "Storage read unavailable" } };
          }
          const bytes = service.objects.get(`${bucket}/${path}`);
          return bytes
            ? { data: new Blob([new Uint8Array(bytes)]), error: null }
            : { data: null, error: { message: "Object not found" } };
        },
        async remove(paths: string[]) {
          for (const path of paths) service.objects.delete(`${bucket}/${path}`);
          return { data: [], error: null };
        },
        async createSignedUrl(path: string) {
          return {
            data: { signedUrl: `https://storage.test/${path}` },
            error: null,
          };
        },
      }),
    },
  };
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    requiresSupabaseStore: () => true,
    getSupabaseAdmin: () => admin,
    requireSupabaseAdmin: () => admin,
  };
});

import { supabasePintDropStore } from "@/lib/pintDropsStore";
import { readUploadedImageObject } from "@/lib/uploadedImage.server";
import { POST } from "@/app/api/pint-drops/route";

async function receiptFile(): Promise<File> {
  const bytes = await readFile(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
  return new File([new Uint8Array(bytes)], "bill.jpg", { type: "image/jpeg" });
}

async function writePrice(id: string) {
  return supabasePintDropStore.create({
    id,
    venueId: "receipt-test-pub",
    handle: "drinker",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    createdAt: "2026-10-03T12:00:00.000Z",
  }, { pint: null, venue: null, receipt: await receiptFile() });
}

beforeEach(() => {
  service.objects.clear();
  service.rows.length = 0;
  service.acceptedUploads = 0;
  service.mode = "corrupt";
  service.replacementBytes = null;
  service.uploadedBytes = null;
  service.receiptColumnMissing = false;
  service.insertError = false;
  vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "off");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("priced Pint Drop and its stored bill", () => {
  it("refuses the priced write and removes a bill corrupted after Storage accepted it", async () => {
    const bytes = await readFile(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
    const bill = new File([new Uint8Array(bytes)], "bill.jpg", { type: "image/jpeg" });

    await expect(supabasePintDropStore.create({
      id: "receipt-corrupt-write",
      venueId: "receipt-test-pub",
      handle: "drinker",
      drink: "Lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-10-03T12:00:00.000Z",
    }, { pint: null, venue: null, receipt: bill })).rejects.toThrow();

    expect(service.acceptedUploads).toBe(1);
    expect(service.rows).toEqual([]);
    expect([...service.objects.keys()]).toEqual([]);
  });

  it("keeps a healthy bill readable beside its saved price", async () => {
    service.mode = "healthy";

    const saved = await writePrice("receipt-healthy-write");
    expect(saved.priceGbp).toBe(4.5);
    expect(service.rows).toHaveLength(1);
    const key = service.rows[0].receipt_photo_key;
    expect(key).toBeTypeOf("string");
    expect(saved.receiptPhotoUrl).toBe(`https://storage.test/${String(key)}`);
    const readback = await readUploadedImageObject(String(key));
    expect(readback.ok).toBe(true);
    if (!readback.ok) throw new Error("Saved bill was not readable");
    expect(readback.image.bytes.equals(service.uploadedBytes!)).toBe(true);
    expect((await sharp(readback.image.bytes).metadata()).format).toBe("jpeg");
  });

  it("refuses another valid JPEG substituted for the submitted bill", async () => {
    service.mode = "different-jpeg";
    service.replacementBytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#244fc9" },
    }).jpeg().toBuffer();

    await expect(writePrice("receipt-substituted-write")).rejects.toThrow();

    expect(service.acceptedUploads).toBe(1);
    expect(service.rows).toEqual([]);
    expect([...service.objects.keys()]).toEqual([]);
  });

  it("keeps the price when Storage cannot answer its bill readback", async () => {
    service.mode = "unreadable";

    const saved = await writePrice("receipt-unreadable-write");

    expect(saved.priceGbp).toBe(4.5);
    expect(service.rows).toHaveLength(1);
    expect(service.rows[0].receipt_photo_key).toBeTypeOf("string");
    expect([...service.objects.keys()]).toHaveLength(1);
  });

  it("keeps the price but removes an unreferenced bill during receipt-column rollout", async () => {
    service.mode = "healthy";
    service.receiptColumnMissing = true;

    const saved = await writePrice("receipt-column-rollout");

    expect(saved.priceGbp).toBe(4.5);
    expect(saved.receiptPhotoUrl).toBeNull();
    expect(service.rows).toHaveLength(1);
    expect(service.rows[0]).not.toHaveProperty("receipt_photo_key");
    expect(service.acceptedUploads).toBe(1);
    expect([...service.objects.keys()]).toEqual([]);
  });

  it("keeps a pre-existing immutable bill when a repeated key is refused", async () => {
    service.mode = "healthy";
    const existing = Buffer.from("existing object owned by the earlier write");
    const key = "pint-drops/receipt-test-pub/receipt-existing-key/receipt.jpg";
    service.objects.set(key, existing);

    const saved = await writePrice("receipt-existing-key");

    expect(saved.priceGbp).toBe(4.5);
    expect(saved.receiptPhotoUrl).toBeNull();
    expect(service.acceptedUploads).toBe(0);
    expect(service.objects.get(key)).toEqual(existing);
  });

  it("keeps the price without a bill key when the upload service is unavailable", async () => {
    service.mode = "upload-outage";

    const saved = await writePrice("receipt-upload-outage");

    expect(saved.priceGbp).toBe(4.5);
    expect(saved.receiptPhotoUrl).toBeNull();
    expect(service.rows).toHaveLength(1);
    expect(service.rows[0].receipt_photo_key).toBeNull();
    expect(service.acceptedUploads).toBe(0);
    expect([...service.objects.keys()]).toEqual([]);
  });

  it("removes all this write's healthy photos when the database insert fails", async () => {
    service.mode = "healthy";
    service.insertError = true;
    const photo = await receiptFile();

    await expect(supabasePintDropStore.create({
      id: "receipt-insert-failure",
      venueId: "receipt-test-pub",
      handle: "drinker",
      drink: "Lager",
      priceGbp: 4.5,
      passedDownNote: "",
      era: "",
      provenance: "contributor",
      status: "visible",
      createdAt: "2026-10-03T12:00:00.000Z",
    }, { pint: photo, venue: photo, receipt: photo })).rejects.toThrow("Database insert refused");

    expect(service.acceptedUploads).toBe(3);
    expect(service.rows).toEqual([]);
    expect([...service.objects.keys()]).toEqual([]);
  });

  it("answers a corrupted bill write with a sanitised API 503, without blaming the file", async () => {
    const form = new FormData();
    form.set("venueId", "venue-xjf3n0");
    form.set("handle", "drinker");
    form.set("drink", "Lager");
    form.set("priceGbp", "4.50");
    form.set("receipt_photo", await receiptFile());

    const response = await POST(new Request("http://localhost/api/pint-drops", {
      method: "POST",
      headers: { authorization: "Bearer receipt-test-owner-token" },
      body: form,
    }));

    const body = await response.json();
    expect(service.acceptedUploads, `${response.status} ${body.code}: ${body.error}`).toBe(1);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "STORE_UNAVAILABLE",
      error: "Pint Drop storage is unavailable.",
    });
    expect(service.rows).toEqual([]);
    expect([...service.objects.keys()]).toEqual([]);
  });
});
