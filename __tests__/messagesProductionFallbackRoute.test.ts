// Real message routes and store. Only external dependencies are fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", async (original) => ({
  ...(await original<typeof import("@/lib/serverEnv")>()),
  assertServerEnv: () => {},
}));
vi.mock("@/lib/supabase", async (original) => ({
  ...(await original<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => true,
  requireSupabaseAdmin: () => ({
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "is", "or", "order", "limit", "single", "maybeSingle", "insert", "upsert", "update"]) {
        query[method] = () => query;
      }
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: null,
        error: { message: `Could not find the table 'public.${table}' in the schema cache` },
      }).then(resolve);
      return query;
    },
  }),
}));
vi.mock("@/lib/messageAuth", () => ({
  requireLinkedActor: async () => ({ ok: true, handle: "ken", userId: "account-ken" }),
}));
vi.mock("@/lib/profileOwnership", () => ({
  gateHandleAction: async () => ({ allowed: true }),
}));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByHandle: async () => ({ handle: "sam", userId: "account-sam" }) }),
  isProfileTombstoned: () => false,
}));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/opsFreeze", () => ({ socialFreezeResponse: () => null }));
vi.mock("@/lib/messagesBroadcast.server", () => ({
  deferMessagesSignal: vi.fn(), broadcastMessageSent: vi.fn(), broadcastMessagesRead: vi.fn(),
}));
vi.mock("@/lib/messageVenueCards.server", () => ({ attachMessageVenueCards: async (rows: unknown[]) => rows }));

import { GET as inbox, POST as post } from "@/app/api/messages/route";
import { GET as thread, POST as postThread } from "@/app/api/messages/[id]/route";
import { __resetMemoryMessages, memoryMessagesStore } from "@/lib/messagesStore";
import { requiresSupabaseStore } from "@/lib/supabase";

const BASE = "http://localhost/api/messages";
function write(action: string) {
  return post(new Request(BASE, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, handle: "ken", other: "sam", body: "Meet at seven" }),
  }));
}
function read(id: string) {
  return thread(new Request(`${BASE}/${id}?handle=ken`), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("PUBMAX_E2E_KEYLESS", "0");
  vi.stubEnv("NEXT_PHASE", "");
  __resetMemoryMessages();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("production message durability", () => {
  it("refuses an open when the production schema is missing", async () => {
    expect(requiresSupabaseStore()).toBe(true);
    const response = await write("open");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(await memoryMessagesStore.listConversations("ken")).toEqual({ conversations: [], status: "ready" });
  });
  it("refuses a send instead of returning a process-memory message", async () => {
    const response = await write("send");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(await memoryMessagesStore.listMessages("c1", "ken")).toBeNull();
  });
  it("marks a schema-failed production inbox degraded", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    await memoryMessagesStore.send(id!, "ken", "Existing local message");
    const before = await memoryMessagesStore.listConversations("ken");
    const response = await inbox(new Request(`${BASE}?handle=ken`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversations: [], status: "degraded" });
    expect(await memoryMessagesStore.listConversations("ken")).toEqual(before);
  });
  it("does not append to an existing memory thread in production", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    const response = await postThread(new Request(`${BASE}/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", handle: "ken", body: "Do not lose this" }),
    }), { params: Promise.resolve({ id: id! }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND", error: "Conversation not found." });
    expect(await memoryMessagesStore.listMessages(id!, "ken")).toEqual([]);
  });
  it.each(["test", "production"])("preserves schema fallback in the %s keyless demo", async (mode) => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("PUBMAX_E2E_KEYLESS", "1");
    expect(requiresSupabaseStore()).toBe(false);
    const response = await write("send");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.conversationId).toBe("c1");
    expect(body.message.body).toBe("Meet at seven");
    expect((await (await read("c1")).json()).messages).toHaveLength(1);
  });
});
