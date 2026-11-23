import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two Vercel-vs-local seams to pin (both would otherwise pass locally, fail on
// Vercel — the classic green-local/red-Vercel trap):
//
// 1. assertServerEnv() runs at module scope (the house pattern shared by 40+
//    certified routes). On Vercel vitest reads as production without test-scoped
//    Supabase vars, so the import throws "FATAL: Supabase is not configured".
//    Mock serverEnv to a no-op — the guard every sibling route test uses.
//
// 2. The route's storage guard `requiresSupabaseStore() && !isSupabaseConfigured()`
//    503s when requiresSupabaseStore() is true (it is on Vercel: VERCEL_ENV===
//    "production", and deleting SUPABASE_URL does NOT flip it) while
//    isSupabaseConfigured() is false — so every POST 503s and reads return [].
//    Pin the @/lib/supabase seam so BOTH read false: isSupabaseConfigured() false
//    selects the memory store, and requiresSupabaseStore() false disarms the 503
//    guard. This is the design-doc house pattern for write-route tests (see
//    pushTokensRoute.test.ts). hashIp/clientIp/hashActor pass through via ...actual.
//
// 3. The "Your lot" read answers only a verified Social reader (signed in, a
//    claimed handle, the adult check passed, not suspended), as GET
//    /api/presence does. The follow graph, profiles and block list are the real
//    memory stores; only the Social access gate is held.
const routeState = vi.hoisted(() => ({ access: null as unknown }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/authServer", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authServer")>(),
  callerUserId: async (request: Request) => {
    const match = /^Bearer fixture-(.+)$/.exec(request.headers.get("authorization") ?? "");
    return match ? `user-${match[1]}` : null;
  },
}));

import { DELETE, GET, POST } from "@/app/api/check-ins/route";
import { __resetMemoryAdultSelfAssertions, memoryAdultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import type { NormalizedCheckInInput } from "@/lib/checkIn";
import { __resetMemoryCheckIns, checkInStore } from "@/lib/checkInStore";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryPrivateIdentities, memoryPrivateIdentityStore } from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
  type ProfileRecord,
} from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";

const signedOut = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };

function readAs(profile: ProfileRecord): void {
  routeState.access = {
    ok: true,
    actor: { accountId: `account-${profile.handle}`, profileId: profile.id, handle: profile.handle },
    authUserId: profile.userId,
  };
}

async function mutual(a: string, b: string): Promise<void> {
  await followStore().follow(a, b);
  await followStore().follow(b, a);
}

function friendsCheckIn(handle: string, over: Partial<NormalizedCheckInInput> = {}): Promise<unknown> {
  return checkInStore().create({
    handle,
    areaSlug: "brixton",
    venueId: null,
    note: null,
    visibility: "friends",
    ...over,
  });
}

async function readHandles(path = "/api/check-ins"): Promise<string[]> {
  const res = await GET(new Request(`http://localhost${path}`));
  expect(res.status).toBe(200);
  const data = (await res.json()) as { checkIns: { handle: string }[] };
  return data.checkIns.map((c) => c.handle).sort();
}

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/check-ins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteBody(body: unknown): Request {
  return new Request("http://localhost/api/check-ins", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryCheckIns();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  for (const handle of ["reader", "amy", "stranger"]) {
    await memoryProfileStore.ensure(handle);
  }
  routeState.access = signedOut;
});

afterEach(() => {
  vi.restoreAllMocks();
  clearSocialMemoryBlocks();
  __resetMemoryPrivateIdentities();
  __resetMemoryAdultSelfAssertions();
});

describe("GET /api/check-ins?mine=1", () => {
  function read(token: string): Promise<Response> {
    return GET(new Request("http://localhost/api/check-ins?mine=1&viewer=owner", {
      headers: { authorization: `Bearer fixture-${token}` },
    }));
  }

  it("answers only the caller's own check-in, even when Social access is refused", async () => {
    __seedMemoryOwnedProfile("owner", "user-owner");
    __seedMemoryOwnedProfile("other", "user-other");
    await friendsCheckIn("owner");
    routeState.access = { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." };
    await memoryPrivateIdentityStore.updateDetails("user-owner", { dateOfBirth: "2012-01-01" });
    const res = await read("owner");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ mine: { handle: "owner", areaSlug: "brixton" } });
    expect(await (await read("other")).json()).toEqual({ mine: null });
    expect((await GET(new Request("http://localhost/api/check-ins?mine=1&viewer=owner"))).status).toBe(401);
  });

  it("answers a retryable 503, never null, when the store cannot be read", async () => {
    __seedMemoryOwnedProfile("owner", "user-owner");
    vi.spyOn(checkInStore(), "listByHandles").mockRejectedValueOnce(new Error("Database unavailable"));
    const res = await read("owner");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });
});

describe("Social rollback", () => {
  it("blocks check-in reads and writes before touching the store", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const read = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const write = await POST(postBody({ handle: "reader", areaSlug: "shoreditch" }));
    const remove = await DELETE(deleteBody({ handle: "reader" }));

    for (const response of [read, write, remove]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Social is in preview right now.",
        code: "SOCIAL_PREVIEW",
        retryable: false,
      });
    }
  });
});

describe("POST /api/check-ins", () => {
  it("creates a check-in (201) for a valid body", async () => {
    const res = await POST(postBody({ handle: "reader", areaSlug: "shoreditch", note: "out" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { checkIn?: { handle: string; areaSlug: string } };
    expect(data.checkIn?.handle).toBe("reader");
    expect(data.checkIn?.areaSlug).toBe("shoreditch");
  });

  it("stores no profile row when an anonymous check-in names a handle nobody holds", async () => {
    const res = await POST(
      postBody({ handle: "newname", areaSlug: "shoreditch", visibility: "area" }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: "Sign in to check in.",
      code: "UNAUTHENTICATED",
    });
    expect(await memoryProfileStore.getByHandle("newname")).toBeNull();

    const area = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const data = (await area.json()) as { checkIns: { handle: string }[] };
    expect(data.checkIns.map((c) => c.handle)).not.toContain("newname");

    const claimed = await memoryProfileStore.createOwned("newname", "user-real");
    expect(claimed.userId).toBe("user-real");
  });

  it("400s a malformed body", async () => {
    const res = await POST(
      new Request("http://localhost/api/check-ins", { method: "POST", body: "{oops" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a missing handle", async () => {
    const res = await POST(postBody({ areaSlug: "shoreditch" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Choose a handle in your account first.",
    });
  });

  it("400s an unknown area", async () => {
    const res = await POST(postBody({ handle: "reader", areaSlug: "atlantis" }));
    expect(res.status).toBe(400);
  });

  it("creates a no-area check-in (the out-tonight beacon shape)", async () => {
    const res = await POST(postBody({ handle: "reader" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { checkIn?: { handle: string; areaSlug: string | null } };
    expect(data.checkIn?.handle).toBe("reader");
    expect(data.checkIn?.areaSlug).toBeNull();
  });
});

describe("POST /api/check-ins adult gate", () => {
  function signedInPost(handle: string): Request {
    return new Request("http://localhost/api/check-ins", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer fixture-${handle}` },
      body: JSON.stringify({ handle, areaSlug: "shoreditch", venueId: "venue-1vle947" }),
    });
  }

  it("refuses an account whose stored date of birth is under 18, and stores nothing", async () => {
    __seedMemoryOwnedProfile("kid", "user-kid");
    await memoryPrivateIdentityStore.updateDetails("user-kid", { dateOfBirth: "2012-01-01" });

    const res = await POST(signedInPost("kid"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "ADULT_REQUIRED", status: "adult_check_failed" });
    expect(await checkInStore().listByHandles(["kid"], Date.now())).toEqual([]);
  });

  it("asks an account that has not answered the age question for the one tap", async () => {
    __seedMemoryOwnedProfile("newbie", "user-newbie");

    const res = await POST(signedInPost("newbie"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "ADULT_REQUIRED", status: "adult_check_required" });
    expect(await checkInStore().listByHandles(["newbie"], Date.now())).toEqual([]);
  });

  it("lets an adult account check in", async () => {
    __seedMemoryOwnedProfile("grown", "user-grown");
    await memoryAdultSelfAssertionStore.record("user-grown");

    const res = await POST(signedInPost("grown"));
    expect(res.status).toBe(201);
  });
});

describe("DELETE /api/check-ins", () => {
  it("ends the caller's own check-in early (200)", async () => {
    await POST(postBody({ handle: "reader", areaSlug: "shoreditch" }));
    const res = await DELETE(deleteBody({ handle: "reader" }));
    expect(res.status).toBe(200);
    expect(await checkInStore().listByHandles(["reader"], Date.now())).toEqual([]);
  });

  it("400s a missing handle", async () => {
    const res = await DELETE(deleteBody({}));
    expect(res.status).toBe(400);
  });

  it("400s a malformed body", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/check-ins", { method: "DELETE", body: "{oops" }),
    );
    expect(res.status).toBe(400);
  });

  it("does not error when the caller has no active check-in (idempotent off)", async () => {
    const res = await DELETE(deleteBody({ handle: "reader" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/check-ins", () => {
  let ben: ProfileRecord;

  beforeEach(() => {
    ben = __seedMemoryOwnedProfile("ben", "user-ben");
    readAs(ben);
  });

  it("returns a mutual's check-in and the reader's own", async () => {
    __seedMemoryOwnedProfile("ana", "user-ana");
    await mutual("ben", "ana");
    await friendsCheckIn("ana");
    await friendsCheckIn("ben");
    expect(await readHandles()).toEqual(["ana", "ben"]);
  });

  it("does not return a non-mutual's check-in", async () => {
    __seedMemoryOwnedProfile("ana", "user-ana");
    await followStore().follow("ben", "ana");
    await friendsCheckIn("ana");
    await friendsCheckIn("stranger");
    expect(await readHandles()).toEqual([]);
  });

  it("hides a mutual across a block, whichever side made it", async () => {
    const ana = __seedMemoryOwnedProfile("ana", "user-ana");
    const cal = __seedMemoryOwnedProfile("cal", "user-cal");
    await mutual("ben", "ana");
    await mutual("ben", "cal");
    await friendsCheckIn("ana", { venueId: "venue-1vle947", note: "out" });
    await friendsCheckIn("cal");
    expect(await readHandles()).toEqual(["ana", "cal"]);

    setSocialMemoryBlock(ana.id, ben.id, true);
    setSocialMemoryBlock(ben.id, cal.id, true);
    expect(await readHandles()).toEqual([]);
  });

  it("shows nothing to a reader who is signed out, under the adult check, suspended or unverifiable", async () => {
    __seedMemoryOwnedProfile("ana", "user-ana");
    await mutual("ben", "ana");
    await friendsCheckIn("ana");

    for (const access of [
      signedOut,
      { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." },
      { ok: false, status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED", error: "Social access is suspended." },
      { ok: false, status: 503, code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social is not open yet.", retryable: true },
    ]) {
      routeState.access = access;
      expect(await readHandles()).toEqual([]);
      expect(await readHandles("/api/check-ins?viewer=ben")).toEqual([]);
    }
  });

  it("scope=area returns only area-public check-ins", async () => {
    await POST(postBody({ handle: "reader", areaSlug: "camden", visibility: "friends" }));
    await POST(postBody({ handle: "amy", areaSlug: "camden", visibility: "area" }));
    const res = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const data = (await res.json()) as { checkIns: { handle: string; visibility: string }[] };
    expect(data.checkIns.every((c) => c.visibility === "area")).toBe(true);
    expect(data.checkIns.map((c) => c.handle)).toContain("amy");
    expect(data.checkIns.map((c) => c.handle)).not.toContain("reader");
  });
});
