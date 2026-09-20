// The public profile read and write over the REAL stores, with the account
// privacy choice on. It walks the whole vertical: claim a handle, set the
// account private through the same route the editor spends, then read it back as
// its owner, as a mate, as a one-way follower and as a stranger.
//
// It is the route twin of `__tests__/profilesRoutePrivacy.test.ts`, which owns
// the private IDENTITY set (email, date of birth, gender, full name) and never
// moved: this suite is about the fields that are public BY CHOICE and about the
// choice itself.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { GET as getProfile, PATCH as patchProfile } from "@/app/api/profiles/[handle]/route";
import { followStore, __resetMemoryFollows } from "@/lib/followStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";

const OWNER_USER_ID = "user-owner";
const MATE_USER_ID = "user-mate";
const STRANGER_USER_ID = "user-stranger";

function patchRequest(handle: string, body: unknown): Request {
  return new Request(`http://localhost/api/profiles/${handle}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(handle: string, body: unknown): Promise<Response> {
  return patchProfile(patchRequest(handle, body), {
    params: Promise.resolve({ handle }),
  });
}

async function read(handle: string, viewer?: string): Promise<Response> {
  const query = viewer ? `?viewer=${viewer}` : "";
  return getProfile(new Request(`http://localhost/api/profiles/${handle}${query}`), {
    params: Promise.resolve({ handle }),
  });
}

type ReadBody = {
  projection?: string;
  profile?: Record<string, unknown> | null;
  socialLinks?: unknown[];
};

/** A claimed handle carrying every field a private account withholds. */
async function seedOwner(): Promise<void> {
  authState.userId = OWNER_USER_ID;
  await profileStore().createOwned("night_person", OWNER_USER_ID);
  const saved = await patch("night_person", {
    displayName: "Night Person",
    bio: "Withheld-bio-sentence",
    homeCity: "Camden",
    favouriteDrink: "Withheld-drink",
    interests: "Withheld-interests",
    workplace: "Withheld-workplace",
  });
  expect(saved.status).toBe(200);
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryProfiles();
  __resetMemoryFollows();
  __resetPintDrops();
});

describe("GET /api/profiles/[handle] \u2014 a public account", () => {
  it("answers the full card to a stranger and says which card it answered", async () => {
    await seedOwner();
    authState.userId = null;

    const body = (await (await read("night_person")).json()) as ReadBody;
    expect(body.projection).toBe("full");
    expect(body.profile?.visibility).toBe("public");
    expect(body.profile?.bio).toBe("Withheld-bio-sentence");
  });
});

describe("PATCH /api/profiles/[handle] \u2014 the choice", () => {
  it("saves private for the owner and reports it on the card", async () => {
    await seedOwner();

    const response = await patch("night_person", { visibility: "private" });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as { profile?: Record<string, unknown> };
    expect(saved.profile?.visibility).toBe("private");
    // The rest of the card is untouched: this is one field, not a wipe.
    expect(saved.profile?.bio).toBe("Withheld-bio-sentence");
  });

  it("refuses a word neither of us knows rather than guessing one", async () => {
    await seedOwner();

    const response = await patch("night_person", { visibility: "friends" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Choose public or private.");

    // Nothing moved: the refusal has no side effect.
    const stored = await profileStore().getByHandle("night_person");
    expect(stored?.visibility).toBe("public");
  });

  it("cannot be set by a different signed-in account", async () => {
    await seedOwner();
    authState.userId = STRANGER_USER_ID;

    const response = await patch("night_person", { visibility: "private" });
    expect(response.status).toBe(403);
    const stored = await profileStore().getByHandle("night_person");
    expect(stored?.visibility).toBe("public");
  });
});

describe("GET /api/profiles/[handle] \u2014 a private account", () => {
  async function seedPrivateOwner(): Promise<void> {
    await seedOwner();
    expect((await patch("night_person", { visibility: "private" })).status).toBe(200);
  }

  it("withholds every owner-authored field from an anonymous reader", async () => {
    await seedPrivateOwner();
    authState.userId = null;

    const response = await read("night_person");
    expect(response.status).toBe(200);
    const raw = await response.text();
    for (const leak of [
      "Withheld-bio-sentence",
      "Withheld-drink",
      "Withheld-interests",
      "Withheld-workplace",
      "Camden",
    ]) {
      expect(raw).not.toContain(leak);
    }
    const body = JSON.parse(raw) as ReadBody;
    expect(body.projection).toBe("limited");
    // The card is still recognisable: a friend has to know who they are adding.
    expect(body.profile?.handle).toBe("night_person");
    expect(body.profile?.displayName).toBe("Night Person");
    expect(body.profile?.visibility).toBe("private");
    expect(body.socialLinks).toEqual([]);
  });

  // `?viewer=` is the follow control's own convenience and is self-asserted, so
  // it may decide what a button says and never what a body carries.
  it("is not opened by a self-asserted ?viewer= naming the owner", async () => {
    await seedPrivateOwner();
    authState.userId = null;

    const body = (await (await read("night_person", "night_person")).json()) as ReadBody;
    expect(body.projection).toBe("limited");
    expect(body.profile?.bio).toBeUndefined();
  });

  it("answers the full card to its owner's bearer", async () => {
    await seedPrivateOwner();
    authState.userId = OWNER_USER_ID;

    const body = (await (await read("night_person")).json()) as ReadBody;
    expect(body.projection).toBe("full");
    expect(body.profile?.bio).toBe("Withheld-bio-sentence");
  });

  it("answers the full card to a mate and the limited card to a one-way follower", async () => {
    await seedPrivateOwner();

    authState.userId = MATE_USER_ID;
    await profileStore().createOwned("mate_handle", MATE_USER_ID);
    authState.userId = STRANGER_USER_ID;
    await profileStore().createOwned("follower_handle", STRANGER_USER_ID);

    const follows = followStore();
    await follows.follow("mate_handle", "night_person");
    await follows.follow("night_person", "mate_handle");
    await follows.follow("follower_handle", "night_person");

    authState.userId = MATE_USER_ID;
    const mate = (await (await read("night_person")).json()) as ReadBody;
    expect(mate.projection).toBe("full");
    expect(mate.profile?.workplace).toBe("Withheld-workplace");

    authState.userId = STRANGER_USER_ID;
    const follower = (await (await read("night_person")).json()) as ReadBody;
    expect(follower.projection).toBe("limited");
    expect(follower.profile?.workplace).toBeUndefined();
  });
});
