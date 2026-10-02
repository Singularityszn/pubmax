import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { GET as getFollowers } from "@/app/api/profiles/[handle]/followers/route";
import { GET as getFollowing } from "@/app/api/profiles/[handle]/following/route";
import { GET as getLot } from "@/app/api/profiles/[handle]/lot/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[handle]/route";
import { POST as claimHandle } from "@/app/api/identity/handle/claim/route";
import ProfileHandleLayout from "@/app/u/[handle]/layout";
import ProfilePage, { generateMetadata } from "@/app/u/[handle]/page";
import SavedListPage, { generateMetadata as savedListMetadata } from "@/app/u/[handle]/lists/[listType]/page";
import { GET as getSavedPubs } from "@/app/api/saved-pubs/route";
import { GET as getListFollows } from "@/app/api/saved-pubs/list-follows/route";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import {
  __resetMemorySavedListFollows,
  __resetMemorySavedLists,
  __resetMemorySavedPubs,
  memorySavedListsStore,
  memorySavedPubsStore,
  savedListFollowsStore,
} from "@/lib/savedPubsStore";

const UNKNOWN = "neverexisted_qa9";
const LIST = "Date night";

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

function claimAnonymously(handle: string): Promise<Response> {
  return patchProfile(
    new Request(`http://localhost/api/profiles/${handle}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Night Owl" }),
    }),
    { params: Promise.resolve({ handle }) },
  );
}

function claimSignedIn(handle: string): Promise<Response> {
  return claimHandle(
    new Request("http://localhost/api/identity/handle/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    }),
  );
}

beforeEach(async () => {
  authState.userId = null;
  __resetMemoryIdentityHandles();
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryProfileWithdrawals();
  __resetMemorySavedPubs();
  __resetMemorySavedLists();
  __resetMemorySavedListFollows();

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

  for (const owner of ["suspendedbob", "bannedbob", "sam"]) {
    await memorySavedPubsStore.toggleSaved({ handle: owner, venueId: "venue-parity-1", listType: LIST });
    await memorySavedListsStore.createList(owner, LIST);
  }
  const listFollows = savedListFollowsStore();
  await listFollows.followList("alice", "suspendedbob", LIST);
  await listFollows.followList("alice", "bannedbob", LIST);
  await listFollows.followList("alice", "sam", LIST);
  await listFollows.followList("suspendedbob", "sam", LIST);
  await listFollows.followList("bannedbob", "sam", LIST);
});

function get(handler: (request: Request) => Promise<Response>, path: string): Promise<Response> {
  return handler(new Request(`http://localhost${path}`));
}

function listParams(handle: string) {
  return { params: Promise.resolve({ handle, listType: encodeURIComponent(LIST) }) };
}

function sameAsUnknown(value: unknown, handle: string): string {
  return JSON.stringify(value).replaceAll(handle, UNKNOWN);
}

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

describe("public profile page parity", () => {
  it.each(subjects)("$kind handle renders the same page shell as an unknown handle", async ({ handle }) => {
    await expect(
      ProfileHandleLayout({ params: Promise.resolve({ handle }), children: "profile" }),
    ).resolves.toBe("profile");
    const page = await ProfilePage({ params: Promise.resolve({ handle }) });
    const unknownPage = await ProfilePage({ params: Promise.resolve({ handle: UNKNOWN }) });
    expect(page.type).toBe(unknownPage.type);
  });

  it.each(subjects)("$kind handle publishes the same metadata as an unknown handle", async ({ handle }) => {
    const metadata = await generateMetadata({ params: Promise.resolve({ handle }) });
    const unknown = await generateMetadata({ params: Promise.resolve({ handle: UNKNOWN }) });
    expect(JSON.stringify(metadata).replaceAll(handle, UNKNOWN)).toBe(JSON.stringify(unknown));
  });
});

describe("handle claim parity", () => {
  it("lets a stranger claim a handle nobody owns", async () => {
    expect((await claimAnonymously(UNKNOWN)).status).toBe(200);
  });

  it.each(["suspendedbob", "bannedbob"])(
    "refuses a stranger's claim on %s with the generic unavailable answer",
    async (handle) => {
      expect(await answered(await claimAnonymously(handle))).toEqual({
        status: 409,
        body: { error: "That handle is not available.", code: "CONFLICT", retryable: false },
      });
    },
  );

  it.each(["suspendedbob", "bannedbob"])(
    "answers a signed-in claim on %s exactly like a claim on a live taken handle",
    async (handle) => {
      authState.userId = "user-claimant";
      const taken = await answered(await claimSignedIn("alice"));
      expect(taken.status).toBe(409);
      expect(await answered(await claimSignedIn(handle))).toEqual(taken);
    },
  );
});

describe("saved list parity", () => {
  it("still serves a live account's saved list", async () => {
    const body = (await (await get(getSavedPubs, "/api/saved-pubs?handle=sam")).json()) as {
      saved: unknown[];
    };
    expect(body.saved).toHaveLength(1);
  });

  it.each(subjects)("$kind saved pubs answer like an unknown handle", async ({ handle }) => {
    expect(await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${handle}`))).toEqual(
      await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${UNKNOWN}`)),
    );
  });

  it.each(subjects)("$kind custom lists answer like an unknown handle", async ({ handle }) => {
    expect(await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${handle}&lists=1`))).toEqual(
      await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${UNKNOWN}&lists=1`)),
    );
  });

  it.each(subjects)("$kind followed lists answer like an unknown handle", async ({ handle }) => {
    expect(await answered(await get(getListFollows, `/api/saved-pubs/list-follows?follower=${handle}`))).toEqual(
      await answered(await get(getListFollows, `/api/saved-pubs/list-follows?follower=${UNKNOWN}`)),
    );
  });

  it.each(subjects)("$kind list counts answer like an unknown handle", async ({ handle }) => {
    const path = (owner: string) =>
      `/api/saved-pubs/list-follows?follower=alice&owner=${owner}&listType=${encodeURIComponent(LIST)}`;
    expect(await answered(await get(getListFollows, path(handle)))).toEqual(
      await answered(await get(getListFollows, path(UNKNOWN))),
    );
  });

  it("omits a banned or withdrawn owner's list from a live follower's followed lists", async () => {
    const body = (await (await get(getListFollows, "/api/saved-pubs/list-follows?follower=alice")).json()) as {
      followedLists: Array<{ ownerHandle: string }>;
    };
    expect(body.followedLists.map((list) => list.ownerHandle)).toEqual(["sam"]);
  });

  it.each(subjects)("$kind list page renders like an unknown handle", async ({ handle }) => {
    expect(sameAsUnknown(await SavedListPage(listParams(handle)), handle)).toBe(
      JSON.stringify(await SavedListPage(listParams(UNKNOWN))),
    );
    expect(sameAsUnknown(await savedListMetadata(listParams(handle)), handle)).toBe(
      JSON.stringify(await savedListMetadata(listParams(UNKNOWN))),
    );
  });
});
