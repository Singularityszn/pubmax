import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mates' activity on the Social Following lane: the route answers a verified
// reader with the pints their MUTUAL friends logged, newest first. These run on
// the keyless memory stores, so the follow graph, the profiles, the drops, the
// mutes and the blocks are the real ones.

const routeState = vi.hoisted(() => ({
  access: null as unknown,
  limited: false,
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: async () => routeState.access,
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => routeState.limited };
});

import { GET } from "@/app/api/social/mates-activity/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { MATES_ACTIVITY_LIMIT, type MatesActivityPint } from "@/lib/matesActivity";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
  setSocialMemoryMute,
} from "@/lib/socialBlockMemory";

const THE_LAMB = "venue-1yd70c7";
const ME = "mates_feed_me";

function drop(id: string, handle: string, createdAt: string, extra: Partial<PintDrop> = {}): PintDrop {
  return {
    id,
    venueId: THE_LAMB,
    handle,
    drink: "Guinness",
    priceGbp: 6.2,
    priceEvidence: "unchecked",
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt,
    ...extra,
  };
}

function seed(handle: string) {
  return __seedMemoryOwnedProfile(handle, `user-${handle}`);
}

async function mutual(handle: string) {
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
}

async function ask(): Promise<{ status: number; items: MatesActivityPint[] }> {
  const response = await GET(new Request("http://localhost/api/social/mates-activity"));
  const body = (await response.json()) as { items?: MatesActivityPint[] };
  return { status: response.status, items: body.items ?? [] };
}

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

beforeEach(() => {
  me = seed(ME);
  routeState.access = { ok: true, actor: { accountId: `user-${ME}`, profileId: me.id, handle: ME } };
  routeState.limited = false;
});

afterEach(() => {
  __resetPintDrops();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  clearSocialMemoryBlocks();
});

describe("GET /api/social/mates-activity", () => {
  it("refuses a reader with no verified session, privately", async () => {
    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    const response = await GET(new Request("http://localhost/api/social/mates-activity"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers a rate-limited reader with 429", async () => {
    routeState.limited = true;
    expect((await ask()).status).toBe(429);
  });

  it("shows only mutual friends' pints, newest first, with the pub and the price as logged", async () => {
    seed("mate_a");
    seed("mate_b");
    seed("one_way");
    seed("stranger");
    await mutual("mate_a");
    await mutual("mate_b");
    await followStore().follow(ME, "one_way");

    addPintDrop(drop("a-old", "mate_a", "2026-11-10T19:00:00.000Z"));
    addPintDrop(drop("b-new", "mate_b", "2026-11-11T20:00:00.000Z", { visibility: "friends", priceGbp: null, priceEvidence: undefined }));
    addPintDrop(drop("a-anon", "mate_a", "2026-11-11T21:00:00.000Z", { visibility: "anonymous" }));
    addPintDrop(drop("a-hidden", "mate_a", "2026-11-11T22:00:00.000Z", { status: "hidden" }));
    addPintDrop(drop("one-way", "one_way", "2026-11-11T22:00:00.000Z"));
    addPintDrop(drop("stranger", "stranger", "2026-11-11T22:00:00.000Z"));
    addPintDrop(drop("mine", ME, "2026-11-11T23:00:00.000Z"));

    const { status, items } = await ask();
    expect(status).toBe(200);
    expect(items.map((item) => item.id)).toEqual(["b-new", "a-old"]);
    expect(items[0]).toMatchObject({ handle: "mate_b", priceGbp: null, venueName: "The Lamb" });
    expect(items[0]).not.toHaveProperty("priceEvidence");
    expect(items[1]).toMatchObject({ handle: "mate_a", priceGbp: 6.2, priceEvidence: "unchecked", venueId: THE_LAMB });
    expect(items[1]?.venueMapUrl).toContain(THE_LAMB);
  });

  it("leaves out a mate the reader muted and a mate blocked either way", async () => {
    const muted = seed("muted_mate");
    const blocked = seed("blocked_mate");
    const blocker = seed("blocker_mate");
    seed("kept_mate");
    for (const handle of ["muted_mate", "blocked_mate", "blocker_mate", "kept_mate"]) await mutual(handle);
    setSocialMemoryMute(me.id, muted.id, true);
    setSocialMemoryBlock(me.id, blocked.id, true);
    setSocialMemoryBlock(blocker.id, me.id, true);
    for (const handle of ["muted_mate", "blocked_mate", "blocker_mate", "kept_mate"]) {
      addPintDrop(drop(`drop-${handle}`, handle, "2026-11-11T20:00:00.000Z"));
    }

    const { items } = await ask();
    expect(items.map((item) => item.handle)).toEqual(["kept_mate"]);
  });

  it("answers an empty list for a reader with no mates", async () => {
    seed("stranger");
    addPintDrop(drop("stranger", "stranger", "2026-11-11T22:00:00.000Z"));
    const { status, items } = await ask();
    expect(status).toBe(200);
    expect(items).toEqual([]);
  });

  it("caps the answer at the newest rows", async () => {
    seed("busy_mate");
    await mutual("busy_mate");
    for (let index = 0; index < MATES_ACTIVITY_LIMIT + 3; index += 1) {
      const minute = String(index).padStart(2, "0");
      addPintDrop(drop(`busy-${minute}`, "busy_mate", `2026-11-11T20:${minute}:00.000Z`));
    }
    const { items } = await ask();
    expect(items).toHaveLength(MATES_ACTIVITY_LIMIT);
    expect(items[0]?.id).toBe(`busy-${String(MATES_ACTIVITY_LIMIT + 2).padStart(2, "0")}`);
  });
});
