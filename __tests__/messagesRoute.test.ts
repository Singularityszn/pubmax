import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for the messaging routes. Pin the in-memory store at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — NOT a NODE_ENV stub
// (Vite bakes that at transform time). Same house pattern as notificationsRoute.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { GET as GET_INBOX, POST as POST_INBOX } from "@/app/api/messages/route";
import {
  GET as GET_THREAD,
  POST as POST_THREAD,
} from "@/app/api/messages/[id]/route";
import { __resetMemoryMessages } from "@/lib/messagesStore";
import { memoryProfileStore, __resetMemoryProfiles } from "@/lib/profileStore";

const BASE = "http://localhost/api/messages";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function getInbox(query?: string, headers?: HeadersInit): Promise<Response> {
  return GET_INBOX(new Request(query ? `${BASE}?${query}` : BASE, { headers }));
}
function postInbox(body: unknown, headers?: HeadersInit): Promise<Response> {
  return POST_INBOX(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
function getThread(id: string, query?: string): Promise<Response> {
  const url = query ? `${BASE}/${id}?${query}` : `${BASE}/${id}`;
  return GET_THREAD(new Request(url), { params: Promise.resolve({ id }) });
}
function postThread(id: string, body: unknown): Promise<Response> {
  return POST_THREAD(new Request(`${BASE}/${id}`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.userId = null;
  __resetMemoryMessages();
  __resetMemoryProfiles();
});

describe("GET /api/messages — inbox", () => {
  it("returns an empty inbox for a missing handle (never 500)", async () => {
    const res = await getInbox();
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ conversations: [] });
  });
});

describe("POST /api/messages — open + send validation", () => {
  it("rejects a malformed body", async () => {
    const res = await POST_INBOX(new Request(BASE, { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing handle / recipient / self-message", async () => {
    expect((await postInbox({ action: "open", other: "sam" })).status).toBe(400);
    expect((await postInbox({ action: "open", handle: "ken" })).status).toBe(400);
    expect((await postInbox({ action: "open", handle: "ken", other: "ken" })).status).toBe(400);
  });

  it("opens a conversation and returns a stable id", async () => {
    const a = await (await postInbox({ action: "open", handle: "ken", other: "sam" })).json();
    const b = await (await postInbox({ action: "open", handle: "@Sam", other: "KEN" })).json();
    expect(a.conversationId).toBeTruthy();
    expect(a.conversationId).toBe(b.conversationId);
  });

  it("send opens-if-needed, stores the message (201), and rejects a blank body", async () => {
    const sent = await postInbox({ action: "send", handle: "ken", other: "sam", body: "hi sam" });
    expect(sent.status).toBe(201);
    expectNoStore(sent);
    const payload = await sent.json();
    expect(payload.message.body).toBe("hi sam");

    const blank = await postInbox({ action: "send", handle: "ken", other: "sam", body: "   " });
    expect(blank.status).toBe(400);
  });

  it("rejects an unknown action", async () => {
    expect((await postInbox({ action: "poke", handle: "ken", other: "sam" })).status).toBe(400);
  });
});

describe("GET /api/messages/[id] — participant gating (the leak test)", () => {
  async function seed(): Promise<string> {
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "secret" });
    return (await res.json()).conversationId;
  }

  it("serves the thread to a participant", async () => {
    const id = await seed();
    const res = await getThread(id, "handle=sam");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    expect(body.messages.map((m: { body: string }) => m.body)).toEqual(["secret"]);
  });

  it("returns 404 to a NON-participant — never leaks the thread", async () => {
    const id = await seed();
    const res = await getThread(id, "handle=mallory");
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).not.toHaveProperty("messages");
  });

  it("returns 404 for an unknown conversation and 400 for a missing handle", async () => {
    expect((await getThread("nope", "handle=ken")).status).toBe(404);
    expect((await getThread("nope")).status).toBe(400);
  });
});

describe("POST /api/messages/[id] — send + report gating", () => {
  async function seed(): Promise<string> {
    const res = await postInbox({ action: "send", handle: "ken", other: "sam", body: "hi" });
    return (await res.json()).conversationId;
  }

  it("lets a participant reply (201) but 404s a non-participant sender", async () => {
    const id = await seed();
    expect((await postThread(id, { action: "send", handle: "sam", body: "reply" })).status).toBe(
      201,
    );
    expect(
      (await postThread(id, { action: "send", handle: "mallory", body: "intrude" })).status,
    ).toBe(404);
  });

  it("lets a participant report a message; a non-participant gets 404", async () => {
    const id = await seed();
    const thread = await (await getThread(id, "handle=sam")).json();
    const messageId = thread.messages[0].id;

    const ok = await postThread(id, { action: "report", handle: "sam", messageId });
    expect(ok.status).toBe(200);
    expectNoStore(ok);
    expect((await ok.json()).flagged).toBe(true);

    const leak = await postThread(id, { action: "report", handle: "mallory", messageId });
    expect(leak.status).toBe(404);
  });

  it("does not let a participant flag a message from another conversation", async () => {
    const firstId = await seed();
    const second = await postInbox({
      action: "send",
      handle: "jen",
      other: "max",
      body: "private elsewhere",
    });
    const secondId = (await second.json()).conversationId;
    const secondThread = await (await getThread(secondId, "handle=max")).json();
    const foreignMessageId = secondThread.messages[0].id;

    const res = await postThread(firstId, {
      action: "report",
      handle: "sam",
      messageId: foreignMessageId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flagged: false });

    const stillUnflagged = await (await getThread(secondId, "handle=max")).json();
    expect(stillUnflagged.messages[0].flagged).toBe(false);
  });
});

describe("messages auth ownership — linked handle wins over body handle", () => {
  it("sends as the auth-linked handle, ignoring a spoofed body handle", async () => {
    await memoryProfileStore.linkUser("ken", "user-ken");
    authState.userId = "user-ken";

    const res = await postInbox({
      action: "send",
      handle: "mallory",
      other: "sam",
      body: "from ken",
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.message.senderHandle).toBe("ken");

    const inbox = await (await getInbox("handle=ignored")).json();
    expect(inbox.conversations.length).toBe(1);
    expect(inbox.conversations[0].otherHandle).toBe("sam");
  });

  it("keeps the anonymous demo path when auth is absent", async () => {
    authState.userId = null;
    const res = await postInbox({
      action: "send",
      handle: "demo",
      other: "sam",
      body: "anon hi",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).message.senderHandle).toBe("demo");
  });
});
