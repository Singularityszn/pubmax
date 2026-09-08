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
import { __resetMemoryMessages, memoryMessagesStore, messagesStore, MessageReadUnavailableError } from "@/lib/messagesStore";
import { GET as photo } from "@/app/api/messages/[id]/photo/[messageId]/route";
import { __setMessagePhotoServeRouteDepsForTest } from "@/lib/messagePhotoServeRoute.server";
import { messagePhotoServingKey } from "@/lib/messageAttachments";
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
afterEach(() => {
  __setMessagePhotoServeRouteDepsForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
  it("refuses production reads of a memory thread without marking it read", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    await memoryMessagesStore.send(id!, "sam", "Local message only");
    const before = await memoryMessagesStore.listMessages(id!, "ken");
    expect(before?.[0].read).toBe(false);
    const response = await read(id!);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await memoryMessagesStore.listMessages(id!, "ken")).toEqual(before);
  });
  it("refuses production reports of a memory message without flagging it", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    const sent = await memoryMessagesStore.send(id!, "sam", "Local message only");
    const before = await memoryMessagesStore.listMessages(id!, "ken");
    const response = await postThread(new Request(`${BASE}/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report", messageId: sent!.message.id }),
    }), { params: Promise.resolve({ id: id! }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(await memoryMessagesStore.listMessages(id!, "ken")).toEqual(before);
  });
  it("keeps memory read markers, reports, and participants out of production", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    const sent = await memoryMessagesStore.send(id!, "sam", "Local message only");
    const before = await memoryMessagesStore.listMessages(id!, "ken");
    const store = messagesStore();
    expect(await store.markRead(id!, "ken")).toBe(0);
    expect(await store.report(id!, sent!.message.id, "ken")).toBe(false);
    expect(await store.participants(id!)).toBeNull();
    expect(await memoryMessagesStore.listMessages(id!, "ken")).toEqual(before);
  });
  it("refuses a memory photo before reading its storage object", async () => {
    const id = await memoryMessagesStore.openConversation("ken", "sam");
    const messageId = "photo1";
    const key = messagePhotoServingKey(id!, messageId);
    await memoryMessagesStore.send(id!, "sam", "", {
      kind: "photo", messageId, objectKey: key, width: 10, height: 10,
    });
    expect(await memoryMessagesStore.photoObjectKey(id!, messageId, "ken")).toBe(key);
    const downloadObject = vi.fn();
    __setMessagePhotoServeRouteDepsForTest({ downloadObject });
    const response = await photo(new Request(`${BASE}/${id}/photo/${messageId}?handle=ken`), {
      params: Promise.resolve({ id: id!, messageId }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(downloadObject).not.toHaveBeenCalled();
  });
  it.each(["listMessages", "markRead", "participants", "report", "photoObjectKey"] as const)(
    "never delegates a production schema failure to memory: %s", async (method) => {
      const fallback = vi.spyOn(memoryMessagesStore, method);
      const store = messagesStore();
      const id = "11111111-1111-4111-8111-111111111111";
      if (method === "listMessages") await expect(store.listMessages(id, "ken")).rejects.toBeInstanceOf(MessageReadUnavailableError);
      else if (method === "participants") await store.participants(id);
      else if (method === "report" || method === "photoObjectKey") await store[method](id, "m1", "ken");
      else await store[method](id, "ken");
      expect(fallback).not.toHaveBeenCalled();
    },
  );
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
