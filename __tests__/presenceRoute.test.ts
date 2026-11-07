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

import { GET } from "@/app/api/presence/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import type { PresenceDTO } from "@/lib/presence";
import { presenceVisibleToViewer } from "@/lib/presenceAudience.server";
import { __resetPresence, markPresence } from "@/lib/presenceStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
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
});

describe("presenceVisibleToViewer", () => {
  const viewer = { profileId: "profile-me", handle: ME };
  const row = (handle: string, extra: Partial<PresenceDTO> = {}): PresenceDTO => ({
    handle,
    venueId: VENUE,
    venueName: "The Sir Christopher Hatton",
    venueMapUrl: `/map?sel=${VENUE}`,
    at: "2026-11-07T19:00:00.000Z",
    ...extra,
  });

  it("keeps seeded demo rows, which name nobody real, and keeps order", async () => {
    const rows = [row("demo_one", { provenance: "demo" }), row("mate_ann_p0"), row("stranger_p0")];
    const visible = await presenceVisibleToViewer(viewer, rows, {
      listMutuals: async () => ["@Mate_Ann_p0"],
      isLiveMutual: async () => true,
    });
    expect(visible.map((entry) => entry.handle)).toEqual(["demo_one", "mate_ann_p0"]);
  });

  it("asks each mate's live check once, and fails closed when it throws", async () => {
    const isLiveMutual = vi.fn(async (_viewer: unknown, handle: string) => {
      if (handle === "mate_bo_p0") throw new Error("relationship store down");
      return true;
    });
    const visible = await presenceVisibleToViewer(
      viewer,
      [row("mate_ann_p0"), row("mate_ann_p0", { venueId: "venue-other" }), row("mate_bo_p0")],
      { listMutuals: async () => ["mate_ann_p0", "mate_bo_p0"], isLiveMutual },
    );
    expect(visible.map((entry) => entry.handle)).toEqual(["mate_ann_p0", "mate_ann_p0"]);
    expect(isLiveMutual).toHaveBeenCalledTimes(2);
  });

  it("does not read the follow graph when the only rows are the viewer's own", async () => {
    const listMutuals = vi.fn(async () => []);
    const visible = await presenceVisibleToViewer(viewer, [row(ME)], { listMutuals });
    expect(visible.map((entry) => entry.handle)).toEqual([ME]);
    expect(listMutuals).not.toHaveBeenCalled();
  });
});
