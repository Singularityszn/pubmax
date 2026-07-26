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
// 2. The rate limiter is shared and in-process. Reset it before every case so
//    the actor-wide and per-venue budgets stay deterministic.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

// Lets one case simulate the slim index failing to load (getVenueIndex's
// documented degraded mode is an empty map); every other case passes through
// to the real index on disk.
const venueIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    getVenueIndex: async () =>
      venueIndexState.unavailable ? new Map() : actual.getVenueIndex(),
  };
});

// Same seam for the UK base index: an unavailable result must produce a
// retryable 503 for a base id it cannot validate.
const ukBaseIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBaseIndex")>();
  return {
    ...actual,
    getUkBaseIdIndex: async () =>
      ukBaseIndexState.unavailable
        ? { status: "unavailable" as const }
        : actual.getUkBaseIdIndex(),
  };
});

// Lets the read-back race cases pin what the POST fallback answers when the
// read-back no longer holds the submitter's own figure. The race itself (a
// rival device's write landing between this write and the read-back) cannot be
// produced deterministically through the real store from a sequential test, so
// the override stands in for the read-back's result; every other case passes
// through untouched.
const readBackState = vi.hoisted(() => ({
  override: null as import("@/lib/communityPrice").CommunityPrice[] | null,
  statusOverride: null as {
    prices: import("@/lib/communityPrice").CommunityPrice[];
    degraded: boolean;
  } | null,
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return {
    ...actual,
    readCommunityPrices: async (venueId: string, now?: number) =>
      readBackState.override ?? actual.readCommunityPrices(venueId, now),
    readCommunityPricesWithStatus: async (venueId: string, now?: number) =>
      readBackState.statusOverride ?? {
        prices: await actual.readCommunityPrices(venueId, now),
        degraded: false,
      },
  };
});

import { GET, POST } from "@/app/api/price-submit/route";
import {
  __resetCommunityPrices,
  readCommunityPrices,
} from "@/lib/communityPriceStore";
import { COMMUNITY_PRICE_MAX_GBP } from "@/lib/communityPrice";
import { __resetPintDrops } from "@/lib/pintDrops";
import { getUkBaseIdIndex } from "@/lib/ukBaseIndex";
import { UK_BASE_ID_PREFIX } from "@/lib/ukBasePubs";
import { getVenueIndex } from "@/lib/venueIndex";

type PriceBody = {
  ok?: boolean;
  error?: string;
  price?: {
    priceGbp: number;
    drinkCategory: string;
    source: string;
    submittedAt: number;
    corroborations?: number;
    mapCandidate?: { priceGbp: number; submittedAt: number; corroborations: number };
  };
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
  venueIndexState.unavailable = false;
  ukBaseIndexState.unavailable = false;
  readBackState.override = null;
  readBackState.statusOverride = null;
  __resetCommunityPrices();
  __resetPintDrops();
});

afterEach(async () => {
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
      post({ venueId: "venue-xjf3n0", drinkCategory: "beer", priceGbp: 4.2 }),
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
        venueId: "venue-lrz4u2",
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
    for (let i = 0; i < 9; i += 1) {
      const res = await POST(
        post({ venueId: "venue-1f5ygjb", drinkCategory: "beer", priceGbp: 4 + i / 100 }),
      );
      expect(res.status, `submission ${i + 1}`).toBe(i < 8 ? 201 : 429);
      if (i === 8) {
        const data = (await res.json()) as PriceBody;
        expect(data.error).toContain("slow down");
      }
    }
  });

  it("rate-limits one actor across different venues after 30 submissions (429)", async () => {
    const venueIds = [...(await getVenueIndex()).keys()].slice(0, 31);
    expect(venueIds).toHaveLength(31);

    for (const [index, venueId] of venueIds.entries()) {
      const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
      expect(res.status, `submission ${index + 1}`).toBe(index < 30 ? 201 : 429);
    }
  });

  it("rejects venue ids absent from the slim index without storing them", async () => {
    const venueId = "totally-fake-venue-xyz";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(400);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("answers 503 (retryable), not 400, when the venue index is unavailable", async () => {
    venueIndexState.unavailable = true;
    const venueId = "venue-xjf3n0";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(503);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("try again");
    // Nothing was stored while the membership check could not run.
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });
});

// UK base pubs live outside the curated venue index by design, but they ARE a
// submission target ("No price yet - be the first"). The route checks their
// ids against the committed base shard pack (lib/ukBaseIndex.ts) instead —
// membership somewhere real, never shape alone.
describe("POST /api/price-submit UK base pubs", () => {
  async function realBaseId(): Promise<string> {
    const result = await getUkBaseIdIndex();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("base index unavailable");
    const first = result.ids.values().next().value;
    expect(typeof first).toBe("string");
    return first as string;
  }

  it("accepts a submission for a committed base pub (201) stamped community", async () => {
    const venueId = await realBaseId();
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as PriceBody;
    expect(data.ok).toBe(true);
    expect(data.price?.source).toBe("community");
  });

  it("accepts a base pub while the unrelated curated index is unavailable", async () => {
    venueIndexState.unavailable = true;
    const venueId = await realBaseId();

    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    expect(res.status).toBe(201);
  });

  it("rejects a well-formed but non-existent venue-uk id (400) without storing", async () => {
    const venueId = `${UK_BASE_ID_PREFIX}n0000000000`;
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as PriceBody;
    expect(data.error).toContain("Pick a venue");
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("answers 503 (retryable) for a base id when the base index is unavailable", async () => {
    ukBaseIndexState.unavailable = true;
    const venueId = `${UK_BASE_ID_PREFIX}n266819667`;
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(503);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });

  it("still rejects a curated-shaped id absent from the slim index (400), untouched by the base branch", async () => {
    const venueId = "totally-fake-venue-xyz";
    const res = await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    expect(res.status).toBe(400);
    expect(await readCommunityPrices(venueId)).toEqual([]);
  });
});

describe("GET /api/price-submit", () => {
  it("reads back the freshest community price per drink category", async () => {
    const venueId = "venue-3h52h";
    await POST(post({ venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    await POST(post({ venueId, drinkCategory: "wine", priceGbp: 8.5 }));

    const res = await GET(get(`?venueId=${venueId}`));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { prices: Array<{ drinkCategory: string }> };
    expect(data.prices.map((row) => row.drinkCategory).sort()).toEqual(["beer", "wine"]);
    expect(data).not.toHaveProperty("degraded");
  });

  it("is honest-empty (200) for a missing or unknown venue, never a 500", async () => {
    expect((await GET(get(""))).status).toBe(200);
    expect(await (await GET(get(""))).json()).toEqual({ prices: [] });
    expect(await (await GET(get("?venueId=nobody-here"))).json()).toEqual({ prices: [] });
  });

  it("adds a degraded signal without changing the fail-soft prices payload", async () => {
    readBackState.statusOverride = { prices: [], degraded: true };

    const res = await GET(get("?venueId=venue-3h52h"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prices: [], degraded: true });
  });
});

// The corroboration count the POST answers with is what promotes a submission
// from the pub's sheet onto the map, so the route has to state it - and has to
// derive it, never accept it. Identity here is the server-derived hashed IP, so
// "a different device" is a different x-forwarded-for.
describe("POST /api/price-submit corroboration", () => {
  function postAs(ip: string, body: unknown): Request {
    return new Request("http://localhost/api/price-submit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });
  }

  async function priceOf(res: Response) {
    expect(res.status).toBe(201);
    return ((await res.json()) as PriceBody).price;
  }

  // A REAL venue id per case: the route checks slim-index membership before
  // anything else, so a made-up id would 400 and never exercise the count.
  // Drawn from the far end of the index so these can never collide with the
  // cross-venue rate-limit case above, which consumes the first 31 ids.
  async function realVenueId(offset: number): Promise<string> {
    const ids = [...(await getVenueIndex()).keys()];
    expect(ids.length).toBeGreaterThan(31 + offset);
    return ids[ids.length - 1 - offset];
  }

  it("answers a first report with one voice - the tap landed, the map did not move", async () => {
    const venueId = await realVenueId(0);
    const price = await priceOf(
      await POST(postAs("1.1.1.1", { venueId, drinkCategory: "beer", priceGbp: 4.2 })),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("answers the second independent agreeing report with two", async () => {
    const venueId = await realVenueId(1);
    await POST(postAs("1.1.1.1", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    const price = await priceOf(
      await POST(postAs("2.2.2.2", { venueId, drinkCategory: "beer", priceGbp: 4.5 })),
    );
    // The response is the submitter's own figure, now backed by two devices.
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(2);
  });

  it("keeps one voice when the same device logs again from the same address", async () => {
    const venueId = await realVenueId(2);
    await POST(postAs("3.3.3.3", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    const price = await priceOf(
      await POST(postAs("3.3.3.3", { venueId, drinkCategory: "beer", priceGbp: 4.3 })),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("keeps one voice when a second device contradicts rather than agrees", async () => {
    const venueId = await realVenueId(3);
    await POST(postAs("4.4.4.4", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    const price = await priceOf(
      await POST(postAs("5.5.5.5", { venueId, drinkCategory: "beer", priceGbp: 7.5 })),
    );
    expect(price?.corroborations).toBe(1);
  });

  it("refuses a client-supplied corroboration count outright", async () => {
    const venueId = await realVenueId(4);
    const price = await priceOf(
      await POST(
        postAs("6.6.6.6", {
          venueId,
          drinkCategory: "beer",
          priceGbp: 4.2,
          corroborations: 99,
        }),
      ),
    );
    // A body that could set this could repaint the map from one device, which
    // is exactly the hole the threshold closes.
    expect(price?.corroborations).toBe(1);
  });

  it("states the count on the read path too, so a reload agrees with the tap", async () => {
    const venueId = await realVenueId(5);
    await POST(postAs("7.7.7.7", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    await POST(postAs("8.8.8.8", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));

    const data = (await (await GET(get(`?venueId=${venueId}`))).json()) as {
      prices: Array<{ corroborations?: number }>;
    };
    expect(data.prices[0]?.corroborations).toBe(2);
  });

  it("keeps the corroborated figure as the map candidate when a third device disagrees", async () => {
    // Devices A and B agree on £4.20 (driving the map); C logs a fresh £9.00.
    const venueId = await realVenueId(6);
    await POST(postAs("9.9.9.9", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    await POST(postAs("10.10.10.10", { venueId, drinkCategory: "beer", priceGbp: 4.2 }));
    const cPrice = await priceOf(
      await POST(postAs("11.11.11.11", { venueId, drinkCategory: "beer", priceGbp: 9 })),
    );

    // C's receipt figure is their own £9.00 at one voice - but the candidate
    // that decides the map is still the corroborated £4.20, so a lone
    // disagreement can neither repaint the map nor un-paint it.
    expect(cPrice?.priceGbp).toBe(9);
    expect(cPrice?.corroborations).toBe(1);
    expect(cPrice?.mapCandidate?.priceGbp).toBe(4.2);
    expect(cPrice?.mapCandidate?.corroborations).toBe(2);

    // The read path agrees: sheet row freshest-wins, candidate best-backed.
    const data = (await (await GET(get(`?venueId=${venueId}`))).json()) as {
      prices: Array<{
        priceGbp: number;
        corroborations?: number;
        mapCandidate?: { priceGbp: number; corroborations: number };
      }>;
    };
    expect(data.prices[0]?.priceGbp).toBe(9);
    expect(data.prices[0]?.corroborations).toBe(1);
    expect(data.prices[0]?.mapCandidate?.priceGbp).toBe(4.2);
    expect(data.prices[0]?.mapCandidate?.corroborations).toBe(2);
  });

  it("carries the corroborated candidate through a lost read-back race", async () => {
    // A rival device's £9.00 became the category's freshest row between this
    // write and the read-back. The fallback must still answer the submitter's
    // OWN figure at one cautious voice - never the rival's price - but the
    // corroborated candidate rides along so this client's map does not
    // transiently un-paint.
    const venueId = await realVenueId(7);
    readBackState.override = [
      {
        venueId,
        drinkCategory: "beer",
        priceGbp: 9,
        submittedAt: 5_000,
        source: "community",
        corroborations: 1,
        mapCandidate: { priceGbp: 4.2, submittedAt: 4_000, corroborations: 2 },
      },
    ];
    const price = await priceOf(
      await POST(postAs("12.12.12.12", { venueId, drinkCategory: "beer", priceGbp: 4.5 })),
    );
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(1);
    expect(price?.mapCandidate).toEqual({
      priceGbp: 4.2,
      submittedAt: 4_000,
      corroborations: 2,
    });
  });

  it("invents no candidate when the read-back race ends in a degraded read", async () => {
    const venueId = await realVenueId(8);
    readBackState.override = [];
    const price = await priceOf(
      await POST(postAs("13.13.13.13", { venueId, drinkCategory: "beer", priceGbp: 4.5 })),
    );
    // Absent stays absent: the submitter's own figure at one voice, and no
    // fabricated map candidate a degraded read cannot vouch for.
    expect(price?.priceGbp).toBe(4.5);
    expect(price?.corroborations).toBe(1);
    expect(price?.mapCandidate).toBeUndefined();
  });
});
