import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ supabaseServerConfig: () => null }));

import {
  broadcastMessageSent,
  broadcastMessagesRead,
  MESSAGES_BROADCAST_TIMEOUT_MS,
} from "@/lib/messagesBroadcast.server";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";

const config = { url: "https://example.supabase.co/", key: "service-key" };

function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status: 202 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("message broadcast (server half of the realtime lane)", () => {
  it("sends a payload-free signal to the thread and both inboxes through Realtime's HTTP endpoint", async () => {
    const { calls, fetchImpl } = capture();
    await expect(broadcastMessageSent("c1", ["ken", "sam"], { fetchImpl, config })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("apikey")).toBe("service-key");
    expect(headers.get("authorization")).toBe("Bearer service-key");
    const body = JSON.parse(String(calls[0].init.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages.map((m) => m.topic)).toEqual([
      messagesThreadTopic("c1"),
      messagesInboxTopic("ken"),
      messagesInboxTopic("sam"),
    ]);
    for (const message of body.messages) {
      expect(message.event).toBe("message");
      expect(message.payload).toEqual({});
      expect(message.private).toBe(false);
    }
  });

  it("names the read signal on the thread topic alone", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessagesRead("c1", { fetchImpl, config });
    const body = JSON.parse(String(calls[0].init.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toEqual([
      { topic: messagesThreadTopic("c1"), event: "read", payload: {}, private: false },
    ]);
  });

  it("sends nothing and answers false when keyless", async () => {
    const { calls, fetchImpl } = capture();
    await expect(broadcastMessageSent("c1", ["ken"], { fetchImpl, config: null })).resolves.toBe(false);
    await expect(broadcastMessageSent("c1", ["ken"], { fetchImpl })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("never throws: a refused or failed send is false, and the request is bounded", async () => {
    const refused = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(broadcastMessageSent("c1", ["ken"], { fetchImpl: refused, config })).resolves.toBe(false);

    const failing = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await expect(broadcastMessagesRead("c1", { fetchImpl: failing, config })).resolves.toBe(false);

    const { calls, fetchImpl } = capture();
    await broadcastMessagesRead("c1", { fetchImpl, config });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(MESSAGES_BROADCAST_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});
