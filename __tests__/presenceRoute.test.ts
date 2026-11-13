import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "I'm here" presence is live location of a named person (launch plan P0 #2).
// GET /api/presence answers a real row only to that person's mates: a verified
// Social reader (signed in, a handle, the adult check passed) who is a mutual
// follow, with no block either way. These run on the keyless memory stores, so
// the presence rows, the follow graph, the profiles and the block list are the
// real ones; only the Social access gate is held, as the mates' prices route
// test holds it.

const routeState = vi.hoisted(() => ({ access: null as unknown }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/authServer", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/authServer")>(),
  callerUserId: async (request: Request) => request.headers.get("authorization") === "Bearer fixture-me" ? "user-me" : null,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintDrops")>(),
  isLimited: async () => false,
}));

import { GET, POST } from "@/app/api/presence/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import type { PresenceDTO } from "@/lib/presence";
import { presenceHandlesForViewer } from "@/lib/presenceAudience.server";
import { __resetPresence, markPresence, recentPresence } from "@/lib/presenceStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile, renameMemoryOwnedProfile } from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";

const VENUE = "venue-1vle947";
const ME = "presence_me_p0";

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

function signedIn(): void {
  routeState.access = { ok: true, actor: { accountId: "account-me", profileId: me.id, handle: ME }, authUserId: "user-me" };
}

async function mutual(handle: string): Promise<void> {
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
}

async function here(handle: string, venueId = VENUE): Promise<void> {
  await markPresence({ handle, venueId, actorHash: `actor-${handle}` });
}

/** The real (non-demo) handles the route answers. */
async function readHandles(path = "/api/presence"): Promise<string[]> {
  const response = await GET(new Request(`http://localhost${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await response.json()) as { presence: PresenceDTO[] };
  return body.presence.filter((row) => row.provenance !== "demo").map((row) => row.handle).sort();
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  me = __seedMemoryOwnedProfile(ME, "user-me");
  signedIn();
});

afterEach(() => {
  __resetPresence();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

describe("POST /api/presence identity", () => {
  async function checkIn(handle: string, venueId: string, ip: string, authenticated = true): Promise<void> {
    const response = await POST(new Request("http://localhost/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(authenticated ? { authorization: "Bearer fixture-me" } : {}) },
      body: JSON.stringify({ handle, venueId }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  }

  it("moves an owner between pubs after a network change", async () => {
    await checkIn(ME, VENUE, "192.0.2.1");
    await checkIn(ME, "venue-second", "198.51.100.1");
    expect((await recentPresence()).map(({ handle, venueId }) => ({ handle, venueId })))
      .toEqual([{ handle: ME, venueId: "venue-second" }]);
    expect(await recentPresence(VENUE)).toEqual([]);
  });

  it("keeps the account identity after a handle and network change", async () => {
    await checkIn(ME, VENUE, "192.0.2.1");
    renameMemoryOwnedProfile(me.id, "user-me", "presence_renamed_p0");
    await checkIn("presence_renamed_p0", "venue-second", "198.51.100.1");
    expect((await recentPresence()).map(({ handle, venueId }) => ({ handle, venueId })))
      .toEqual([{ handle: "presence_renamed_p0", venueId: "venue-second" }]);
  });

  it("replaces a legacy network-derived mark on the first new check-in", async () => {
    await markPresence({ handle: ME, venueId: VENUE, actorHash: "legacy-network-hash" });
    await checkIn(ME, "venue-second", "198.51.100.1");
    expect((await recentPresence()).map((row) => row.venueId)).toEqual(["venue-second"]);
  });

  it("moves an unlinked demo handle after a network change", async () => {
    await checkIn("demo_presence_p0", VENUE, "192.0.2.1", false);
    await checkIn("demo_presence_p0", "venue-second", "198.51.100.1", false);
    expect((await recentPresence()).map((row) => row.venueId)).toEqual(["venue-second"]);
  });
});

describe("GET /api/presence", () => {
  it("shows a signed-out reader nobody", async () => {
    __seedMemoryOwnedProfile("mate_ann_p0", "user-ann");
    await mutual("mate_ann_p0");
    await here("mate_ann_p0");
    routeState.access = { ok: false, status: 401, code: "SOCIAL_SIGN_IN_REQUIRED", error: "Sign in to use Social." };

    expect(await readHandles()).toEqual([]);
    expect(await readHandles(`/api/presence?venueId=${VENUE}`)).toEqual([]);
  });

  it("shows nobody to a reader who has not passed the adult check, or is suspended", async () => {
    __seedMemoryOwnedProfile("mate_ann_p0", "user-ann");
    await mutual("mate_ann_p0");
    await here("mate_ann_p0");

    routeState.access = { ok: false, status: 403, code: "SOCIAL_ADULT_VERIFICATION_REQUIRED", error: "Adult verification is needed for Social." };
    expect(await readHandles()).toEqual([]);
    routeState.access = { ok: false, status: 403, code: "SOCIAL_ACCOUNT_SUSPENDED", error: "Social access is suspended." };
    expect(await readHandles()).toEqual([]);
    routeState.access = { ok: false, status: 503, code: "SOCIAL_ACCESS_UNAVAILABLE", error: "Social is not open yet.", retryable: true };
    expect(await readHandles()).toEqual([]);
  });

  it("shows a verified reader their mates and themselves, and nobody else", async () => {
    for (const handle of ["mate_ann_p0", "follower_p0", "followee_p0", "stranger_p0"]) {
      __seedMemoryOwnedProfile(handle, `user-${handle}`);
    }
    await mutual("mate_ann_p0");
    await followStore().follow("follower_p0", ME);
    await followStore().follow(ME, "followee_p0");
    for (const handle of [ME, "mate_ann_p0", "follower_p0", "followee_p0", "stranger_p0", "nobody_p0"]) {
      await here(handle);
    }

    expect(await readHandles()).toEqual(["mate_ann_p0", ME].sort());
    expect(await readHandles(`/api/presence?venueId=${VENUE}`)).toEqual(["mate_ann_p0", ME].sort());
  });

  it("drops a mate across a block, whichever side made it", async () => {
    const ann = __seedMemoryOwnedProfile("mate_ann_p0", "user-ann");
    const bo = __seedMemoryOwnedProfile("mate_bo_p0", "user-bo");
    await mutual("mate_ann_p0");
    await mutual("mate_bo_p0");
    await here("mate_ann_p0");
    await here("mate_bo_p0");
    expect(await readHandles()).toEqual(["mate_ann_p0", "mate_bo_p0"]);

    setSocialMemoryBlock(me.id, ann.id, true);
    setSocialMemoryBlock(bo.id, me.id, true);
    expect(await readHandles()).toEqual([]);
  });

  it("drops a mutual whose profile is not linked to an account", async () => {
    // A handle with no owning account cannot pass the live-mate check.
    await mutual("unlinked_p0");
    await here("unlinked_p0");
    expect(await readHandles()).toEqual([]);
  });

  it.each(["/api/presence", `/api/presence?venueId=${VENUE}`])(
    "keeps older self and mate rows behind 45 newer strangers at %s",
    async (path) => {
      const now = Date.now();
      __seedMemoryOwnedProfile("mate_ann_p0", "user-ann");
      await mutual("mate_ann_p0");
      for (const handle of [ME, "mate_ann_p0"]) {
        await markPresence({ handle, venueId: VENUE, actorHash: handle }, now - 60_000);
      }
      for (let i = 0; i < 45; i += 1) {
        const handle = `stranger_${i}`;
        await markPresence({ handle, venueId: VENUE, actorHash: handle }, now - i);
      }

      expect(await readHandles(path)).toEqual(["mate_ann_p0", ME].sort());
    },
  );

  it("does not let blocked mutuals consume the audience limit", async () => {
    const now = Date.now();
    await markPresence({ handle: ME, venueId: VENUE, actorHash: ME }, now - 60_000);
    for (let i = 0; i < 45; i += 1) {
      const handle = `blocked_${i}`;
      const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
      await mutual(handle);
      setSocialMemoryBlock(me.id, profile.id, true);
      await markPresence({ handle, venueId: VENUE, actorHash: handle }, now - i);
    }
    expect(await readHandles()).toEqual([ME]);
  });
});

describe("presenceHandlesForViewer", () => {
  const viewer = { profileId: "profile-me", handle: ME };

  it("allows only self and verified mutual handles", async () => {
    const handles = await presenceHandlesForViewer(viewer, {
      listMutuals: async () => ["@Mate_Ann_p0"],
      isLiveMutual: async () => true,
    });
    expect(handles).toEqual([ME, "mate_ann_p0"]);
  });

  it("asks each mate's live check once, and fails closed when it throws", async () => {
    const isLiveMutual = vi.fn(async (_viewer: unknown, handle: string) => {
      if (handle === "mate_bo_p0") throw new Error("relationship store down");
      return true;
    });
    const handles = await presenceHandlesForViewer(
      viewer,
      { listMutuals: async () => ["mate_ann_p0", "@Mate_Ann_p0", "mate_bo_p0", ME], isLiveMutual },
    );
    expect(handles).toEqual([ME, "mate_ann_p0"]);
    expect(isLiveMutual).toHaveBeenCalledTimes(2);
  });

  it("keeps the viewer's own handle when there are no mutuals", async () => {
    const handles = await presenceHandlesForViewer(viewer, { listMutuals: async () => [] });
    expect(handles).toEqual([ME]);
  });
});
