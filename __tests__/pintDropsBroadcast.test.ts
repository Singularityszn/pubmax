import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ supabaseServerConfig: () => null }));

import {
  broadcastPintDropLanded,
  PINT_DROPS_BROADCAST_TIMEOUT_MS,
  signalPintDropLanded,
} from "@/lib/pintDropsBroadcast.server";
import { PINT_DROPS_LIVE_EVENT, PINT_DROPS_LIVE_TOPIC } from "@/lib/pintDropsTopics";
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

describe("pint drop broadcast", () => {
  it("sends one payload-free private signal on the pint drop topic", async () => {
    const { calls, fetchImpl } = capture();
    await expect(broadcastPintDropLanded({ fetchImpl, config })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(defined(calls[0]).url).toBe("https://example.supabase.co/realtime/v1/api/broadcast");
    const headers = new Headers(defined(calls[0]).init.headers);
    expect(headers.get("apikey")).toBe("service-key");
    expect(headers.get("authorization")).toBe("Bearer service-key");
    const body = JSON.parse(String(defined(calls[0]).init.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(body.messages).toEqual([
      {
        topic: PINT_DROPS_LIVE_TOPIC,
        event: PINT_DROPS_LIVE_EVENT,
        payload: {},
        private: true,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("handle");
  });

  it("sends nothing and answers false when keyless", async () => {
    const { calls, fetchImpl } = capture();
    await expect(broadcastPintDropLanded({ fetchImpl, config: null })).resolves.toBe(false);
    await expect(broadcastPintDropLanded({ fetchImpl })).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("never throws: a refused or failed send is false, and the request is bounded", async () => {
    const refused = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(broadcastPintDropLanded({ fetchImpl: refused, config })).resolves.toBe(false);

    const failing = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    await expect(broadcastPintDropLanded({ fetchImpl: failing, config })).resolves.toBe(false);

    const { calls, fetchImpl } = capture();
    await broadcastPintDropLanded({ fetchImpl, config });
    expect(defined(calls[0]).init.signal).toBeInstanceOf(AbortSignal);
    expect(PINT_DROPS_BROADCAST_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });

  it("the deferred signal does not throw when there is no request scope", () => {
    expect(() => signalPintDropLanded()).not.toThrow();
  });
});
