// THE NUDGE IS NOT ON THE SEND'S CRITICAL PATH (F-26 / fix task 17).
//
// A send used to `await broadcastMessageSent(...)` before its 201, and on the
// thread route it first `await`ed `store.participants(...)` to name the two
// inbox topics - a round trip for a pair the write had just proved. With
// MESSAGES_BROADCAST_TIMEOUT_MS at 1.5 s, a degraded Realtime added that whole
// timeout to every message anybody sent.
//
// This file holds both halves at the handler: the response resolves while the
// broadcast is still in flight, and the conversation is never re-read to
// address the signal.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

// The broadcast is held open for the whole test: if the route awaited it, the
// handler promise would never settle and every case here would time out.
const signals = vi.hoisted(() => ({
  sent: [] as Array<{ conversationId: string; participants: readonly string[] }>,
  deferred: 0,
  settled: 0,
  release: [] as Array<() => void>,
}));
vi.mock("@/lib/messagesBroadcast.server", () => ({
  MESSAGES_BROADCAST_TIMEOUT_MS: 1_500,
  broadcastMessageSent: (conversationId: string, participants: readonly string[]) => {
    signals.sent.push({ conversationId, participants });
    return new Promise<boolean>((resolve) => {
      signals.release.push(() => {
        signals.settled += 1;
        resolve(true);
      });
    });
  },
  broadcastMessagesRead: () => new Promise<boolean>(() => {}),
  deferMessagesSignal: (run: () => Promise<unknown>) => {
    signals.deferred += 1;
    void run().catch(() => {});
  },
}));

// The real memory store, wrapped so `participants` can be counted.
const storeCalls = vi.hoisted(() => ({ participants: 0 }));
vi.mock("@/lib/messagesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messagesStore")>();
  return {
    ...actual,
    messagesStore: () => {
      const inner = actual.messagesStore();
      return {
        ...inner,
        membership: (conversationId: string) => {
          storeCalls.participants += 1;
          return inner.membership(conversationId);
        },
      };
    },
  };
});

import { POST as POST_INBOX } from "@/app/api/messages/route";
import { POST as POST_THREAD } from "@/app/api/messages/[id]/route";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";
import { defined } from "@/__tests__/helpers/defined";

const BASE = "http://localhost/api/messages";

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
    new Request(`${BASE}/${id}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = "user-ken";
  signals.sent = [];
  signals.deferred = 0;
  signals.settled = 0;
  signals.release = [];
  storeCalls.participants = 0;
  __resetMemoryMessages();
  __resetMemoryProfiles();
  __resetPintDrops();
  for (const handle of ["ken", "sam"]) __seedMemoryOwnedProfile(handle, `user-${handle}`);
});

describe("POST /api/messages - the inbox send", () => {
  it("answers 201 while the broadcast is still in flight", async () => {
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "Pint?" });

    expect(res.status).toBe(201);
    expect(signals.deferred).toBe(1);
    // The signal went out, and NOTHING waited for it to come back.
    expect(signals.sent).toHaveLength(1);
    expect(signals.settled).toBe(0);
  });

  it("names both participants from what the request already held", async () => {
    await postInbox({ action: "send", handle: "ken", other: "sam", body: "Pint?" });

    expect(defined(signals.sent[0]).participants).toEqual(["ken", "sam"]);
    expect(storeCalls.participants).toBe(0);
  });
});

describe("POST /api/messages/[id] - the thread send", () => {
  async function openConversation(): Promise<string> {
    const opened = await postInbox({ action: "open", handle: "ken", other: "sam" });
    const body = (await opened.json()) as { conversationId: string };
    signals.sent = [];
    signals.deferred = 0;
    storeCalls.participants = 0;
    return body.conversationId;
  }

  it("answers 201 while the broadcast is still in flight", async () => {
    const conversationId = await openConversation();

    const res = await postThread(conversationId, {
      action: "send",
      handle: "ken",
      body: "On my way",
    });

    expect(res.status).toBe(201);
    expect(signals.deferred).toBe(1);
    expect(signals.settled).toBe(0);
  });

  it("takes the pair from the WRITE, so the conversation is never re-read", async () => {
    const conversationId = await openConversation();

    await postThread(conversationId, { action: "send", handle: "ken", body: "On my way" });

    expect(storeCalls.participants).toBe(0);
    expect(defined(signals.sent[0]).conversationId).toBe(conversationId);
    expect([...defined(signals.sent[0]).participants].sort()).toEqual(["ken", "sam"]);
  });

  it("still sends the message when the signal cannot go out at all", async () => {
    const conversationId = await openConversation();

    const res = await postThread(conversationId, {
      action: "send",
      handle: "ken",
      body: "Realtime is down",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: { body: string } };
    expect(body.message.body).toBe("Realtime is down");
  });
});
