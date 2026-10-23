import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A banned account keeps a signature-valid access token for the rest of its
 * hour. This drives the REAL bearer verification (lib/authServer.ts) with
 * GoTrue's two ban answers and proves that token buys nothing a stranger
 * lacks: no owner view of the withdrawn profile or its follow graph, and no
 * write. A suspended owner's live bearer is the control, so the refusal is
 * the ban and not a broken bearer path (week security review, fix PR 8).
 */

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const gotrue = vi.hoisted(() => ({
  getUser: async (token: string): Promise<{ data: { user: unknown }; error: unknown }> => {
    switch (token) {
      case "banned-error-token":
        return {
          data: { user: null },
          error: { status: 403, code: "user_banned", message: "User is banned" },
        };
      case "banned-until-token":
        return {
          data: { user: { id: "user-banned", banned_until: "2999-01-01T00:00:00.000Z" } },
          error: null,
        };
      case "suspended-token":
        return { data: { user: { id: "user-suspended" } }, error: null };
      default:
        return { data: { user: null }, error: { status: 401, code: "bad_jwt" } };
    }
  },
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    getSupabaseAdmin: () => ({ auth: { getUser: gotrue.getUser } }),
  };
});

import { POST as postFollow } from "@/app/api/profiles/[handle]/follow/route";
import { GET as getFollowers } from "@/app/api/profiles/[handle]/followers/route";
import { GET as getFollowing } from "@/app/api/profiles/[handle]/following/route";
import { GET as getLot } from "@/app/api/profiles/[handle]/lot/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[handle]/route";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, profileStore } from "@/lib/profileStore";

const UNKNOWN = "neverexisted_qa9";
const BAN_ANSWERS = [
  { answer: "a user_banned error", token: "banned-error-token" },
  { answer: "a future banned_until", token: "banned-until-token" },
] as const;

type Read = (request: Request, context: { params: Promise<{ handle: string }> }) => Promise<Response>;

const READS: ReadonlyArray<{ route: string; read: Read; path: string }> = [
  { route: "profile", read: getProfile, path: "" },
  { route: "lot", read: getLot, path: "/lot" },
  { route: "followers", read: getFollowers, path: "/followers" },
  { route: "following", read: getFollowing, path: "/following" },
];

function call(read: Read, handle: string, path: string, token?: string): Promise<Response> {
  return read(
    new Request(`http://localhost/api/profiles/${handle}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ handle }) },
  );
}

async function answered(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

function follow(target: string, follower: string, token?: string): Promise<Response> {
  return postFollow(
    new Request(`http://localhost/api/profiles/${target}/follow`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ follower }),
    }),
    { params: Promise.resolve({ handle: target }) },
  );
}

function rename(handle: string, token?: string): Promise<Response> {
  return patchProfile(
    new Request(`http://localhost/api/profiles/${handle}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ displayName: "Renamed While Banned" }),
    }),
    { params: Promise.resolve({ handle }) },
  );
}

beforeEach(async () => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();

  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  const banned = __seedMemoryOwnedProfile("bannedbob", "user-banned");
  __seedMemoryOwnedProfile("alice", "user-alice");
  __seedMemoryOwnedProfile("sam", "user-sam");

  const follows = followStore();
  for (const owner of ["suspendedbob", "bannedbob"]) {
    await follows.follow("alice", owner);
    await follows.follow(owner, "alice");
    await follows.follow(owner, "sam");
  }
  __setMemoryProfileWithdrawn(suspended.id, true);
  __setMemoryAuthUserBanned(banned.userId ?? "user-banned", true);
});

describe("a suspended owner's live bearer (control)", () => {
  it("still reads its own withdrawn profile and follow graph", async () => {
    const own = await answered(await call(getProfile, "suspendedbob", "", "suspended-token"));
    expect(own.body).toMatchObject({ profile: { handle: "suspendedbob" } });
    expect(await (await call(getLot, "suspendedbob", "/lot", "suspended-token")).json())
      .toEqual({ lot: ["alice"] });
  });
});

describe.each(BAN_ANSWERS)("a banned owner's bearer, when GoTrue answers $answer", ({ token }) => {
  it.each(READS)("reads its own $route like an unknown handle", async ({ read, path }) => {
    const unknown = await answered(await call(read, UNKNOWN, path));
    expect(await answered(await call(read, "bannedbob", path, token))).toEqual(unknown);
  });

  it("cannot follow anyone, and the refusal matches an anonymous one", async () => {
    const anonymous = await follow("sam", "bannedbob");
    const banned = await follow("sam", "bannedbob", token);
    expect(banned.status).toBe(anonymous.status);
    expect(banned.status).toBe(401);
    expect(await followStore().isFollowing("bannedbob", "sam")).toBe(true);
    expect(await followStore().isFollowing("bannedbob", "alice")).toBe(true);
    // A fresh edge is the proof: the banned bearer could not add one.
    await follow("suspendedbob", "bannedbob", token);
    expect(await followStore().isFollowing("bannedbob", "suspendedbob")).toBe(false);
  });

  it("cannot edit its own profile, and the refusal matches an anonymous one", async () => {
    const anonymous = await rename("bannedbob");
    const banned = await rename("bannedbob", token);
    expect(banned.status).toBe(anonymous.status);
    expect(banned.status).toBeGreaterThanOrEqual(400);
    expect((await profileStore().getByHandle("bannedbob"))?.displayName).not.toBe("Renamed While Banned");
  });
});
