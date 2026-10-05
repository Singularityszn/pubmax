import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ supabaseServerConfig: () => null }));

import {
  broadcastMessageSent,
  broadcastMessagesRead,
  deferMessagesSignal,
  MESSAGES_BROADCAST_TIMEOUT_MS,
} from "@/lib/messagesBroadcast.server";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";
import { defined } from "@/__tests__/helpers/defined";

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
    expect(defined(calls[0]).url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    const headers = new Headers(defined(calls[0]).init.headers);
    expect(headers.get("apikey")).toBe("service-key");
    expect(headers.get("authorization")).toBe("Bearer service-key");
    const body = JSON.parse(String(defined(calls[0]).init.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages.map((m) => m.topic)).toEqual([
      messagesThreadTopic("c1"),
      messagesInboxTopic("ken"),
      messagesInboxTopic("sam"),
    ]);
    for (const message of body.messages) {
      expect(message.event).toBe("message");
      expect(message.payload).toEqual({});
      expect(message.private).toBe(true);
    }
  });

  it("names the read signal on the thread topic alone", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessagesRead("c1", { fetchImpl, config });
    const body = JSON.parse(String(defined(calls[0]).init.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toEqual([
      { topic: messagesThreadTopic("c1"), event: "read", payload: {}, private: true },
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
    expect(defined(calls[0]).init.signal).toBeInstanceOf(AbortSignal);
    expect(MESSAGES_BROADCAST_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-1 / fix task 32 - the topics a stranger could enumerate are PRIVATE.
//
// A public channel authorises on the API key alone, and handles are public and
// enumerable, so a public inbox topic pinged anybody holding the anon key the
// instant a named person sent or received a DM. Nothing here may go out public
// again, on any lane: the fence reads every message of every send.
// ─────────────────────────────────────────────────────────────────────────────
describe("no messaging signal is ever public", () => {
  it("marks the thread topic and BOTH inbox topics private on a send", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessageSent("c1", ["ken", "sam"], { fetchImpl, config });

    const body = JSON.parse(String(defined(calls[0]).init.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages.every((message) => message.private === true)).toBe(true);
    expect(body.messages.some((message) => message.private === false)).toBe(false);
  });

  it("marks the read signal private too", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessagesRead("c1", { fetchImpl, config });

    const body = JSON.parse(String(defined(calls[0]).init.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages.every((message) => message.private === true)).toBe(true);
  });

  it("still carries the SECRET key, which is what passes the policy 0148 installs", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessageSent("c1", ["ken"], { fetchImpl, config });

    const headers = new Headers(defined(calls[0]).init.headers);
    expect(headers.get("apikey")).toBe(config.key);
    expect(headers.get("authorization")).toBe(`Bearer ${config.key}`);
  });

  it("says nothing but that something happened - no handle, no id, no content", async () => {
    const { calls, fetchImpl } = capture();
    await broadcastMessageSent("c1", ["ken", "sam"], { fetchImpl, config });

    const body = JSON.parse(String(defined(calls[0]).init.body)) as {
      messages: Array<{ payload: unknown }>;
    };
    for (const message of body.messages) expect(message.payload).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-26 / fix task 17 - the nudge is handed to the platform, not to the reader.
// ─────────────────────────────────────────────────────────────────────────────
describe("deferMessagesSignal", () => {
  it("returns before the work it was given has finished", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;

    deferMessagesSignal(async () => {
      await gate;
      done = true;
    });

    // The caller is already past it; the response is not held behind the nudge.
    expect(done).toBe(false);
    release();
    await gate;
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("swallows a failed nudge rather than rejecting into the caller's request", async () => {
    expect(() =>
      deferMessagesSignal(async () => {
        throw new Error("realtime is down");
      }),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("runs the work even with no request scope for `after` to hang it on", async () => {
    let ran = false;
    deferMessagesSignal(async () => {
      ran = true;
    });
    await Promise.resolve();
    expect(ran).toBe(true);
  });
});
