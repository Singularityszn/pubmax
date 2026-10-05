import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const STRANGER_PROFILE = "44444444-4444-4444-8444-444444444444";
const VENUE = "venue-xjf3n0";
const BUCKET = "pint-drops";

type PriceRow = Record<string, unknown> & { receipt_photo_key: string | null };
const state = {
  prices: [] as PriceRow[], objects: new Map<string, Buffer>(),
  uploadUnavailable: false, uploadAttempts: 0, paths: [] as string[],
};
let server: Server;
let origin: string;
let routes: typeof import("@/app/api/price-submit/route");
let imageReader: typeof import("@/lib/uploadedImage.server");

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Only external Auth, PostgREST and Storage use this loopback fixture.
// The route, identity gates, SDKs, limiter, stores and image pipeline stay real.
// This fixture does not prove SQL transactions or provider persistence.
async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", origin);
  const path = url.pathname;
  state.paths.push(path);
  if (path === "/auth/v1/user") {
    const token = request.headers.authorization;
    if (token !== "Bearer receipt-owner" && token !== "Bearer receipt-stranger") {
      json(response, { code: "bad_jwt", msg: "Invalid token" }, 401);
      return;
    }
    json(response, { id: token === "Bearer receipt-owner" ? OWNER : STRANGER });
    return;
  }
  if (path === "/rest/v1/profiles") {
    const stranger = url.searchParams.get("user_id") === `eq.${STRANGER}`;
    json(response, [{ id: stranger ? STRANGER_PROFILE : PROFILE, user_id: stranger ? STRANGER : OWNER,
      handle: stranger ? "receipt_stranger" : "receipt_owner", visibility: "public",
      created_at: "2026-10-04T12:00:00Z", updated_at: "2026-10-04T12:00:00Z" }]);
    return;
  }
  if (path === "/rest/v1/private_account_identities") {
    json(response, [{ date_of_birth: "1990-01-01", created_at: "2026-10-04T12:00:00Z", updated_at: "2026-10-04T12:00:00Z" }]);
    return;
  }
  if (path === "/rest/v1/adult_self_assertions" || path === "/rest/v1/profile_handle_aliases") {
    json(response, []);
    return;
  }
  if (path === "/rest/v1/rpc/public_withdrawn_profiles") {
    json(response, []);
    return;
  }
  if (path === "/rest/v1/rpc/check_rate_limit") {
    json(response, false);
    return;
  }
  if (path === "/rest/v1/rpc/upsert_attributed_community_price_if_newer") {
    const args = JSON.parse((await body(request)).toString()) as Record<string, unknown>;
    const previous = state.prices.find(row => row.actor === args.p_actor &&
      row.venue_id === args.p_venue_id && row.drink_category === args.p_drink_category);
    const row: PriceRow = {
      id: previous?.id ?? `price-${state.prices.length + 1}`,
      actor: args.p_actor, contributor_handle: args.p_contributor_handle,
      venue_id: args.p_venue_id, drink_category: args.p_drink_category,
      price_pennies: args.p_price_pennies, submitted_at: args.p_submitted_at,
      hidden_at: null, round_spend_id: null, round_line_index: null,
      receipt_photo_key: typeof args.p_receipt_photo_key === "string" ? args.p_receipt_photo_key : null,
    };
    if (previous) state.prices[state.prices.indexOf(previous)] = row;
    else state.prices.push(row);
    json(response, [{ ...row, source_became_owner: true,
      receipt_became_owner: row.receipt_photo_key !== null,
      previous_receipt_photo_key: previous?.receipt_photo_key ?? null }]);
    return;
  }
  if (path === "/rest/v1/community_prices") {
    const rows = state.prices.filter(row => {
      for (const column of ["actor", "venue_id", "drink_category"]) {
        const filter = url.searchParams.get(column);
        if (filter?.startsWith("eq.") && row[column] !== filter.slice(3)) return false;
      }
      return true;
    });
    json(response, rows);
    return;
  }
  const storagePrefix = `/storage/v1/object/${BUCKET}/`;
  if (path.startsWith(storagePrefix)) {
    const key = decodeURIComponent(path.slice(storagePrefix.length));
    if (request.method === "POST") {
      state.uploadAttempts += 1;
      if (state.uploadUnavailable) {
        json(response, { statusCode: "503", message: "Fixture Storage unavailable" }, 503);
        return;
      }
      const encoded = await body(request);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const form = await new Request(origin + path, { method: "POST", headers, body: new Uint8Array(encoded) }).formData();
      const file = [...form.values()].find(value => value instanceof File);
      if (!(file instanceof File)) {
        json(response, { statusCode: "400", message: "Expected Blob upload" }, 400);
        return;
      }
      state.objects.set(key, Buffer.from(await file.arrayBuffer()));
      json(response, { Key: `${BUCKET}/${key}`, Id: "fixture-object" });
      return;
    }
    const bytes = state.objects.get(key);
    if (!bytes) { json(response, { message: "Object not found" }, 404); return; }
    response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": bytes.byteLength });
    response.end(bytes);
    return;
  }
  if (path === `/storage/v1/object/${BUCKET}` && request.method === "DELETE") {
    const input = JSON.parse((await body(request)).toString()) as { prefixes: string[] };
    for (const key of input.prefixes) state.objects.delete(key);
    json(response, input.prefixes.map(name => ({ name })));
    return;
  }
  json(response, { message: `Unimplemented fixture endpoint: ${path}` }, 503);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void respond(request, response).catch(() => json(response, { message: "Fixture request failed" }, 500));
  });
  await new Promise<void>(resolveListening => server.listen(0, "127.0.0.1", resolveListening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("SUPABASE_URL", origin);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", BUCKET);
  vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "off");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error("Non-loopback request refused by fixture");
    return nativeFetch(input, init);
  });
  vi.resetModules();
  routes = await import("@/app/api/price-submit/route");
  imageReader = await import("@/lib/uploadedImage.server");
});

beforeEach(() => {
  state.prices = [];
  state.objects.clear();
  state.uploadUnavailable = false;
  state.uploadAttempts = 0;
  state.paths = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
});

async function bill(): Promise<File> {
  const bytes = await readFile(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
  return new File([new Uint8Array(bytes)], "bill.jpg", { type: "image/jpeg" });
}

function submit(receipt: File | null, token: string | null = "receipt-owner"): Promise<Response> {
  const form = new FormData();
  form.set("venueId", VENUE);
  form.set("drinkCategory", "wine");
  form.set("priceGbp", "5.50");
  form.set("handle", "receipt_owner");
  form.set("actor", `profile:${PROFILE}`);
  if (receipt) form.set("receipt_photo", receipt);
  return routes.POST(new Request("http://app.test/api/price-submit", {
    method: "POST", body: form,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));
}

it("retains a readable bill with an owner's nonbeer observation through the actual price-submit route", async () => {
  const response = await submit(await bill());
  expect(response.status, await response.clone().text()).toBe(201);
  expect(await response.json()).toMatchObject({ ok: true, price: { venueId: VENUE, drinkCategory: "wine", priceGbp: 5.5 } });
  expect(state.prices).toHaveLength(1);
  expect(defined(state.prices[0])).toMatchObject({ actor: `profile:${PROFILE}`, contributor_handle: "receipt_owner" });
  const key = defined(state.prices[0]).receipt_photo_key;
  expect(key, "Accepted nonbeer price must retain its bill pointer").toBeTypeOf("string");
  if (!key) throw new Error("Accepted price lost its bill");
  const image = await imageReader.readUploadedImageObject(key);
  expect(image.ok).toBe(true);
  expect(state.objects.has(key)).toBe(true);
  expect(state.paths.some(path => path.includes("pint_drops"))).toBe(false);
  const readback = await routes.GET(new Request(`http://app.test/api/price-submit?venueId=${VENUE}`));
  expect(readback.status).toBe(200);
  const text = await readback.text();
  expect(text).not.toContain(key);
  expect(text).not.toContain("receipt_photo_key");
  expect(text).not.toContain("receiptPhotoKey");
});


it("refuses a nonbeer price with no bill before an upload or price write", async () => {
  const response = await submit(null);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "RECEIPT_REQUIRED" });
  expect(state.prices).toEqual([]);
  expect(state.uploadAttempts).toBe(0);
});

it.each([false, true])("refuses nonempty invalid bill bytes before Storage (outage=%s)", async (outage) => {
  state.uploadUnavailable = outage;
  const invalid = new File(["This is not a bill image."], "bill.jpg", { type: "image/jpeg" });
  const response = await submit(invalid);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  expect(state.prices).toEqual([]);
  expect(state.uploadAttempts).toBe(0);
  expect(state.objects.size).toBe(0);
});

it("keeps the documented price-only exception when a valid bill meets a Storage outage", async () => {
  state.uploadUnavailable = true;
  const response = await submit(await bill());
  expect(response.status, await response.clone().text()).toBe(201);
  expect(state.uploadAttempts).toBeGreaterThan(0);
  expect(state.prices).toHaveLength(1);
  expect(defined(state.prices[0])).toMatchObject({ price_pennies: 550, receipt_photo_key: null });
  expect(state.objects.size).toBe(0);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("community_prices.receipt_upload_failed"));
});

it("refuses anonymous receipt writes through the actual identity gate", async () => {
  const response = await submit(await bill(), null);
  expect(response.status).toBe(401);
  expect(state.prices).toEqual([]);
  expect(state.uploadAttempts).toBe(0);
});

it("uses the stranger's verified account rather than the asserted owner actor and handle", async () => {
  const response = await submit(await bill(), "receipt-stranger");
  expect(response.status, await response.clone().text()).toBe(201);
  expect(state.prices).toHaveLength(1);
  expect(defined(state.prices[0])).toMatchObject({
    actor: `profile:${STRANGER_PROFILE}`, contributor_handle: "receipt_stranger",
  });
  expect(state.prices.some(row => row.actor === `profile:${PROFILE}`)).toBe(false);
  expect(state.objects.size).toBe(1);
});
