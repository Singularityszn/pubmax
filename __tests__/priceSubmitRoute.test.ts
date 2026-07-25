import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two Vercel-vs-local seams to pin (both would otherwise pass locally and fail
// on Vercel - the classic green-local/red-Vercel trap):
//
// 1. lib/pintDrops (imported for isLimited) pulls @/lib/supabase → node:crypto
//    and the durable rate limiter. On Vercel, SUPABASE_URL/SERVICE_ROLE_KEY are
//    preset, so the limiter would try a live table and the store would flip to
//    the durable backend mid-suite. Pin isSupabaseConfigured() false so both
//    stay on their process-memory paths; hashIp/clientIp/hashActor pass through
//    via ...actual, exactly as the sibling write-route tests do.
// 2. The rate limiter is shared, in-process and keyed by (actor, venue). Each
//    case therefore uses its OWN venue id so one case's budget can't leak into
//    the next and turn a 201 assertion into a surprise 429.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { GET, POST } from "@/app/api/price-submit/route";
import { __resetCommunityPrices, readCommunityPrices } from "@/lib/communityPriceStore";
import { COMMUNITY_PRICE_MAX_GBP } from "@/lib/communityPrice";

type PriceBody = {
  ok?: boolean;
  error?: string;
  price?: { priceGbp: number; drinkCategory: string; source: string; submittedAt: number };
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/price-submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(query: string): Request {
  return new Request(`http://localhost/api/price-submit${query}`);
}

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetCommunityPrices();
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
  }
});

describe("POST /api/price-submit", () => {
  it("records an anonymous submission (201) stamped community", async () => {
    const res = await POST(
      post({ venueId: "route-ok", drinkCategory: "beer", priceGbp: 4.2 }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.ok).toBe(true);
    expect(data.price?.priceGbp).toBe(4.2);
    expect(data.price?.source).toBe("community");
    expect(typeof data.price?.submittedAt).toBe("number");
  });

  it("never trusts a client-supplied timestamp or source", async () => {
    const res = await POST(
      post({
        venueId: "route-untrusted",
        drinkCategory: "beer",
        priceGbp: 5,
        submittedAt: 1,
        source: "sourced",
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.price?.source).toBe("community");
    expect(data.price?.submittedAt).toBeGreaterThan(1);
  });

  it("rejects a price under the floor with a friendly message (400)", async () => {
    const res = await POST(
      post({ venueId: "route-floor", drinkCategory: "beer", priceGbp: 0.45 }),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("£4.50");
    // Nothing was stored - a bounced price never reaches the map.
    expect(await readCommunityPrices("route-floor")).toEqual([]);
  });

  it("rejects a price over the ceiling with a friendly message (400)", async () => {
    const res = await POST(
      post({ venueId: "route-ceiling", drinkCategory: "beer", priceGbp: 99 }),
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain(`£${COMMUNITY_PRICE_MAX_GBP}`);
  });

  it("rejects a missing venue, an unknown drink, and a malformed body (400)", async () => {
    expect((await POST(post({ drinkCategory: "beer", priceGbp: 4.2 }))).status).toBe(400);
    expect(
      (await POST(post({ venueId: "route-bad", drinkCategory: "mead", priceGbp: 4.2 }))).status,
    ).toBe(400);
    const malformed = new Request("http://localhost/api/price-submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect((await POST(malformed)).status).toBe(400);
  });

  it("rate-limits a device spraying prices at one venue (429)", async () => {
    // The limiter's budget is shared per (actor, venue); keep submitting until
    // it bites so the assertion doesn't hard-code the configured limit.
    let sawLimit = false;
    for (let i = 0; i < 40; i += 1) {
      const res = await POST(
        post({ venueId: "route-limit", drinkCategory: "beer", priceGbp: 4 + i / 100 }),
      );
      if (res.status === 429) {
        sawLimit = true;
        const data = (await res.json()) as PriceBody;
        expect(data.error).toContain("slow down");
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});

describe("GET /api/price-submit", () => {
  it("reads back the freshest community price per drink category", async () => {
    await POST(post({ venueId: "route-read", drinkCategory: "beer", priceGbp: 4.2 }));
    await POST(post({ venueId: "route-read", drinkCategory: "wine", priceGbp: 8.5 }));

    const res = await GET(get("?venueId=route-read"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { prices: Array<{ drinkCategory: string }> };
    expect(data.prices.map((row) => row.drinkCategory).sort()).toEqual(["beer", "wine"]);
  });

  it("is honest-empty (200) for a missing or unknown venue, never a 500", async () => {
    expect((await GET(get(""))).status).toBe(200);
    expect(await (await GET(get(""))).json()).toEqual({ prices: [] });
    expect(await (await GET(get("?venueId=nobody-here"))).json()).toEqual({ prices: [] });
  });
});
