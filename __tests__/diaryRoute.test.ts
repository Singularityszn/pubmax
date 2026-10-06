import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const ALICE = "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOB = "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ALICE_ACCOUNT = "acct-alice";

const identityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "acct-alice",
    actor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    handle: "alice",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => identityState.resolution,
}));

const venueIndexState = vi.hoisted(() => ({ unavailable: false }));

vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) =>
      venueIndexState.unavailable
        ? { status: "unavailable" as const, canonicalId: id }
        : actual.lookupCanonicalVenue(id),
  };
});

import { GET, POST } from "@/app/api/diary/route";
import { londonDayKey } from "@/lib/pintContributions";
import { __resetDiary } from "@/lib/diaryStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

let VENUE_ID = "";
let VENUE_NAME = "";
let OTHER_VENUE_ID = "";

beforeAll(async () => {
  const index = await getVenueIndex();
  const pubs = [...index.values()].filter((venue) => isPubVenueKind(venue.kind));
  VENUE_ID = pubs[0]?.id ?? "";
  VENUE_NAME = pubs[0]?.name ?? "";
  OTHER_VENUE_ID = pubs[1]?.id ?? "";
  if (!VENUE_ID || !OTHER_VENUE_ID) throw new Error("venue index is empty");
});

let ipCounter = 0;
function post(body: unknown, ip = `203.0.113.${(ipCounter += 1)}`): Request {
  return new Request("http://localhost/api/diary", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(): Request {
  return new Request("http://localhost/api/diary", { method: "GET" });
}

function signIn(actor: string, handle: string) {
  identityState.resolution = { ok: true, accountId: `acct-${handle}`, actor, handle };
}

beforeEach(() => {
  __resetDiary();
  __resetPintDrops();
  venueIndexState.unavailable = false;
  signIn(ALICE, "alice");
});

afterEach(() => vi.restoreAllMocks());

const TODAY = () => londonDayKey(new Date());

describe("POST /api/diary", () => {
  it("logs a visit and lists it for the owner", async () => {
    const created = await POST(
      post({ venueId: VENUE_ID, visitedOn: TODAY(), rating: 4.5, review: "Cracking back room." }),
    );
    expect(created.status).toBe(201);
    const { entry } = await created.json();
    expect(entry).toMatchObject({
      ownerUserId: ALICE_ACCOUNT,
      venueId: VENUE_ID,
      venueName: VENUE_NAME,
      visitedOn: TODAY(),
      rating: 4.5,
      review: "Cracking back room.",
      visibility: "private",
    });
    expect(created.headers.get("cache-control")).toMatch(/no-store/);

    const list = await GET(get());
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.status).toBe("ready");
    expect(body.entries.map((row: { id: string }) => row.id)).toEqual([entry.id]);
  });

  it("defaults the day to today and the rating to none", async () => {
    const res = await POST(post({ venueId: VENUE_ID }));
    expect(res.status).toBe(201);
    const { entry } = await res.json();
    expect(entry.visitedOn).toBe(TODAY());
    expect(entry.rating).toBeNull();
    expect(entry.review).toBe("");
  });

  it.each(["Best Guinness in Soho!", "Hidden gem, great garden.", "Pint <3, Guinness >> the Crown", "Cracking 🍺🍻 back room 👍🏽"])(
    "stores the review %s exactly as written",
    async (review) => {
      const res = await POST(post({ venueId: VENUE_ID, review }));
      expect(res.status).toBe(201);
      expect((await res.json()).entry.review).toBe(review);
      const list = await (await GET(get())).json();
      expect(list.entries.map((row: { review: string }) => row.review)).toEqual([review]);
    },
  );

  it("takes the venue name from the server, never from the body", async () => {
    const res = await POST(post({ venueId: VENUE_ID, venueName: "Fake Name" }));
    expect((await res.json()).entry.venueName).toBe(VENUE_NAME);
  });

  it("refuses a second log of the same pub on the same day with 409", async () => {
    expect((await POST(post({ venueId: VENUE_ID, visitedOn: TODAY() }))).status).toBe(201);
    const again = await POST(post({ venueId: VENUE_ID, visitedOn: TODAY(), rating: 2 }));
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.code).toBe("DIARY_ENTRY_EXISTS");
    expect(body.error).toBe("You already logged this pub for that day.");
    const list = await (await GET(get())).json();
    expect(list.entries).toHaveLength(1);
  });

  it("allows another pub the same day and the same pub on another day", async () => {
    expect((await POST(post({ venueId: VENUE_ID, visitedOn: TODAY() }))).status).toBe(201);
    expect((await POST(post({ venueId: OTHER_VENUE_ID, visitedOn: TODAY() }))).status).toBe(201);
    expect((await POST(post({ venueId: VENUE_ID, visitedOn: "2026-01-02" }))).status).toBe(201);
  });

  it.each([
    ["an unknown pub", { venueId: "venue-does-not-exist" }],
    ["a venue that is not a pub", { venueId: "food-best-turkish-kebab" }],
    ["no pub", {}],
    ["a future day", { venueId: "$V", visitedOn: "2999-01-01" }],
    ["a day before the floor", { venueId: "$V", visitedOn: "1999-12-31" }],
    ["an off-scale rating", { venueId: "$V", rating: 4.2 }],
    ["a rating of zero", { venueId: "$V", rating: 0 }],
    ["a long review", { venueId: "$V", review: "x".repeat(281) }],
    ["a public visibility", { venueId: "$V", visibility: "public" }],
  ])("refuses %s with 400", async (_label, raw) => {
    const body = JSON.parse(JSON.stringify(raw).replace("$V", VENUE_ID));
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_DIARY_ENTRY");
    expect((await (await GET(get())).json()).entries).toEqual([]);
  });

  it("answers a retryable 503, not a 400, when the venue index is unavailable", async () => {
    venueIndexState.unavailable = true;
    const res = await POST(post({ venueId: VENUE_ID, visitedOn: TODAY() }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("STORE_UNAVAILABLE");
    expect(body.retryable).toBe(true);
    venueIndexState.unavailable = false;
    expect((await (await GET(get())).json()).entries).toEqual([]);
    // The same request succeeds once the index is back: it was never the pub.
    expect((await POST(post({ venueId: VENUE_ID, visitedOn: TODAY() }))).status).toBe(201);
  });

  it("still answers 400 for a pub the index genuinely does not know", async () => {
    const res = await POST(post({ venueId: "venue-does-not-exist" }));
    expect(res.status).toBe(400);
  });

  it("counts a review in code points: 280 emoji are accepted, 281 are refused", async () => {
    const ok = await POST(post({ venueId: VENUE_ID, visitedOn: "2026-02-01", review: "🍺".repeat(280) }));
    expect(ok.status).toBe(201);
    expect([...(await ok.json()).entry.review]).toHaveLength(280);
    const tooLong = await POST(post({ venueId: VENUE_ID, visitedOn: "2026-02-02", review: "🍺".repeat(281) }));
    expect(tooLong.status).toBe(400);
  });

  it("stores a review as written, however it is punctuated", async () => {
    for (const [i, review] of ["Best Guinness in Soho!", "Hidden gem, great garden.", "Pint <3, Guinness >> the Crown"].entries()) {
      const res = await POST(post({ venueId: VENUE_ID, visitedOn: `2026-03-0${i + 1}`, review }));
      expect(res.status).toBe(201);
      expect((await res.json()).entry.review).toBe(review);
    }
  });

  it("stores a review without a C1 control character such as U+0085", async () => {
    const res = await POST(post({ venueId: VENUE_ID, review: "Good pint\u0085back room 🍺" }));
    expect(res.status).toBe(201);
    expect((await res.json()).entry.review).toBe("Good pintback room 🍺");
    const list = await (await GET(get())).json();
    expect(list.entries.map((row: { review: string }) => row.review)).toEqual(["Good pintback room 🍺"]);
  });

  it("refuses a malformed body and a non-object body", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post("[1,2]"))).status).toBe(400);
    expect((await POST(post("null"))).status).toBe(400);
  });

  it("requires a signed-in account to write and to read", async () => {
    identityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const written = await POST(post({ venueId: VENUE_ID }));
    expect(written.status).toBe(401);
    const read = await GET(get());
    expect(read.status).toBe(401);
    expect((await read.json()).entries).toBeUndefined();
  });

  it("ignores an owner or handle in the body: the session decides who owns the entry", async () => {
    const res = await POST(
      post({ venueId: VENUE_ID, ownerUserId: "acct-bob", handle: "bob", owner_user_id: "acct-bob" }),
    );
    expect((await res.json()).entry.ownerUserId).toBe(ALICE_ACCOUNT);
    signIn(BOB, "bob");
    expect((await (await GET(get())).json()).entries).toEqual([]);
  });

  it("rate limits a burst from one account and origin with 429", async () => {
    const ip = "198.51.100.77";
    let limited = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = await POST(post({ venueId: VENUE_ID, visitedOn: `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}` }, ip));
      if (res.status === 429) {
        limited += 1;
        expect((await res.json()).retryable).toBe(true);
        break;
      }
    }
    expect(limited).toBe(1);
  });
});

describe("GET /api/diary", () => {
  it("never returns another account's entries", async () => {
    await POST(post({ venueId: VENUE_ID, visitedOn: TODAY(), review: "Alice only." }));
    signIn(BOB, "bob");
    await POST(post({ venueId: OTHER_VENUE_ID, visitedOn: TODAY(), review: "Bob only." }));
    const bob = await (await GET(get())).json();
    expect(bob.entries.map((row: { review: string }) => row.review)).toEqual(["Bob only."]);
    signIn(ALICE, "alice");
    const alice = await (await GET(get())).json();
    expect(alice.entries.map((row: { review: string }) => row.review)).toEqual(["Alice only."]);
  });

  it("lists newest visit day first", async () => {
    await POST(post({ venueId: VENUE_ID, visitedOn: "2026-03-01" }));
    await POST(post({ venueId: OTHER_VENUE_ID, visitedOn: "2026-05-01" }));
    await POST(post({ venueId: VENUE_ID, visitedOn: "2026-04-01" }));
    const body = await (await GET(get())).json();
    expect(body.entries.map((row: { visitedOn: string }) => row.visitedOn)).toEqual([
      "2026-05-01",
      "2026-04-01",
      "2026-03-01",
    ]);
  });
});
