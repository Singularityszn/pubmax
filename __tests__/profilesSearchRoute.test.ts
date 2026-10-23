// WP7 find-your-lot search: claimed + live handles only, public projection,
// rate-limited, publicApiError envelope. Never emails or private identity.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    clientIp: () => "203.0.113.9",
    hashIp: () => "a".repeat(64),
  };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async () => limitState.limited,
  };
});

const withdrawn = vi.hoisted(() => ({ handles: new Set<string>() }));
vi.mock("@/lib/accountPublicAccess.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountPublicAccess.server")>();
  return {
    ...actual,
    withdrawnHandles: async (handles: readonly string[]) =>
      new Set(handles.filter((handle) => withdrawn.handles.has(handle))),
  };
});

const searchState = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    handle: string;
    userId?: string;
    displayName?: string;
    tombstonedAt?: string;
    email?: string;
  }>,
}));

vi.mock("@/lib/profileStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileStore")>();
  return {
    ...actual,
    profileStore: () => ({
      searchClaimedByHandlePrefix: async () => searchState.rows,
    }),
    publicOwnedImageUrl: () => undefined,
    isProfileTombstoned: (profile: { tombstonedAt?: string } | null | undefined) =>
      typeof profile?.tombstonedAt === "string" && profile.tombstonedAt.length > 0,
  };
});

import { GET } from "@/app/api/profiles/search/route";
import { __resetMemoryFollows, memoryFollowStore } from "@/lib/followStore";

function search(q: string, viewer?: string): Promise<Response> {
  const viewerQuery = viewer ? `&viewer=${encodeURIComponent(viewer)}` : "";
  return GET(
    new Request(`http://localhost/api/profiles/search?q=${encodeURIComponent(q)}${viewerQuery}`),
  );
}

beforeEach(() => {
  limitState.limited = false;
  searchState.rows = [];
  withdrawn.handles.clear();
  __resetMemoryFollows();
});

describe("GET /api/profiles/search", () => {
  it("returns claimed prefix matches with public fields only", async () => {
    searchState.rows = [
      {
        id: "p1",
        handle: "samwise",
        userId: "user-sam",
        displayName: "Sam",
        email: "sam@example.com",
      },
      {
        id: "p2",
        handle: "samantha",
        // unclaimed - filtered out by the route
      },
    ];

    const res = await search("sam");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.matches).toEqual([
      { id: "p1", handle: "samwise", displayName: "Sam" },
    ]);
    const raw = JSON.stringify(body);
    for (const leak of [
      "userId",
      "user_id",
      "email",
      "dateOfBirth",
      "tombstoned",
      "avatarObjectKey",
      "user-sam",
      "sam@example.com",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("refuses a short prefix with publicApiError", async () => {
    const res = await search("s");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("rate-limits with the public envelope", async () => {
    limitState.limited = true;
    const res = await search("sam");
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("excludes tombstoned claimed handles", async () => {
    searchState.rows = [
      {
        id: "p1",
        handle: "samwise",
        userId: "user-sam",
        tombstonedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p2",
        handle: "samson",
        userId: "user-son",
      },
    ];

    const res = await search("sam");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.map((m: { handle: string }) => m.handle)).toEqual([
      "samson",
    ]);
  });
});

describe("GET /api/profiles/search with a viewer", () => {
  const rows = ["sammate", "samfollowing", "samfans", "samnone", "sam"].map((handle) => ({
    id: `p-${handle}`,
    handle,
    userId: `user-${handle}`,
  }));

  async function relations(viewer?: string): Promise<Record<string, unknown>> {
    const res = await search("sam", viewer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: Array<{ handle: string; relation?: unknown }> };
    return Object.fromEntries(body.matches.map((match) => [match.handle, match.relation]));
  }

  it("says where each match stands with the viewer, so a mate is not offered a Follow", async () => {
    searchState.rows = rows;
    await memoryFollowStore.follow("viewer", "sammate");
    await memoryFollowStore.follow("sammate", "viewer");
    await memoryFollowStore.follow("viewer", "samfollowing");
    await memoryFollowStore.follow("samfans", "viewer");

    expect(await relations("viewer")).toEqual({
      sammate: "mates",
      samfollowing: "following",
      samfans: "follows_you",
      samnone: "none",
      sam: "none",
    });
  });

  it("leaves the viewer's own row without a relation", async () => {
    searchState.rows = rows;
    expect((await relations("sam")).sam).toBeUndefined();
  });

  it("carries no relation when nobody is named", async () => {
    searchState.rows = rows;
    await memoryFollowStore.follow("viewer", "sammate");
    expect(Object.values(await relations())).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("answers a withdrawn viewer like one who never existed", async () => {
    searchState.rows = rows;
    await memoryFollowStore.follow("viewer", "sammate");
    withdrawn.handles.add("viewer");
    expect(Object.values(await relations("viewer")).every((relation) => relation === undefined)).toBe(true);
  });
});

describe("memory searchClaimedByHandlePrefix (claimed + live only)", () => {
  it("drops unclaimed and tombstoned rows at the store", async () => {
    // Import the real memory store outside the route mock path.
    const {
      memoryProfileStore,
      __resetMemoryProfiles,
      __tombstoneMemoryProfile,
    } = await vi.importActual<typeof import("@/lib/profileStore")>(
      "@/lib/profileStore",
    );
    __resetMemoryProfiles();
    await memoryProfileStore.createOwned("samwise", "user-sam");
    await memoryProfileStore.ensure("samantha");
    __tombstoneMemoryProfile("samwise");
    await memoryProfileStore.createOwned("samson", "user-son");
    const rows = await memoryProfileStore.searchClaimedByHandlePrefix("sam", 8);
    expect(rows.map((r) => r.handle)).toEqual(["samson"]);
  });
});
