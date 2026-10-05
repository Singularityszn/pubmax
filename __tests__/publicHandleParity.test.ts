import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const authState = vi.hoisted(() => ({ userId: null as string | null, lookups: 0 }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => {
      authState.lookups += 1;
      return authState.userId;
    },
  };
});

const withdrawalRead = vi.hoisted(() => ({ fails: false }));
vi.mock("@/lib/accountPublicAccess.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountPublicAccess.server")>();
  return {
    ...actual,
    withdrawnHandles: async (handles: readonly string[]) => {
      if (withdrawalRead.fails) throw new Error("withdrawal read unavailable");
      return actual.withdrawnHandles(handles);
    },
  };
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
import { GET as getDirectory } from "@/app/api/profiles/directory/route";
import { GET as getStarterPacks } from "@/app/api/starter-packs/route";
import {
  __resetMemoryProfileWithdrawals,
  __setMemoryAuthUserBanned,
  __setMemoryProfileWithdrawn,
} from "@/lib/accountPublicAccess.server";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryIdentityHandles } from "@/lib/identityHandleStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, profileStore } from "@/lib/profileStore";
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

function profile(handle: string, viewer?: string): Promise<Response> {
  const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : "";
  return getProfile(new Request(`http://localhost/api/profiles/${handle}${query}`), {
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
  authState.lookups = 0;
  withdrawalRead.fails = false;
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
  __setMemoryProfileWithdrawn(suspended.id, true);
  __setMemoryAuthUserBanned(banned.userId ?? "user-banned", true);
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

  it("still shows a suspended owner their own profile", async () => {
    authState.userId = "user-suspended";
    const body = (await (await profile("suspendedbob")).json()) as {
      profile: { handle: string } | null;
      projection: string;
    };
    expect(body.profile?.handle).toBe("suspendedbob");
    expect(body.projection).toBe("full");
  });

  it("answers another account's profile read for a suspended handle like an unknown handle", async () => {
    authState.userId = "user-sam";
    expect(await answered(await profile("suspendedbob"))).toEqual(await answered(await profile(UNKNOWN)));
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

  it.each(["suspendedbob", "bannedbob"])(
    "answers a %s viewer on a live profile like a viewer who never existed",
    async (handle) => {
      const unknown = await answered(await profile("alice", UNKNOWN));
      const withdrawn = await answered(await profile("alice", handle));
      const flags = (body: unknown) => {
        const card = body as { viewerFollowing?: boolean; followsViewer?: boolean };
        return { viewerFollowing: card.viewerFollowing, followsViewer: card.followsViewer };
      };
      expect(flags(unknown.body)).toEqual({ viewerFollowing: false, followsViewer: false });
      expect(flags(withdrawn.body)).toEqual(flags(unknown.body));
    },
  );

  it("still shows a suspended owner their own follow graph", async () => {
    authState.userId = "user-suspended";
    const ownFollowing = (await (await following("suspendedbob")).json()) as {
      following: { handle: string }[];
    };
    expect(ownFollowing.following.map((entry) => entry.handle).sort()).toEqual(["alice", "sam"]);
    const ownFollowers = (await (await followers("suspendedbob")).json()) as {
      followers: { handle: string }[];
    };
    expect(ownFollowers.followers.map((entry) => entry.handle)).toEqual(["alice"]);
    expect(await (await lot("suspendedbob")).json()).toEqual({ lot: ["alice"] });
  });

  it("answers another account's graph reads for a suspended handle like an unknown handle", async () => {
    authState.userId = "user-sam";
    expect(await answered(await following("suspendedbob"))).toEqual(await answered(await following(UNKNOWN)));
    expect(await answered(await followers("suspendedbob"))).toEqual(await answered(await followers(UNKNOWN)));
    expect(await answered(await lot("suspendedbob"))).toEqual(await answered(await lot(UNKNOWN)));
  });

  it("keeps other withdrawn mutuals out of a suspended owner's own lot", async () => {
    await followStore().follow("suspendedbob", "bannedbob");
    await followStore().follow("bannedbob", "suspendedbob");
    authState.userId = "user-suspended";
    expect(await (await lot("suspendedbob")).json()).toEqual({ lot: ["alice"] });
  });

  it("filters the directory for a suspended viewer like an unknown handle", async () => {
    const directory = (viewer: string) => get(getDirectory, `/api/profiles/directory?viewer=${viewer}`);
    expect(await answered(await directory("suspendedbob"))).toEqual(await answered(await directory(UNKNOWN)));
    authState.userId = "user-sam";
    expect(await answered(await directory("suspendedbob"))).toEqual(await answered(await directory(UNKNOWN)));
  });

  it("still filters the directory for a suspended owner by their own follows", async () => {
    authState.userId = "user-suspended";
    const body = (await (await get(getDirectory, "/api/profiles/directory?viewer=suspendedbob")).json()) as {
      people: { handle: string }[];
      alreadyFollowing: number;
    };
    expect(body.alreadyFollowing).toBe(2);
    expect(body.people.map((person) => person.handle)).not.toContain("alice");
    expect(body.people.map((person) => person.handle)).not.toContain("sam");
  });

  it("counts a suspended starter-pack viewer like an unknown handle, except for its owner", async () => {
    const viewerFollowing = async (viewer: string) =>
      ((await (await get(getStarterPacks, `/api/starter-packs?viewer=${viewer}`)).json()) as {
        viewerFollowing: number | null;
      }).viewerFollowing;
    expect(await viewerFollowing("suspendedbob")).toBe(await viewerFollowing(UNKNOWN));
    authState.userId = "user-suspended";
    expect(await viewerFollowing("suspendedbob")).toBe(2);
  });

  it("asks who the caller is on a graph read only when the handle is withdrawn", async () => {
    authState.userId = "user-sam";
    await following("alice");
    await followers("alice");
    await lot("alice");
    expect(authState.lookups).toBe(0);
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
  it("answers an anonymous write on a handle nobody owns with 404 and stores nothing", async () => {
    const result = await answered(await claimAnonymously(UNKNOWN));
    expect(result.status).toBe(404);
    expect(await profileStore().getByHandle(UNKNOWN)).toBeNull();
  });

  it.each(["suspendedbob", "bannedbob"])(
    "refuses a stranger's write on %s exactly like a write on a live owned handle",
    async (handle) => {
      const live = await answered(await claimAnonymously("alice"));
      expect(live.status).toBe(403);
      expect(await answered(await claimAnonymously(handle))).toEqual(live);
    },
  );

  it.each(["suspendedbob", "bannedbob"])(
    "refuses another account's write on %s exactly like a write on a live owned handle",
    async (handle) => {
      authState.userId = "user-sam";
      const live = await answered(await claimAnonymously("alice"));
      expect(live.status).toBe(403);
      expect(await answered(await claimAnonymously(handle))).toEqual(live);
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
  it("still shows a suspended owner their own saves and lists", async () => {
    authState.userId = "user-suspended";
    const saved = (await (await get(getSavedPubs, "/api/saved-pubs?handle=suspendedbob")).json()) as {
      saved: unknown[];
    };
    expect(saved.saved).toHaveLength(1);
    expect(await (await get(getSavedPubs, "/api/saved-pubs?handle=suspendedbob&lists=1")).json()).toEqual({
      lists: [LIST],
    });
  });

  it("asks who the caller is only when the handle is withdrawn", async () => {
    authState.userId = "user-alice";
    await get(getSavedPubs, "/api/saved-pubs?handle=sam");
    await get(getSavedPubs, "/api/saved-pubs?handle=sam&lists=1");
    expect(authState.lookups).toBe(0);
    await get(getSavedPubs, "/api/saved-pubs?handle=suspendedbob");
    expect(authState.lookups).toBe(1);
  });

  it("leaves list counts unknown when the withdrawal read fails", async () => {
    withdrawalRead.fails = true;
    const path = `/api/saved-pubs/list-follows?follower=alice&owner=sam&listType=${encodeURIComponent(LIST)}`;
    expect(await answered(await get(getListFollows, path))).toEqual({
      status: 200,
      body: { status: "unavailable", following: null, counts: { followers: null, savedPubs: null } },
    });
    expect(
      await answered(await get(getListFollows, "/api/saved-pubs/list-follows?follower=alice")),
    ).toEqual({ status: 200, body: { status: "unavailable", followedLists: null } });
    expect(JSON.stringify(await savedListMetadata(listParams("sam")))).not.toContain("0 followers");
  });

  it("still shows a suspended owner its own followed lists and list counts", async () => {
    authState.userId = "user-suspended";
    const followed = (await (
      await get(getListFollows, "/api/saved-pubs/list-follows?follower=suspendedbob")
    ).json()) as { followedLists: Array<{ ownerHandle: string }> };
    expect(followed.followedLists.map((list) => list.ownerHandle)).toEqual(["sam"]);
    const own = (await (
      await get(
        getListFollows,
        `/api/saved-pubs/list-follows?follower=suspendedbob&owner=suspendedbob&listType=${encodeURIComponent(LIST)}`,
      )
    ).json()) as { counts: { followers: number | null; savedPubs: number } };
    expect(own.counts).toEqual({ followers: 1, savedPubs: 1 });
    const following = (await (
      await get(
        getListFollows,
        `/api/saved-pubs/list-follows?follower=suspendedbob&owner=sam&listType=${encodeURIComponent(LIST)}`,
      )
    ).json()) as { following: boolean };
    expect(following.following).toBe(true);
  });

  it("answers another account's list-follow reads for a suspended handle like an unknown handle", async () => {
    authState.userId = "user-sam";
    const path = (follower: string, owner?: string) =>
      owner
        ? `/api/saved-pubs/list-follows?follower=${follower}&owner=${owner}&listType=${encodeURIComponent(LIST)}`
        : `/api/saved-pubs/list-follows?follower=${follower}`;
    expect(await answered(await get(getListFollows, path("suspendedbob")))).toEqual(
      await answered(await get(getListFollows, path(UNKNOWN))),
    );
    expect(await answered(await get(getListFollows, path("suspendedbob", "sam")))).toEqual(
      await answered(await get(getListFollows, path(UNKNOWN, "sam"))),
    );
    expect(await answered(await get(getListFollows, path("alice", "suspendedbob")))).toEqual(
      await answered(await get(getListFollows, path("alice", UNKNOWN))),
    );
  });

  it("hides a suspended owner's saves and lists from another account", async () => {
    authState.userId = "user-sam";
    expect(await answered(await get(getSavedPubs, "/api/saved-pubs?handle=suspendedbob"))).toEqual(
      await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${UNKNOWN}`)),
    );
    expect(await answered(await get(getSavedPubs, "/api/saved-pubs?handle=suspendedbob&lists=1"))).toEqual(
      await answered(await get(getSavedPubs, `/api/saved-pubs?handle=${UNKNOWN}&lists=1`)),
    );
  });

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
