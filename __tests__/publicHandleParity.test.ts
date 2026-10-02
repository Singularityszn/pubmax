import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { GET as getFollowers } from "@/app/api/profiles/[handle]/followers/route";
import { GET as getFollowing } from "@/app/api/profiles/[handle]/following/route";
import { GET as getLot } from "@/app/api/profiles/[handle]/lot/route";
import { GET as getProfile } from "@/app/api/profiles/[handle]/route";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

const UNKNOWN = "neverexisted_qa9";

const subjects = [
  { kind: "unknown", handle: UNKNOWN },
  { kind: "withdrawn", handle: "suspendedbob" },
  { kind: "banned", handle: "bannedbob" },
] as const;

async function answered(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

function profile(handle: string): Promise<Response> {
  return getProfile(new Request(`http://localhost/api/profiles/${handle}`), {
    params: Promise.resolve({ handle }),
  });
}

function lot(handle: string): Promise<Response> {
  return getLot(new Request(`http://localhost/api/profiles/${handle}/lot`), {
    params: Promise.resolve({ handle }),
  });
}

function followers(handle: string): Promise<Response> {
  return getFollowers(new Request(`http://localhost/api/profiles/${handle}/followers`), {
    params: Promise.resolve({ handle }),
  });
}

function following(handle: string): Promise<Response> {
  return getFollowing(new Request(`http://localhost/api/profiles/${handle}/following`), {
    params: Promise.resolve({ handle }),
  });
}

beforeEach(async () => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();

  const suspended = __seedMemoryOwnedProfile("suspendedbob", "user-suspended");
  const banned = __seedMemoryOwnedProfile("bannedbob", "user-banned");
  __seedMemoryOwnedProfile("alice", "user-alice");
  __seedMemoryOwnedProfile("sam", "user-sam");
  __setMemoryProfileWithdrawn(suspended.id, true);
  __setMemoryAuthUserBanned(banned.userId ?? "user-banned", true);

  const follows = followStore();
  await follows.follow("alice", "suspendedbob");
  await follows.follow("suspendedbob", "alice");
  await follows.follow("alice", "bannedbob");
  await follows.follow("bannedbob", "alice");
  await follows.follow("alice", "sam");
  await follows.follow("sam", "alice");
  await follows.follow("suspendedbob", "sam");
  await follows.follow("bannedbob", "sam");
});

describe("public handle parity", () => {
  it.each(subjects)("$kind profile answers like an unknown handle", async ({ handle }) => {
    const unknown = await answered(await profile(UNKNOWN));
    const subject = await answered(await profile(handle));
    expect(subject).toEqual(unknown);
    expect(subject.status).toBe(200);
    expect(subject.body).toMatchObject({ profile: null, projection: "full" });
  });

  it.each(subjects)("$kind lot answers like an unknown handle", async ({ handle }) => {
    expect(await answered(await lot(handle))).toEqual(await answered(await lot(UNKNOWN)));
  });

  it.each(subjects)("$kind followers answers like an unknown handle", async ({ handle }) => {
    expect(await answered(await followers(handle))).toEqual(await answered(await followers(UNKNOWN)));
  });

  it.each(subjects)("$kind following answers like an unknown handle", async ({ handle }) => {
    expect(await answered(await following(handle))).toEqual(await answered(await following(UNKNOWN)));
  });

  it("omits a banned or withdrawn mutual from a live lot", async () => {
    const body = (await (await lot("alice")).json()) as { lot: string[] };
    expect(body.lot).toEqual(["sam"]);
  });
});
