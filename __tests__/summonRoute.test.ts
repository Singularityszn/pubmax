import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Summon your mates: the route reaches only live mates with no block or mute
// either way, and each summon lands as a direct message with the pub attached.
// These run on the keyless memory stores, so the follow graph, the profiles,
// the blocks, the mutes and the inboxes are the real ones.

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
vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) =>
    id === PUB
      ? {
          status: "found",
          canonicalId: PUB,
          venue: { id: PUB, name: "The Lamb", kind: "pub" },
          slimVenue: { id: PUB, kind: "pub" },
        }
      : { status: "unknown", canonicalId: id },
}));

import { GET, POST } from "@/app/api/summon/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryMessages, messagesStore } from "@/lib/messagesStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import {
  clearSocialMemoryBlocks,
  setSocialMemoryBlock,
  setSocialMemoryMute,
} from "@/lib/socialBlockMemory";

const PUB = "summon-test-pub";
const ME = "summon_me_12";

let me: ReturnType<typeof __seedMemoryOwnedProfile>;

async function mate(handle: string) {
  const profile = __seedMemoryOwnedProfile(handle, `user-${handle}`);
  await followStore().follow(ME, handle);
  await followStore().follow(handle, ME);
  return profile;
}

async function mates(): Promise<string[]> {
  const response = await GET(new Request("http://localhost/api/summon"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  return ((await response.json()) as { mates: string[] }).mates;
}

function summon(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/api/summon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function inbox(handle: string) {
  const conversationId = await messagesStore().findConversation(ME, handle);
  if (!conversationId) return [];
  return (await messagesStore().listMessages(conversationId, handle)) ?? [];
}

beforeEach(() => {
  me = __seedMemoryOwnedProfile(ME, "user-me-12");
  routeState.access = { ok: true, actor: { accountId: "acct-me-12", profileId: me.id, handle: ME } };
  routeState.limited = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  __resetMemoryMessages();
  clearSocialMemoryBlocks();
});

describe("GET /api/summon", () => {
  it.each([
    ["GET", "mine"], ["GET", "theirs"],
    ["POST", "mine"], ["POST", "theirs"],
  ])("returns unavailable when a relationship read fails during %s (%s)", async (method, direction) => {
    await mate("summon_ann_12");
    const bo = await mate("summon_bo_12");
    const store = socialInteractionStore();
    const relationship = store.relationship.bind(store);
    vi.spyOn(store, "relationship").mockImplementation(async (actor, target) => {
      if (direction === "mine" ? target === bo.id : actor.profileId === bo.id) {
        throw new Error("Relationship unavailable");
      }
      return relationship(actor, target);
    });

    const response = method === "GET"
      ? await GET(new Request("http://localhost/api/summon"))
      : await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12", "summon_bo_12"] });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(await inbox("summon_ann_12")).toEqual([]);
    expect(await inbox("summon_bo_12")).toEqual([]);
  });

  it.each(["GET", "POST"])("preserves access recovery details during %s", async (method) => {
    for (const gate of ["onboarding_required", "adult_check_required", "adult_check_failed"]) {
      routeState.access = {
        ok: false,
        status: 403,
        code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
        error: "Adult verification is needed for Social.",
        gate,
      };
      const response = method === "GET"
        ? await GET(new Request("http://localhost/api/summon"))
        : await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
        details: { gate },
      });
    }
  });

  it("refuses a reader with no verified session, privately", async () => {
    routeState.access = { ok: false, error: "Sign in to use Social.", code: "SOCIAL_SIGN_IN_REQUIRED", status: 401 };
    const response = await GET(new Request("http://localhost/api/summon"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("lists mutual follows only, never a follower alone or a stranger", async () => {
    await mate("summon_bo_12");
    await mate("summon_ann_12");
    __seedMemoryOwnedProfile("summon_follower_12", "user-follower");
    await followStore().follow("summon_follower_12", ME);
    __seedMemoryOwnedProfile("summon_stranger_12", "user-stranger");

    expect(await mates()).toEqual(["summon_ann_12", "summon_bo_12"]);
  });

  it("leaves out a mate across a block or a mute, whichever side set it", async () => {
    const blockedByMe = await mate("summon_a_12");
    const blocksMe = await mate("summon_b_12");
    const mutedByMe = await mate("summon_c_12");
    const mutesMe = await mate("summon_d_12");
    await mate("summon_e_12");
    setSocialMemoryBlock(me.id, blockedByMe.id, true);
    setSocialMemoryBlock(blocksMe.id, me.id, true);
    setSocialMemoryMute(me.id, mutedByMe.id, true);
    setSocialMemoryMute(mutesMe.id, me.id, true);

    expect(await mates()).toEqual(["summon_e_12"]);
  });
});

describe("POST /api/summon", () => {
  it("sends each picked mate one message with the pub attached and the pub's own name", async () => {
    await mate("summon_ann_12");
    await mate("summon_bo_12");

    const response = await summon({
      venueId: PUB,
      time: "20:30",
      mates: ["summon_ann_12", "summon_bo_12"],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_ann_12", "summon_bo_12"], failed: [] });
    for (const handle of ["summon_ann_12", "summon_bo_12"]) {
      const messages = await inbox(handle);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        senderHandle: ME,
        body: "Come to The Lamb at 8:30pm?",
        attachment: { kind: "venue", venueId: PUB },
      });
    }
  });

  it("never reaches a muted, blocked or non-mutual handle, even when the request names it", async () => {
    await mate("summon_ann_12");
    const mutesMe = await mate("summon_mutes_12");
    const blocksMe = await mate("summon_blocks_12");
    __seedMemoryOwnedProfile("summon_stranger_12", "user-stranger");
    setSocialMemoryMute(mutesMe.id, me.id, true);
    setSocialMemoryBlock(blocksMe.id, me.id, true);

    const response = await summon({
      venueId: PUB,
      time: "19:00",
      mates: ["summon_ann_12", "summon_mutes_12", "summon_blocks_12", "summon_stranger_12"],
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sent: ["summon_ann_12"], failed: [] });
    expect(await inbox("summon_mutes_12")).toEqual([]);
    expect(await inbox("summon_blocks_12")).toEqual([]);
    expect(await inbox("summon_stranger_12")).toEqual([]);
  });

  it("refuses when nobody named can be summoned, and sends nothing", async () => {
    const mutedByMe = await mate("summon_ann_12");
    setSocialMemoryMute(me.id, mutedByMe.id, true);

    const response = await summon({ venueId: PUB, time: "19:00", mates: ["summon_ann_12"] });
    expect(response.status).toBe(400);
    expect(await inbox("summon_ann_12")).toEqual([]);
  });

  it("refuses a bad time, an unknown pub, no mates, and a sender over the limit", async () => {
    await mate("summon_ann_12");
    expect((await summon({ venueId: PUB, time: "25:00", mates: ["summon_ann_12"] })).status).toBe(400);
    expect((await summon({ venueId: PUB, time: "20:00", mates: [] })).status).toBe(400);
    expect((await summon({ venueId: "nowhere-pub", time: "20:00", mates: ["summon_ann_12"] })).status).toBe(404);
    routeState.limited = true;
    expect((await summon({ venueId: PUB, time: "20:00", mates: ["summon_ann_12"] })).status).toBe(429);
    expect(await inbox("summon_ann_12")).toEqual([]);
  });
});
