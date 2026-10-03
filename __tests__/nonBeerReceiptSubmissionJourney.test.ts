import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Actual multipart route, auth verifier, contribution gate and durable store.
// Only the Supabase Auth, database and Storage SDK boundary is doubled.
// These tests cannot prove GoTrue, SQL/RLS or a deployed bucket works.
const service = vi.hoisted(() => ({
  prices: [] as Record<string, unknown>[],
  drops: [] as Record<string, unknown>[],
  objects: new Map<string, Buffer>(),
  uploadedBytes: null as Buffer | null,
  acceptedUploads: 0,
  uploadAttempts: 0,
  uploadFault: "none" as "none" | "returned" | "thrown",
  downloadMode: "normal" as "normal" | "corrupt" | "unavailable",
  removeFault: "none" as "none" | "returned" | "thrown",
  pointerMissing: false,
  rpcMode: "normal" as "normal" | "refused" | "throw-before" | "commit-return-error" | "commit-throw",
  rpcCalls: [] as Record<string, unknown>[],
  removedKeys: [] as string[],
  ownerReadUnavailable: false,
  ownerReads: 0,
  verifiedTokens: [] as string[],
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  type Row = Record<string, unknown>;
  type Result = { data: Row[] | null; error: { code: string; message: string } | null };
  type Query = PromiseLike<Result> & {
    select(): Query;
    eq(column: string, value: unknown): Query;
    is(column: string, value: unknown): Query;
    not(column: string, operator: string, value: unknown): Query;
    in(column: string, values: unknown[]): Query;
    order(column: string, options?: { ascending?: boolean }): Query;
    limit(count: number): Query;
  };
  const profile = {
    id: "nonbeer-profile-owner",
    user_id: "nonbeer-account-owner",
    handle: "receipt_owner",
    tombstoned_at: null,
    created_at: "2026-10-03T00:00:00.000Z",
    updated_at: "2026-10-03T00:00:00.000Z",
  };
  function selectRows(table: string, columns = "*") {
    const ownerRead = table === "community_prices" && columns.includes("receipt_photo_key");
    if (ownerRead) service.ownerReads += 1;
    let rows: Row[];
    switch (table) {
      case "profiles": rows = [profile]; break;
      case "private_account_identities":
        rows = [{ user_id: profile.user_id, date_of_birth: "1990-01-01" }];
        break;
      case "adult_self_assertions":
        rows = [{ user_id: profile.user_id, asserted_at: "2026-10-03T00:00:00.000Z" }];
        break;
      case "profile_handle_aliases":
        rows = [{ handle: profile.handle, profile_id: profile.id, is_current: true }];
        break;
      case "community_prices": rows = [...service.prices]; break;
      case "pint_drops": rows = [...service.drops]; break;
      case "price_trust_events":
      case "price_trust_credits":
      case "price_trust_reconciliation_queue": rows = []; break;
      default: throw new Error(`Unmodelled SDK table read: ${table}`);
    }
    const answer = (): Result => ownerRead && service.ownerReadUnavailable
      ? { data: null, error: { code: "08006", message: "Controlled ownership read unavailable" } }
      : { data: rows, error: null };
    const query: Query = {
      select: () => query,
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      is(column: string, value: unknown) {
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return query;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator !== "is" || value !== null) throw new Error("Unmodelled SDK not filter");
        rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
        return query;
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      order(column: string, options?: { ascending?: boolean }) {
        rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) *
          (options?.ascending === false ? -1 : 1));
        return query;
      },
      limit(count: number) { rows = rows.slice(0, count); return query; },
      then<TResult1 = Result, TResult2 = never>(
        onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) { return Promise.resolve(answer()).then(onfulfilled, onrejected); },
    };
    return query;
  }
  async function upsertAttributedPrice(args: Record<string, unknown>) {
    service.rpcCalls.push({ ...args });
    const nine = Object.hasOwn(args, "p_receipt_photo_key");
    if (nine && service.pointerMissing) {
      return { data: null, error: { code: "PGRST202", message: "Could not find public.upsert_attributed_community_price_if_newer with p_receipt_photo_key in the schema cache" } };
    }
    if (nine && service.rpcMode === "refused") {
      return { data: null, error: { code: "23514", message: "Controlled SQL refusal" } };
    }
    if (nine && service.rpcMode === "throw-before") throw new Error("Controlled response interruption before commit");
    const previous = service.prices.find((row) =>
      row.actor === args.p_actor && row.venue_id === args.p_venue_id &&
      row.drink_category === args.p_drink_category);
    const previousKey = previous?.receipt_photo_key ?? null;
    const accepted = !previous || Date.parse(String(args.p_submitted_at)) >= Date.parse(String(previous.submitted_at));
    const row: Row = {
      id: previous?.id ?? `nonbeer-price-${service.prices.length + 1}`,
      actor: args.p_actor,
      venue_id: args.p_venue_id,
      drink_category: args.p_drink_category,
      price_pennies: args.p_price_pennies,
      contributor_handle: args.p_contributor_handle,
      submitted_at: args.p_submitted_at,
      hidden_at: previous?.hidden_at ?? null,
      report_count: previous?.report_count ?? 0,
      round_spend_id: args.p_round_spend_id ?? null,
      round_line_index: args.p_round_line_index ?? null,
      receipt_photo_key: nine ? args.p_receipt_photo_key ?? null : null,
    };
    if (accepted) {
      if (previous) service.prices.splice(service.prices.indexOf(previous), 1);
      service.prices.push(row);
    }
    const stored = service.prices.find((stored) => stored.id === row.id)!;
    if (nine && service.rpcMode === "commit-return-error") {
      return { data: null, error: { code: "08006", message: "Controlled response interruption after commit" } };
    }
    if (nine && service.rpcMode === "commit-throw") throw new Error("Controlled response interruption after commit");
    return { data: [{
      id: stored.id, price_pennies: stored.price_pennies, submitted_at: stored.submitted_at,
      round_spend_id: stored.round_spend_id ?? null, round_line_index: stored.round_line_index ?? null,
      source_became_owner: true,
      ...(nine ? {
        receipt_became_owner: accepted && args.p_receipt_photo_key != null,
        receipt_photo_key: stored.receipt_photo_key ?? null,
        previous_receipt_photo_key: accepted && previousKey !== (stored.receipt_photo_key ?? null) ? previousKey : null,
      } : {}),
    }], error: null };
  }
  const admin = {
    auth: {
      async getUser(token: string) {
        service.verifiedTokens.push(token);
        return token === "nonbeer-owner-token"
          ? { data: { user: { id: profile.user_id } }, error: null }
          : { data: { user: null }, error: { status: 401, message: "Invalid token" } };
      },
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (name === "check_rate_limit") return { data: false, error: null };
      if (name === "public_withdrawn_profiles") return { data: [], error: null };
      if (name === "upsert_attributed_community_price_if_newer") return upsertAttributedPrice(args);
      // Trust reconciliation is intentionally unavailable at the SDK boundary.
      // The real route must retain its documented price-save/pending behavior.
      return { data: null, error: { message: `Controlled SDK RPC unavailable: ${name}` } };
    },
    from: (table: string) => ({ select: (columns?: string) => selectRows(table, columns) }),
    storage: {
      from: (bucket: string) => ({
        async upload(path: string, body: unknown, options: { upsert?: boolean }) {
          service.uploadAttempts += 1;
          if (service.uploadFault === "thrown") throw new Error("Controlled upload unavailable");
          if (service.uploadFault === "returned") return { data: null, error: { message: "Controlled upload unavailable" } };
          const key = `${bucket}/${path}`;
          if (!options.upsert && service.objects.has(key)) {
            return { data: null, error: { message: "Object already exists" } };
          }
          const bytes = body instanceof Blob
            ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body as Uint8Array);
          service.objects.set(key, bytes);
          service.uploadedBytes = bytes;
          service.acceptedUploads += 1;
          return { data: { path }, error: null };
        },
        async download(path: string) {
          if (service.downloadMode === "unavailable") return { data: null, error: { message: "Controlled download unavailable" } };
          const original = service.objects.get(`${bucket}/${path}`);
          const bytes = original && service.downloadMode === "corrupt" ? Buffer.concat([original, Buffer.from([0])]) : original;
          return bytes
            ? { data: new Blob([new Uint8Array(bytes)]), error: null }
            : { data: null, error: { message: "Object not found" } };
        },
        async remove(paths: string[]) {
          service.removedKeys.push(...paths);
          if (service.removeFault === "thrown") throw new Error("Controlled cleanup unavailable");
          if (service.removeFault === "returned") return { data: null, error: { message: "Controlled cleanup unavailable" } };
          for (const path of paths) service.objects.delete(`${bucket}/${path}`);
          return { data: [], error: null };
        },
        async createSignedUrl(path: string) {
          return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
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

import { GET, POST } from "@/app/api/price-submit/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { communityPriceStore, readCommunityPrices } from "@/lib/communityPriceStore";
import { __resetMemoryProfileWithdrawals } from "@/lib/accountPublicAccess.server";
import { STORAGE_BUCKET } from "@/lib/supabase";
import { readUploadedImageObject } from "@/lib/uploadedImage.server";

const VENUE_ID = "venue-xjf3n0";
const categories = ["wine", "cocktail", "whisky"] as const;

async function bill(): Promise<File> {
  const bytes = await readFile(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
  return new File([new Uint8Array(bytes)], "bill.jpg", { type: "image/jpeg" });
}

function request(category: string, receipt: File | null, token: string | null = "nonbeer-owner-token", price = "5.50") {
  const form = new FormData();
  form.set("venueId", VENUE_ID);
  form.set("drinkCategory", category);
  form.set("priceGbp", price);
  // Client-supplied identity must not become the observation's authority.
  form.set("handle", "someone_else");
  form.set("actor", "profile:someone_else");
  if (receipt) form.set("receipt_photo", receipt);
  return new Request("http://localhost/api/price-submit", {
    method: "POST", body: form,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  __resetPintDrops();
  service.prices.length = 0;
  service.drops.length = 0;
  service.objects.clear();
  service.uploadedBytes = null;
  service.acceptedUploads = 0;
  service.uploadAttempts = 0;
  service.uploadFault = "none";
  service.downloadMode = "normal";
  service.removeFault = "none";
  service.pointerMissing = false;
  service.rpcMode = "normal";
  service.rpcCalls.length = 0;
  service.removedKeys.length = 0;
  service.ownerReadUnavailable = false;
  service.ownerReads = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T17:00:00Z"));
  service.verifiedTokens.length = 0;
  __resetMemoryProfileWithdrawals();
  vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "off");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("non-beer price submission and its bill", () => {
  it.each(categories)("retains a readable bill owned by the canonical %s observation", async (category) => {
    const response = await POST(request(category, await bill()));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(service.verifiedTokens).toContain("nonbeer-owner-token");
    expect(body).toMatchObject({ ok: true, price: { venueId: VENUE_ID, drinkCategory: category, priceGbp: 5.5 } });
    expect(service.prices).toHaveLength(1);
    expect(service.prices[0]).toMatchObject({ actor: "profile:nonbeer-profile-owner", contributor_handle: "receipt_owner" });
    expect(service.drops).toEqual([]);
    expect(service.acceptedUploads).toBe(1);
    const key = service.prices[0].receipt_photo_key;
    expect(key).toBeTypeOf("string");
    const stored = await readUploadedImageObject(String(key));
    expect(stored.ok).toBe(true);
    if (!stored.ok) throw new Error("Accepted price lost its bill");
    expect(stored.image.bytes.equals(service.uploadedBytes!)).toBe(true);
    expect((await sharp(stored.image.bytes).metadata()).format).toBe("jpeg");
  });

  it("refuses non-image bytes labelled JPEG before saving a wine observation", async () => {
    const bad = new File(["this is not a photo"], "bill.jpg", { type: "image/jpeg" });
    const response = await POST(request("wine", bad));
    expect(response.status, JSON.stringify(await response.json())).toBe(400);
    expect(service.prices).toEqual([]);
    expect(service.drops).toEqual([]);
    expect(service.objects.size).toBe(0);
  });

  it.each(categories)("keeps %s in its own community-price category without a beer Pint Drop", async (category) => {
    const response = await POST(request(category, await bill()));
    expect(response.status, JSON.stringify(await response.json())).toBe(201);
    const storedPrices = await readCommunityPrices(VENUE_ID);
    expect(storedPrices).toHaveLength(1);
    expect(storedPrices).toMatchObject([{ drinkCategory: category, priceGbp: 5.5, corroborations: 1 }]);
    const readback = await GET(new Request(`http://localhost/api/price-submit?venueId=${VENUE_ID}`));
    expect(readback.status).toBe(200);
    const publicBody = await readback.json();
    expect(publicBody).toMatchObject({ prices: [{ drinkCategory: category, priceGbp: 5.5 }] });
    expect(publicBody.prices).toHaveLength(1);
    for (const price of publicBody.prices) {
      expect(price).not.toHaveProperty("actor");
      expect(price).not.toHaveProperty("receipt_photo_key");
      expect(price).not.toHaveProperty("receiptPhotoKey");
    }
    expect(service.drops).toEqual([]);
    expect(service.prices[0].actor).toBe("profile:nonbeer-profile-owner");
  });

  it("keeps the receipt-required gate for wine", async () => {
    const response = await POST(request("wine", null));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "RECEIPT_REQUIRED" });
    expect(service.prices).toEqual([]);
    expect(service.acceptedUploads).toBe(0);
  });

  it.each([null, "invalid-token"])("refuses an unverified caller (%s) before saving price or bill", async (token) => {
    const response = await POST(request("wine", await bill(), token));
    expect(response.status, JSON.stringify(await response.json())).toBe(401);
    expect(service.prices).toEqual([]);
    expect(service.acceptedUploads).toBe(0);
  });
});

const EARLY = "2026-10-03T17:00:00Z";
const LATER = "2026-10-03T20:00:00Z";
async function seedObservation(stamp = EARLY, pennies = 550): Promise<string> {
  const key = `${VENUE_ID}/community-receipt-prior/receipt.jpg`;
  service.prices.push({ id: "prior-owned-observation", venue_id: VENUE_ID,
    drink_category: "wine", price_pennies: pennies, actor: "profile:nonbeer-profile-owner",
    contributor_handle: "receipt_owner", submitted_at: stamp, hidden_at: null,
    report_count: 0, round_spend_id: null, round_line_index: null, receipt_photo_key: key });
  service.objects.set(`${STORAGE_BUCKET}/${key}`, Buffer.from(await (await bill()).arrayBuffer()));
  return key;
}
function noPublicKeys(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain("receipt_photo_key");
  expect(text).not.toContain("receiptPhotoKey");
  const keys = [...service.removedKeys, ...service.rpcCalls.map((call) => call.p_receipt_photo_key)];
  for (const key of keys) if (typeof key === "string") expect(text).not.toContain(key);
}
async function accepted(response: Response, price = 5.5): Promise<void> {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  expect(body).toMatchObject({ ok: true, price: { venueId: VENUE_ID, drinkCategory: "wine", priceGbp: price } });
  noPublicKeys(body);
  expect(service.drops).toEqual([]);
}
async function refused(response: Response): Promise<void> {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(503);
  expect(body).toMatchObject({ code: "UNAVAILABLE", retryable: true });
  expect(body.error).toBeTypeOf("string");
  expect(response.headers.get("cache-control")).toBe("no-store");
  noPublicKeys(body);
  expect(service.drops).toEqual([]);
}

describe("non-beer bill retention through failures and corrections", () => {
  it("replaces its own observation and removes only the displaced bill", async () => {
    const old = await seedObservation();
    vi.setSystemTime(new Date(LATER));
    await accepted(await POST(request("wine", await bill(), "nonbeer-owner-token", "6.50")), 6.5);
    expect(service.prices).toHaveLength(1);
    const saved = service.prices[0];
    expect(saved).toMatchObject({ id: "prior-owned-observation", price_pennies: 650 });
    expect(saved.receipt_photo_key).toBeTypeOf("string");
    expect(saved.receipt_photo_key).not.toBe(old);
    expect(service.objects.has(`${STORAGE_BUCKET}/${saved.receipt_photo_key}`)).toBe(true);
    expect(service.objects.has(`${STORAGE_BUCKET}/${old}`)).toBe(false);
    expect(service.removedKeys).toEqual([old]);
    expect(service.acceptedUploads).toBe(1);
    const readback = await GET(new Request(`http://localhost/api/price-submit?venueId=${VENUE_ID}`));
    expect(readback.status).toBe(200); noPublicKeys(await readback.json());
  });

  it("keeps a newer owned bill and removes only this stale attempt's upload", async () => {
    const old = await seedObservation(LATER, 650);
    await accepted(await POST(request("wine", await bill())), 6.5);
    expect(service.prices[0]).toMatchObject({ id: "prior-owned-observation", price_pennies: 650, receipt_photo_key: old });
    expect(service.acceptedUploads).toBe(1);
    expect(service.removedKeys).toHaveLength(1);
    expect(service.removedKeys).not.toContain(old);
    expect(service.objects.size).toBe(1);
    expect(service.objects.has(`${STORAGE_BUCKET}/${old}`)).toBe(true);
  });

  it("accepts the existing equal-timestamp correction and its new bill", async () => {
    const old = await seedObservation();
    await accepted(await POST(request("wine", await bill(), "nonbeer-owner-token", "6.50")), 6.5);
    expect(service.prices[0]).toMatchObject({ id: "prior-owned-observation", price_pennies: 650 });
    expect(service.prices[0].receipt_photo_key).toBeTypeOf("string");
    expect(service.prices[0].receipt_photo_key).not.toBe(old);
    expect(service.removedKeys).toEqual([old]);
    expect(service.objects.size).toBe(1);
  });

  it.each(["returned", "thrown"] as const)("preserves price when upload failure is %s", async (fault) => {
    service.uploadFault = fault;
    await accepted(await POST(request("wine", await bill())));
    expect(service.uploadAttempts).toBe(1);
    expect(service.acceptedUploads).toBe(0);
    expect(service.prices).toHaveLength(1);
    expect(service.prices[0].receipt_photo_key ?? null).toBeNull();
    expect(service.objects.size).toBe(0);
  });

  it("refuses proven corrupt storage bytes before writing a price", async () => {
    service.downloadMode = "corrupt";
    await refused(await POST(request("wine", await bill())));
    expect(service.acceptedUploads).toBe(1);
    expect(service.prices).toEqual([]);
    expect(service.rpcCalls).toEqual([]);
    expect(service.objects.size).toBe(0);
    expect(service.removedKeys).toHaveLength(1);
  });

  it("keeps accepted bill when readback is unavailable rather than proven corrupt", async () => {
    service.downloadMode = "unavailable";
    await accepted(await POST(request("wine", await bill())));
    const key = service.prices[0].receipt_photo_key;
    expect(key).toBeTypeOf("string");
    expect(service.objects.has(`${STORAGE_BUCKET}/${key}`)).toBe(true);
    expect(service.removedKeys).toEqual([]);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).toContain("uploaded_image.write_unproven");
  });

  it("falls back to old eight arguments when receipt migration is unavailable", async () => {
    service.pointerMissing = true;
    await accepted(await POST(request("wine", await bill())));
    expect(service.rpcCalls.map((call) => Object.hasOwn(call, "p_receipt_photo_key"))).toEqual([true, false]);
    expect(service.acceptedUploads).toBe(1);
    expect(service.prices[0].receipt_photo_key ?? null).toBeNull();
    expect(service.removedKeys).toHaveLength(1);
    expect(service.objects.size).toBe(0);
  });

  it.each(["commit-return-error", "commit-throw"] as const)("recovers a proved committed bill after %s", async (mode) => {
    service.rpcMode = mode;
    await accepted(await POST(request("wine", await bill())));
    expect(service.ownerReads).toBeGreaterThan(0);
    expect(service.prices).toHaveLength(1);
    const key = service.prices[0].receipt_photo_key;
    expect(key).toBeTypeOf("string");
    expect(service.objects.has(`${STORAGE_BUCKET}/${key}`)).toBe(true);
    expect(service.removedKeys).toEqual([]);
  });

  it.each([false, true])("never deletes a candidate a lost reply may still commit (owner unknown=%s)", async (unknown) => {
    service.rpcMode = "throw-before";
    service.ownerReadUnavailable = unknown;
    await refused(await POST(request("wine", await bill())));
    expect(service.ownerReads).toBeGreaterThan(0);
    expect(service.prices).toEqual([]);
    expect(service.acceptedUploads).toBe(1);
    expect(service.objects.size).toBe(1);
    expect(service.removedKeys).toEqual([]);
  });

  it("removes the displaced bill when a receipt-less write replaces its own observation", async () => {
    const old = await seedObservation();
    vi.setSystemTime(new Date(LATER));
    const result = await communityPriceStore().submit({ venueId: VENUE_ID, drinkCategory: "wine", priceGbp: 6.5,
      actor: "profile:nonbeer-profile-owner", contributorHandle: "receipt_owner" });
    expect(result.price).toMatchObject({ venueId: VENUE_ID, drinkCategory: "wine", priceGbp: 6.5 });
    noPublicKeys(result);
    expect(service.rpcCalls.at(-1)).toMatchObject({ p_receipt_photo_key: null });
    expect(service.prices[0]).toMatchObject({ id: "prior-owned-observation", price_pennies: 650, receipt_photo_key: null });
    expect(service.removedKeys).toEqual([old]);
    expect(service.objects.size).toBe(0);
  });

  it("keeps prior price and bill on SQL refusal, cleaning only this candidate", async () => {
    const old = await seedObservation();
    service.rpcMode = "refused";
    await refused(await POST(request("wine", await bill())));
    expect(service.prices[0]).toMatchObject({ id: "prior-owned-observation", price_pennies: 550, receipt_photo_key: old });
    expect(service.objects.has(`${STORAGE_BUCKET}/${old}`)).toBe(true);
    expect(service.objects.size).toBe(1);
    expect(service.removedKeys).toHaveLength(1);
    expect(service.removedKeys).not.toContain(old);
  });

  it.each(["returned", "thrown"] as const)("records a %s cleanup refusal without pretending bytes were deleted", async (fault) => {
    const old = await seedObservation(LATER, 650);
    service.removeFault = fault;
    await accepted(await POST(request("wine", await bill())), 6.5);
    expect(service.prices[0]).toMatchObject({ price_pennies: 650, receipt_photo_key: old });
    expect(service.acceptedUploads).toBe(1);
    expect(service.removedKeys).toHaveLength(1);
    expect(service.removedKeys).not.toContain(old);
    expect(service.objects.size).toBe(2);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).toContain("pint_drops.photo_cleanup_failed");
  });
});
