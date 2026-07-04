import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route talks to the PintDropStore interface only. Keep the real module
// (memory store, toDTO, validation) but swap the Supabase store's `create` so
// Supabase-configured tests never open a network connection. Orphan-cleanup
// behaviour is pinned where it now lives: pintDropsStore.test.ts.
const { storeCreate } = vi.hoisted(() => ({
  storeCreate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@/lib/pintDropsStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDropsStore")>(
    "@/lib/pintDropsStore",
  );
  return {
    ...actual,
    supabasePintDropStore: { ...actual.supabasePintDropStore, create: storeCreate },
  };
});

// Mock only the durable limiter; everything else in lib/supabase stays real.
// Default (null) = "durable limiter unavailable", so every existing test keeps
// exercising the in-memory fallback exactly as before.
const { checkRateLimitDurable } = vi.hoisted(() => ({
  checkRateLimitDurable: vi.fn<(key: string) => Promise<boolean | null>>(),
}));
vi.mock("@/lib/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase")>("@/lib/supabase");
  return { ...actual, checkRateLimitDurable };
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

function report(id: string, reason?: string): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: JSON.stringify({ action: "report", id, ...(reason ? { reason } : {}) }),
    }),
  );
}

// Moderator GET/POST. In test env (NODE_ENV !== production, ADMIN_TOKEN unset)
// the gate opens by default; pass a token only where a test sets one.
function modGet(status: string, token?: string): Promise<Response> {
  const qs = token ? `?status=${status}&admin=${encodeURIComponent(token)}` : `?status=${status}`;
  return GET(new Request(`${URL_BASE}${qs}`));
}

function modAction(action: string, id: string, token?: string): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      headers: token ? { "x-admin-token": token } : undefined,
      body: JSON.stringify({ action, id }),
    }),
  );
}

const VENUE = "the-crown";

beforeEach(() => {
  __resetPintDrops();
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ADMIN_TOKEN;
  checkRateLimitDurable.mockReset();
  checkRateLimitDurable.mockResolvedValue(null);
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
  it("lists a created drop, then hides it after report threshold", async () => {
    const created = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    const { drop } = await created.json();

    const listed = await get(VENUE);
    expect(listed.status).toBe(200);
    expect((await listed.json()).drops).toHaveLength(1);

    const reported = await POST(
      new Request(URL_BASE, { method: "POST", body: JSON.stringify({ action: "report", id: drop.id }) }),
    );
    expect(reported.status).toBe(200);

    const afterFirstReport = await get(VENUE);
    expect((await afterFirstReport.json()).drops).toHaveLength(1);

    const secondReport = await report(drop.id);
    expect(secondReport.status).toBe(200);

    const afterThreshold = await get(VENUE);
    expect((await afterThreshold.json()).drops).toHaveLength(0);
  });

  it("lists all visible drops when venueId is omitted (organic + demo seeds)", async () => {
    await post({ venueId: "first", handle: "ale", priceGbp: 4.2 });
    await post({ venueId: "second", handle: "mild", passedDownNote: "my dad's old local" });

    const res = await get();
    expect(res.status).toBe(200);
    const { drops } = (await res.json()) as { drops: Array<{ provenance: string }> };
    // The two organic drops plus the seeded demo drops, all through one read path.
    expect(drops.filter((d) => d.provenance !== "demo")).toHaveLength(2);
    expect(drops.filter((d) => d.provenance === "demo").length).toBeGreaterThanOrEqual(8);
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

describe("moderation loop", () => {
  async function createDrop(): Promise<string> {
    const res = await post({ venueId: VENUE, handle: "ale", priceGbp: 4.2 });
    return (await res.json()).drop.id as string;
  }

  it("records reportedAt + reportCount and hides at report threshold", async () => {
    const id = await createDrop();

    const res = await report(id, "wrong price");
    expect(res.status).toBe(200);

    // First report records metadata but does not let one actor take down content.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);

    const hidden = await report(id);
    expect(hidden.status).toBe(200);

    // Gone from the public list after the threshold.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);

    // Visible to the moderator queue with metadata.
    const queue = (await (await modGet("hidden")).json()).drops;
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(id);
    expect(queue[0].reportCount).toBe(2);
    expect(queue[0].reportReason).toBe("wrong price");
    expect(typeof queue[0].reportedAt).toBe("string");
  });

  it("restores a reported drop back to the public list", async () => {
    const id = await createDrop();
    await report(id);
    await report(id);

    const restored = await modAction("restore", id);
    expect(restored.status).toBe(200);

    // Back in the public list, gone from the queue.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(1);
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(0);
  });

  it("keeps a drop hidden after keep_hidden", async () => {
    const id = await createDrop();
    await report(id);
    await report(id);

    const kept = await modAction("keep_hidden", id);
    expect(kept.status).toBe(200);

    // Still hidden from the public list.
    expect((await (await get(VENUE)).json()).drops).toHaveLength(0);
    // But reviewed, so it is no longer in the moderation queue.
    expect((await (await modGet("hidden")).json()).drops).toHaveLength(0);
  });

  it("403s moderator endpoints when ADMIN_TOKEN is unset outside dev/test (M3)", async () => {
    const id = await createDrop();
    await report(id);
    // Simulate a deployed env (e.g. a preview) with no ADMIN_TOKEN configured:
    // the gate must DENY, not fall open.
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ADMIN_TOKEN;

    expect((await modGet("hidden")).status).toBe(403);
    expect((await modAction("restore", id)).status).toBe(403);
    expect((await modAction("keep_hidden", id)).status).toBe(403);
  });

  it("403s moderator endpoints in production without a valid token", async () => {
    const id = await createDrop();
    await report(id);
    vi.stubEnv("NODE_ENV", "production");
    process.env.ADMIN_TOKEN = "s3cret";

    expect((await modGet("hidden")).status).toBe(403);
    expect((await modAction("restore", id)).status).toBe(403);
    expect((await modAction("keep_hidden", id)).status).toBe(403);

    // A valid token gets through the gate (the store then 503s — Supabase absent
    // in production — but the point is the 403 gate is cleared).
    const withToken = await modGet("hidden", "s3cret");
    expect(withToken.status).not.toBe(403);
  });
});

describe("durable rate limiting (Supabase configured)", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    storeCreate.mockReset();
    storeCreate.mockImplementation(async (drop) => ({
      ...(drop as Record<string, unknown>),
      pintPhotoUrl: null,
      venuePhotoUrl: null,
    }));
  });

  it("keys the durable limiter on handle + hashed IP, never the raw IP", async () => {
    checkRateLimitDurable.mockResolvedValue(false);
    const res = await POST(
      new Request(URL_BASE, {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
        body: JSON.stringify({ venueId: VENUE, handle: "Ale", priceGbp: 4 }),
      }),
    );
    expect(res.status).toBe(201);
    expect(checkRateLimitDurable).toHaveBeenCalledTimes(1);
    const key = checkRateLimitDurable.mock.calls[0][0];
    expect(key).toContain("ale"); // handle (lowercased) is in the key
    expect(key).toMatch(/[0-9a-f]{64}$/); // ...plus the sha256 IP hash
    expect(key).not.toContain("203.0.113.7"); // raw IP never appears
  });

  it("429s a submission when the durable limiter says limited", async () => {
    checkRateLimitDurable.mockResolvedValue(true);
    const res = await post({ venueId: VENUE, handle: "flooder", priceGbp: 4 });
    expect(res.status).toBe(429);
    expect(storeCreate).not.toHaveBeenCalled();
  });

  it("falls back to the in-memory limiter when the durable one is unavailable", async () => {
    checkRateLimitDurable.mockResolvedValue(null); // outage / RPC error
    let last: Response | undefined;
    for (let i = 0; i < 9; i++) {
      last = await post({ venueId: VENUE, handle: "outage", priceGbp: 4 });
    }
    // Writes keep working (fail open to the backstop), which still limits the 9th.
    expect(last!.status).toBe(429);
  });
});
