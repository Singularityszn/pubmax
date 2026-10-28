import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { roundsStore } from "@/lib/roundsStore";

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

const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "rounds-receipt.test") throw new Error("Unexpected fixture host");
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.pathname === "/rest/v1/rounds") {
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
    rows.push(row);
    return new Response(null, { status: 201 });
  }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    uploads.push(url.pathname);
    return Response.json({ Key: url.pathname });
  }
  throw new Error(`Unexpected fixture path: ${url.pathname}`);
};

beforeEach(() => {
  rows = [];
  uploads = [];
  missingColumn = null;
  insertAttempts = 0;
  vi.stubEnv("SUPABASE_URL", "https://rounds-receipt.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
  vi.stubGlobal("fetch", fixtureFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
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
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"event":"rounds.receipt_column_missing"'));
});
