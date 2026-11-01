import { beforeEach, describe, expect, it, vi } from "vitest";

// DMs respect blocks and the adult gate (launch review 2026-10-30, item 8).
// Same house pattern as messagesRoute: the in-memory stores, pinned at the
// @/lib/supabase seam, and the caller set through the authServer seam.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

import { POST as POST_INBOX } from "@/app/api/messages/route";
import { POST as POST_THREAD } from "@/app/api/messages/[id]/route";
import {
  __resetMemoryAdultSelfAssertions,
  memoryAdultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";
import { __resetMemoryFollows, memoryFollowStore } from "@/lib/followStore";
import { MESSAGE_BLOCKED_LINE, MESSAGE_MATES_ONLY_LINE } from "@/lib/messageSafety";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetMemoryPrivateIdentities,
  memoryPrivateIdentityStore,
} from "@/lib/privateIdentityStore";
import {
  __resetMemoryProfiles,
  __seedMemoryOwnedProfile,
  memoryProfileStore,
} from "@/lib/profileStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock } from "@/lib/socialBlockMemory";

const BASE = "http://localhost/api/messages";
const PEOPLE = ["ken", "sam", "max", "jen", "mallory"];

function asUser(handle: string): void {
  authState.userId = `user-${handle}`;
}

function postInbox(body: unknown): Promise<Response> {
  return POST_INBOX(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function postThread(id: string, body: unknown): Promise<Response> {
  return POST_THREAD(new Request(`${BASE}/${id}`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

async function profileId(handle: string): Promise<string> {
  const profile = await memoryProfileStore.getByHandle(handle);
  if (!profile) throw new Error(`no profile for ${handle}`);
  return profile.id;
}

async function block(blocker: string, blocked: string): Promise<void> {
  setSocialMemoryBlock(await profileId(blocker), await profileId(blocked), true);
}

async function openPair(from: string, to: string): Promise<string> {
  asUser(from);
  const res = await postInbox({ action: "open", handle: from, other: to });
  expect(res.status).toBe(200);
  return ((await res.json()) as { conversationId: string }).conversationId;
}

beforeEach(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetPintDrops();
  __resetMemoryAdultSelfAssertions();
  __resetMemoryPrivateIdentities();
  clearSocialMemoryBlocks();
  __resetMemoryFollows();
  for (const handle of PEOPLE) {
    __seedMemoryOwnedProfile(handle, `user-${handle}`);
    await memoryAdultSelfAssertionStore.record(`user-${handle}`);
  }
  // Everybody here starts as mates, so each block and adult test proves its
  // own door. The mates-only describe below takes edges away to prove that one.
  for (const from of PEOPLE) {
    for (const to of PEOPLE) {
      if (from !== to) await memoryFollowStore.follow(from, to);
    }
  }
});

describe("a block closes DMs both ways and names nobody", () => {
  it("refuses to open a conversation in either direction with one sentence", async () => {
    await block("ken", "sam");

    asUser("ken");
    const blocker = await postInbox({ action: "open", handle: "ken", other: "sam" });
    asUser("sam");
    const blocked = await postInbox({ action: "open", handle: "sam", other: "ken" });

    expect(blocker.status).toBe(403);
    expect(blocked.status).toBe(403);
    const blockerBody = await blocker.json();
    const blockedBody = await blocked.json();
    expect(blockerBody).toMatchObject({ error: MESSAGE_BLOCKED_LINE, code: "MESSAGE_BLOCKED" });
    // The two sides read the SAME body, so neither learns who set the block.
    expect(blockedBody).toEqual(blockerBody);
  });

  it("refuses a send that would open a conversation across a block", async () => {
    await block("sam", "ken");
    asUser("ken");
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "Pint?" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(MESSAGE_BLOCKED_LINE);
  });

  it("refuses a send into an existing direct thread after either side blocks", async () => {
    const conversationId = await openPair("ken", "sam");
    await block("sam", "ken");

    asUser("ken");
    const fromBlocked = await postThread(conversationId, { action: "send", handle: "ken", body: "Pint?" });
    asUser("sam");
    const fromBlocker = await postThread(conversationId, { action: "send", handle: "sam", body: "No" });

    expect(fromBlocked.status).toBe(403);
    expect(fromBlocker.status).toBe(403);
    expect(await fromBlocker.json()).toEqual(await fromBlocked.json());
  });

  it("answers an outsider the same 404 as before, never the block refusal", async () => {
    const conversationId = await openPair("ken", "sam");
    await block("sam", "ken");
    asUser("mallory");
    const res = await postThread(conversationId, { action: "send", handle: "mallory", body: "hi" });
    expect(res.status).toBe(404);
  });

  it("refuses a group when any two members have a block between them", async () => {
    // Neither of the blocked pair is the opener.
    await block("max", "jen");
    asUser("ken");
    const res = await postInbox({
      action: "open-group",
      handle: "ken",
      participants: ["sam", "max", "jen"],
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(MESSAGE_BLOCKED_LINE);
  });
});

describe("messaging asks the one adult gate", () => {
  it("refuses an account that has not answered, with the dialog's status", async () => {
    __resetMemoryAdultSelfAssertions();
    await memoryAdultSelfAssertionStore.record("user-sam");
    asUser("ken");
    const res = await postInbox({ action: "open", handle: "ken", other: "sam" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      status: "adult_check_required",
      code: "ADULT_REQUIRED",
    });
  });

  it("refuses a stored under-18 date of birth with no tap offered", async () => {
    await memoryPrivateIdentityStore.updateDetails("user-ken", { dateOfBirth: "2015-01-01" });
    asUser("ken");
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "hi" });
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe("adult_check_failed");
  });

  it("refuses a thread send from an account that has not answered", async () => {
    const conversationId = await openPair("ken", "sam");
    __resetMemoryAdultSelfAssertions();
    asUser("ken");
    const res = await postThread(conversationId, { action: "send", handle: "ken", body: "hi" });
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe("adult_check_required");
  });

  it("refuses opening a group from an account that has not answered", async () => {
    __resetMemoryAdultSelfAssertions();
    asUser("ken");
    const res = await postInbox({ action: "open-group", handle: "ken", participants: ["sam", "max"] });
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe("adult_check_required");
  });
});

describe("the happy path is unchanged", () => {
  it("opens, sends and replies between two adult mates with no block", async () => {
    const conversationId = await openPair("ken", "sam");
    asUser("ken");
    expect((await postThread(conversationId, { action: "send", handle: "ken", body: "Pint?" })).status).toBe(201);
    asUser("sam");
    expect((await postThread(conversationId, { action: "send", handle: "sam", body: "Go on" })).status).toBe(201);
    asUser("ken");
    const group = await postInbox({ action: "open-group", handle: "ken", participants: ["sam", "max"] });
    expect(group.status).toBe(201);
  });

  it("a block elsewhere does not touch an unrelated pair", async () => {
    await block("max", "jen");
    const conversationId = await openPair("ken", "sam");
    asUser("ken");
    expect((await postThread(conversationId, { action: "send", handle: "ken", body: "Pint?" })).status).toBe(201);
  });
});

describe("a new conversation needs mates until the age check is live", () => {
  it("refuses to open a conversation when the other side does not follow back", async () => {
    await memoryFollowStore.unfollow("sam", "ken");

    asUser("ken");
    const res = await postInbox({ action: "open", handle: "ken", other: "sam" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: MESSAGE_MATES_ONLY_LINE,
      code: "MESSAGE_MATES_ONLY",
    });
  });

  it("refuses a send-by-handle when only the recipient follows", async () => {
    await memoryFollowStore.unfollow("ken", "sam");

    asUser("ken");
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "Pint?" });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("MESSAGE_MATES_ONLY");
  });

  it("refuses a whole group when the opener is not mates with one member", async () => {
    await memoryFollowStore.unfollow("max", "ken");

    asUser("ken");
    const res = await postInbox({ action: "open-group", handle: "ken", participants: ["sam", "max"] });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(MESSAGE_MATES_ONLY_LINE);
  });

  it("lets a block answer first, so the refusal still names nobody", async () => {
    await memoryFollowStore.unfollow("sam", "ken");
    await block("sam", "ken");

    asUser("ken");
    const res = await postInbox({ action: "open", handle: "ken", other: "sam" });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(MESSAGE_BLOCKED_LINE);
  });

  it("refuses with a retryable 503 when the follow store cannot answer", async () => {
    vi.spyOn(memoryFollowStore, "edgesWith").mockRejectedValueOnce(new Error("down"));

    asUser("ken");
    const res = await postInbox({ action: "open", handle: "ken", other: "sam" });

    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
  });
});
