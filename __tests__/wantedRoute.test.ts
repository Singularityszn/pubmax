import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const contributionIdentityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "11111111-1111-4111-8111-111111111111",
    actor: "profile:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    handle: "alice",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => contributionIdentityState.resolution,
}));

vi.mock("@/lib/wantedResolve.server", () => ({
  resolveWantedPaste: async (paste: string) => {
    if (paste.toLowerCase().includes("dove")) {
      return {
        query: "Dove",
        sourceUrl: "",
        sourcePlatform: "none" as const,
        rawPaste: paste,
        status: "ready" as const,
        candidates: [
          {
            venueId: "venue-dove",
            venueName: "The Dove",
            venueKind: "curated" as const,
            address: "",
            contextLabel: "Hammersmith",
          },
        ],
      };
    }
    return {
      query: paste,
      sourceUrl: "",
      sourcePlatform: "none" as const,
      rawPaste: paste,
      status: "ready" as const,
      candidates: [],
    };
  },
}));

const crewReadState = vi.hoisted(() => ({
  value: { kind: "member" as "member" | "preview" },
}));

const mutualState = vi.hoisted(() => ({ handles: [] as string[] }));

vi.mock("@/lib/socialCrewStore", () => ({
  createSocialCrewStore: () => ({
    read: async () => crewReadState.value,
  }),
}));

vi.mock("@/lib/followStore", () => ({
  followStore: () => ({ listMutuals: async () => mutualState.handles }),
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByHandle: async (handle: string) => handle === "alice"
      ? { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", handle: "alice" }
      : null,
  }),
}));

import { GET, POST } from "@/app/api/wanted/route";
import { POST as resolvePOST } from "@/app/api/wanted/resolve/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetWanteds } from "@/lib/wantedStore";

function post(body: unknown, ip = "203.0.113.40"): Request {
  return new Request("http://localhost/api/wanted", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function get(qs = "", ip = "203.0.113.40"): Request {
  return new Request(`http://localhost/api/wanted${qs}`, {
    method: "GET",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  __resetWanteds();
  __resetPintDrops();
  contributionIdentityState.resolution = {
    ok: true,
    accountId: "11111111-1111-4111-8111-111111111111",
    actor: "profile:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    handle: "alice",
  };
  crewReadState.value = { kind: "member" };
  mutualState.handles = [];
});

afterEach(() => vi.restoreAllMocks());

describe("GET/POST /api/wanted", () => {
  it("requires auth for list", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const res = await GET(get());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("creates and lists a Wanted for the owner only", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
        sourceUrl: "https://www.instagram.com/reel/abc/",
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.wanted.venueName).toBe("The Dove");

    const listed = await GET(get());
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.wanteds).toHaveLength(1);

    contributionIdentityState.resolution = {
      ok: true,
      accountId: "acct-b",
      actor: "profile:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      handle: "bob",
    };
    const other = await GET(get());
    const otherBody = await other.json();
    expect(otherBody.wanteds).toHaveLength(0);
  });

  it("stores optional drink interest and explicit visibility", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
        drinkInterest: "beer",
        visibility: "mutuals",
      }),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.wanted.drinkInterest).toBe("beer");
    expect(body.wanted.visibility).toBe("mutuals");
  });

  it("returns mutual Wanteds only when relationship read confirms mutuality", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
        visibility: "mutuals",
      }),
    );
    expect(created.status).toBe(201);

    contributionIdentityState.resolution = {
      ok: true,
      accountId: "22222222-2222-4222-8222-222222222222",
      actor: "profile:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      handle: "bob",
    };
    const hidden = await GET(get("?scope=mutuals"));
    expect((await hidden.json()).wanteds).toHaveLength(0);

    mutualState.handles = ["alice"];
    const visible = await GET(get("?scope=mutuals"));
    expect((await visible.json()).wanteds).toHaveLength(1);
  });

  it("pushes an owned resolved Wanted into Soft Plan handoff", async () => {
    const created = await POST(
      post({ venueId: "venue-dove", venueName: "The Dove", venueKind: "curated" }),
    );
    const createdBody = await created.json();
    const res = await POST(post({ action: "soft-plan", id: createdBody.wanted.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.softPlan).toEqual({
      venueId: "venue-dove",
      query: "a night at The Dove",
    });
  });

  it("moves an owned Wanted into a verified Crew visibility lane", async () => {
    const created = await POST(
      post({ venueId: "venue-dove", venueName: "The Dove", venueKind: "curated" }),
    );
    const createdBody = await created.json();
    const res = await POST(post({
      action: "crew",
      id: createdBody.wanted.id,
      crewId: "22222222-2222-4222-8222-222222222222",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wanted.visibility).toBe("crew:22222222-2222-4222-8222-222222222222");
  });

  it("lets owner move a shared Wanted back to private", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
        visibility: "mutuals",
      }),
    );
    const createdBody = await created.json();
    const res = await POST(post({
      action: "visibility",
      id: createdBody.wanted.id,
      visibility: "private",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wanted.visibility).toBe("private");
  });

  it("does not let another account change a Wanted visibility", async () => {
    const created = await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
      }),
    );
    const createdBody = await created.json();
    contributionIdentityState.resolution = {
      ok: true,
      accountId: "22222222-2222-4222-8222-222222222222",
      actor: "profile:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      handle: "bob",
    };

    const res = await POST(post({
      action: "visibility",
      id: createdBody.wanted.id,
      visibility: "mutuals",
    }));
    expect(res.status).toBe(404);
  });

  it("does not move a Wanted into a Crew when caller is not a member", async () => {
    crewReadState.value = { kind: "preview" };
    const created = await POST(
      post({ venueId: "venue-dove", venueName: "The Dove", venueKind: "curated" }),
    );
    const createdBody = await created.json();
    const res = await POST(post({
      action: "crew",
      id: createdBody.wanted.id,
      crewId: "22222222-2222-4222-8222-222222222222",
    }));
    expect(res.status).toBe(403);
  });

  it("rate-limits creates", async () => {
    for (let i = 0; i < 20; i += 1) {
      await POST(
        post({
          venueId: `venue-${i}`,
          venueName: `Pub ${i}`,
          venueKind: "curated",
        }),
      );
    }
    const flooded = await POST(
      post({
        venueId: "venue-flood",
        venueName: "Flood",
        venueKind: "curated",
      }),
    );
    expect(flooded.status).toBe(429);
    const body = await flooded.json();
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("fulfils via action and returns envelope errors with publicApiError shape", async () => {
    await POST(
      post({
        venueId: "venue-dove",
        venueName: "The Dove",
        venueKind: "curated",
      }),
    );
    const fulfilled = await POST(post({ action: "fulfil", venueId: "venue-dove" }));
    expect(fulfilled.status).toBe(200);
    const body = await fulfilled.json();
    expect(body.fulfilled).toHaveLength(1);

    const bad = await POST(post({ action: "delete" }));
    expect(bad.status).toBe(404);
    const badBody = await bad.json();
    expect(badBody.code).toBe("NOT_FOUND");
    expect(badBody.error).toBeTruthy();
  });

  it("saves an unresolvable paste as pending", async () => {
    const res = await POST(
      post({
        action: "pending",
        rawPaste: "mystery riverside from a mate",
        sourceUrl: "https://www.tiktok.com/@x/video/1",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.wanted.venueKind).toBe("pending");
    expect(body.wanted.sourcePlatform).toBe("tiktok");
  });
});

describe("POST /api/wanted/resolve", () => {
  it("returns candidates for a known name", async () => {
    const res = await resolvePOST(
      new Request("http://localhost/api/wanted/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.41" },
        body: JSON.stringify({ paste: "The Dove" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates[0]?.venueId).toBe("venue-dove");
  });

  it("requires auth", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
    const res = await resolvePOST(
      new Request("http://localhost/api/wanted/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paste: "Dove" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
