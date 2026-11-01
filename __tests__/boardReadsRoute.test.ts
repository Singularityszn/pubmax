// POST /api/board-reads, the board reader's proposal read (review item A4).
// Driven through the real entry point and the real model client, with the
// identity gate, the venue target, the image journey and the paid ceiling
// replaced at their seams and the provider answered by a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BOARD_READ_KEYLESS_CODE, BOARD_READ_KEYLESS_LINE } from "@/lib/boardRead";

const seams = vi.hoisted(() => ({
  identity: vi.fn(),
  venue: vi.fn(),
  prepare: vi.fn(),
  budget: vi.fn(),
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: seams.identity,
}));
vi.mock("@/lib/venueWriteTarget.server", () => ({
  resolveWritableVenueId: seams.venue,
}));
vi.mock("@/lib/uploadedImage.server", () => ({
  prepareUploadedImage: seams.prepare,
}));
vi.mock("@/lib/paidSpendBudget.server", () => ({
  paidSpendBudgetRefusal: seams.budget,
}));

const SIGNED_IN = { ok: true, accountId: "account-1", actor: "actor-1", handle: "regular" } as const;

function boardRequest(): Request {
  const form = new FormData();
  form.set("venueId", "venue-eltcmh");
  form.set("photo", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], "board.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/board-reads", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9", authorization: "Bearer token" },
    body: form,
  });
}

function modelAnswer(rows: unknown[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ rows }) } }],
      usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let providerFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubEnv("OPENROUTER_API_KEY", "");
  seams.identity.mockResolvedValue(SIGNED_IN);
  seams.venue.mockResolvedValue({ ok: true, venueId: "venue-eltcmh" });
  seams.prepare.mockResolvedValue({
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    contentType: "image/jpeg",
    width: 1600,
    height: 1200,
    byteSize: 3,
    sha256: "a".repeat(64),
  });
  seams.budget.mockResolvedValue(null);
  providerFetch = vi.fn(async () => modelAnswer([]));
  vi.stubGlobal("fetch", providerFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/board-reads", () => {
  it("refuses a caller with no identity, before the photo or the model", async () => {
    seams.identity.mockResolvedValue({
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    });
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: "sign_in_required" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seams.prepare).not.toHaveBeenCalled();
    expect(seams.budget).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("answers the one keyless line and spends nothing", async () => {
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: BOARD_READ_KEYLESS_LINE,
      code: BOARD_READ_KEYLESS_CODE,
    });
    expect(seams.prepare).not.toHaveBeenCalled();
    expect(seams.budget).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("proposes the rows a price write could hold and drops the rest", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    providerFetch.mockResolvedValue(modelAnswer([
      { name: "Guinness", kind: "drink", category: "beer", measure: "pint", measureLabel: "", pricePence: 620, confidence: "clear" },
      { name: "House red", kind: "drink", category: "wine", measure: "other", measureLabel: "175ml", pricePence: 750, confidence: "likely" },
      { name: "Mystery ale", kind: "drink", category: "beer", measure: "pint", measureLabel: "", pricePence: 0, confidence: "clear" },
      { name: "Lager", kind: "drink", category: "beer", measure: "schooner", measureLabel: "", pricePence: 540, confidence: "clear" },
      { name: "Fish and chips", kind: "food", category: "other", measure: "other", measureLabel: "", pricePence: 1650, confidence: "clear" },
    ]));
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.photo).toEqual({ sha256: "a".repeat(64) });
    expect(body.proposals).toEqual([
      expect.objectContaining({ name: "Guinness", category: "beer", measure: "pint", pricePence: 620, confidence: "clear" }),
      expect.objectContaining({ name: "House red", category: "wine", measure: "other", measureLabel: "175ml", pricePence: 750 }),
    ]);
    expect(body.keptOut).toEqual([expect.objectContaining({ name: "Fish and chips", pricePence: 1650 })]);

    expect(seams.budget).toHaveBeenCalledWith("board-read");
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = providerFetch.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).hostname).toBe("openrouter.ai");
    const sent = JSON.parse(String(init.body));
    expect(sent.provider).toMatchObject({ zdr: true });
    expect(JSON.stringify(sent.messages)).toContain("data:image/jpeg;base64,");
  });

  it("spends the paid ceiling last and answers its refusal", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    seams.budget.mockResolvedValue(
      new Response(JSON.stringify({ error: "We have answered as much as we can today.", code: "DAILY_BUDGET_SPENT" }), { status: 429 }),
    );
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(429);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("answers a retry line when the model fails, never a guessed row", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    providerFetch.mockResolvedValue(new Response("upstream", { status: 502 }));
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "BOARD_READ_FAILED", retryable: true });
  });

  it("refuses a venue the price write would refuse, before the model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    seams.venue.mockResolvedValue({ ok: false, status: 400, error: "Pick a venue from the map." });
    const { POST } = await import("@/app/api/board-reads/route");

    const response = await POST(boardRequest());

    expect(response.status).toBe(400);
    expect(seams.budget).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
