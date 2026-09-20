// The messaging wave through its REAL doors: opening a group, leaving one,
// sending each new attachment kind, and answering a poll.
//
// The store's own rules are pinned in messageGroupThreads / messagePolls /
// messageAttachmentKinds. What is pinned HERE is the part only a route can
// answer: which refusal a caller gets, in which order the gates run, and that
// every member of a group ends up on the signal the send fires.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => limitState.limited };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return { ...actual, callerUserId: async () => authState.userId };
});

// Every signal the send path fires, so the topics a group names can be read.
const signals = vi.hoisted(() => ({ sent: [] as Array<{ id: string; handles: string[] }> }));
vi.mock("@/lib/messagesBroadcast.server", () => ({
  broadcastMessageSent: async (id: string, handles: readonly string[]) => {
    signals.sent.push({ id, handles: [...handles] });
    return true;
  },
  broadcastMessagesRead: async () => true,
  deferMessagesSignal: (run: () => Promise<unknown>) => {
    void run();
  },
}));

import { POST as POST_INBOX, GET as GET_INBOX } from "@/app/api/messages/route";
import { GET as GET_THREAD, POST as POST_THREAD } from "@/app/api/messages/[id]/route";
import { GROUP_MEMBER_FLOOR_LINE } from "@/lib/messageGroupThread";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

const BASE = "http://localhost/api/messages";
const PLAN_ID = "3f1d1ad0-1111-4111-8111-111111111111";

function asUser(userId: string): void {
  authState.userId = userId;
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
  return POST_THREAD(
    new Request(`${BASE}/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function getThread(id: string, handle: string): Promise<Response> {
  return GET_THREAD(new Request(`${BASE}/${id}?handle=${handle}`), {
    params: Promise.resolve({ id }),
  });
}

async function openGroup(
  participants: string[],
  title?: string,
): Promise<Response> {
  asUser("user-ken");
  return postInbox({ action: "open-group", handle: "ken", participants, ...(title ? { title } : {}) });
}

beforeEach(() => {
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetPintDrops();
  limitState.limited = false;
  signals.sent = [];
  for (const [handle, userId] of [
    ["ken", "user-ken"],
    ["sam", "user-sam"],
    ["jen", "user-jen"],
    ["ali", "user-ali"],
  ] as const) {
    __seedMemoryOwnedProfile(handle, userId);
  }
});

describe("opening a group", () => {
  it("mints one and puts it in every member's inbox", async () => {
    const res = await openGroup(["sam", "jen"], "Friday session");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { conversationId: string; members: string[] };
    expect(body.members).toEqual(["ken", "sam", "jen"]);

    asUser("user-jen");
    const inbox = await GET_INBOX(new Request(`${BASE}?handle=jen`));
    const listed = (await inbox.json()) as {
      conversations: Array<{ id: string; kind?: string; title?: string }>;
    };
    expect(listed.conversations[0]).toMatchObject({
      id: body.conversationId,
      kind: "group",
      title: "Friday session",
    });
  });

  it("refuses a list the caps would not admit, before a row is written", async () => {
    const small = await openGroup(["sam"]);
    expect(small.status).toBe(400);
    expect(((await small.json()) as { error: string }).error).toMatch(/at least three/i);
  });

  it("refuses a handle nobody holds, not just the first one", async () => {
    const res = await openGroup(["sam", "nobody"]);
    expect(res.status).toBe(404);
    // A group minted around a fabricated handle would name that person for ever.
    asUser("user-ken");
    const inbox = await GET_INBOX(new Request(`${BASE}?handle=ken`));
    expect(((await inbox.json()) as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it("refuses an unsigned caller", async () => {
    authState.userId = null;
    const res = await postInbox({
      action: "open-group",
      handle: "ken",
      participants: ["sam", "jen"],
    });
    expect(res.status).toBe(401);
  });
});

describe("a group thread carries every member on its signal", () => {
  it("names one topic per participant on a send", async () => {
    const opened = await openGroup(["sam", "jen"]);
    const { conversationId } = (await opened.json()) as { conversationId: string };
    asUser("user-jen");
    const sent = await postThread(conversationId, {
      action: "send",
      handle: "jen",
      body: "we on?",
    });
    expect(sent.status).toBe(201);
    expect(signals.sent.at(-1)?.handles.sort()).toEqual(["jen", "ken", "sam"]);
  });

  it("names the thread in the read, so a header can call it something", async () => {
    const opened = await openGroup(["sam", "jen"], "Friday");
    const { conversationId } = (await opened.json()) as { conversationId: string };
    asUser("user-sam");
    const read = await getThread(conversationId, "sam");
    const body = (await read.json()) as {
      conversation?: { kind: string; members: string[]; title?: string };
    };
    expect(body.conversation).toEqual({
      id: conversationId,
      kind: "group",
      members: ["ken", "sam", "jen"],
      title: "Friday",
    });
  });

  it("refuses a stranger the thread, exactly as a DM does", async () => {
    const opened = await openGroup(["sam", "jen"]);
    const { conversationId } = (await opened.json()) as { conversationId: string };
    __seedMemoryOwnedProfile("mallory", "user-mal");
    asUser("user-mal");
    const read = await getThread(conversationId, "mallory");
    expect(read.status).toBe(404);
  });
});

describe("leaving a group", () => {
  it("lets a member out and refuses at the floor", async () => {
    const opened = await openGroup(["sam", "jen", "ali"]);
    const { conversationId } = (await opened.json()) as { conversationId: string };

    asUser("user-ali");
    const left = await postThread(conversationId, { action: "leave", handle: "ali" });
    expect(left.status).toBe(200);
    // The way in is gone; the words stay.
    expect((await getThread(conversationId, "ali")).status).toBe(404);

    asUser("user-jen");
    const floored = await postThread(conversationId, { action: "leave", handle: "jen" });
    expect(floored.status).toBe(409);
    expect(((await floored.json()) as { error: string }).error).toBe(GROUP_MEMBER_FLOOR_LINE);
  });

  it("refuses to let anybody leave a DIRECT conversation", async () => {
    asUser("user-ken");
    const opened = await postInbox({ action: "open", handle: "ken", other: "sam" });
    const { conversationId } = (await opened.json()) as { conversationId: string };
    const res = await postThread(conversationId, { action: "leave", handle: "ken" });
    expect(res.status).toBe(404);
  });
});

describe("the three new attachment kinds, through the send door", () => {
  const openDirect = async (): Promise<string> => {
    asUser("user-ken");
    const opened = await postInbox({ action: "open", handle: "ken", other: "sam" });
    return ((await opened.json()) as { conversationId: string }).conversationId;
  };

  it("stores a contact as a handle and reads back a card", async () => {
    const id = await openDirect();
    const sent = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      contactHandle: "@Jen",
    });
    expect(sent.status).toBe(201);
    const body = (await sent.json()) as { message: { attachment: Record<string, unknown> } };
    expect(body.message.attachment).toMatchObject({ kind: "contact", handle: "jen" });
    expect(body.message.attachment.card).toMatchObject({ handle: "jen", profileUrl: "/u/jen" });
  });

  it("stores a plan as an id, and refuses anything that is not one", async () => {
    const id = await openDirect();
    const good = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      planId: PLAN_ID,
    });
    expect(good.status).toBe(201);
    const bad = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      planId: "plan-1",
    });
    expect(bad.status).toBe(400);
  });

  it("refuses a poll that is not a ballot", async () => {
    const id = await openDirect();
    for (const poll of [
      { question: "", options: ["a", "b"] },
      { question: "Where?", options: ["only one"] },
      { question: "Where?", options: ["same", "SAME"] },
      { question: "Where?", options: ["a", "b", "c", "d", "e", "f", "g"] },
    ]) {
      const res = await postThread(id, { action: "send", handle: "ken", body: "", poll });
      expect(res.status, JSON.stringify(poll)).toBe(400);
    }
  });

  it("refuses TWO attachments at once rather than picking one", async () => {
    const id = await openDirect();
    const res = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      contactHandle: "jen",
      planId: PLAN_ID,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/one attachment/i);
  });

  it("answers a poll, and refuses an option the ballot does not carry", async () => {
    const id = await openDirect();
    const sent = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      poll: { question: "Where first?", options: ["The Harp", "The Blackfriar"] },
    });
    const { message } = (await sent.json()) as { message: { id: string } };

    asUser("user-sam");
    const voted = await postThread(id, {
      action: "vote",
      handle: "sam",
      messageId: message.id,
      optionIndex: 1,
    });
    expect(voted.status).toBe(200);
    const body = (await voted.json()) as {
      poll: { totalVotes: number; viewerOptionIndex: number | null };
    };
    expect(body.poll.totalVotes).toBe(1);
    expect(body.poll.viewerOptionIndex).toBe(1);

    const outside = await postThread(id, {
      action: "vote",
      handle: "sam",
      messageId: message.id,
      optionIndex: 9,
    });
    expect(outside.status).toBe(404);
  });

  it("never names a voter back to the thread", async () => {
    const id = await openDirect();
    const sent = await postThread(id, {
      action: "send",
      handle: "ken",
      body: "",
      poll: { question: "Where first?", options: ["The Harp", "The Blackfriar"] },
    });
    const { message } = (await sent.json()) as { message: { id: string } };
    asUser("user-sam");
    await postThread(id, {
      action: "vote",
      handle: "sam",
      messageId: message.id,
      optionIndex: 0,
    });
    asUser("user-ken");
    const read = await getThread(id, "ken");
    const body = (await read.json()) as {
      messages: Array<{ attachment?: unknown }>;
    };
    const attachment = JSON.stringify(body.messages[0]?.attachment);
    expect(attachment).toContain("The Harp");
    // The count crosses; the person who cast it does not, even to the author.
    // `conversation.members` names the thread's own people and is a different
    // fact: it says who can read the poll, never who answered it.
    expect(attachment).toContain('"totalVotes":1');
    expect(attachment).toContain('"viewerOptionIndex":null');
    expect(attachment).not.toContain("sam");
    expect(attachment).not.toContain("voter");
  });
});
