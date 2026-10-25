import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAID_SPEND_LANES, paidSpendBudgetEnvName } from "@/lib/paidSpendBudget";

const database = vi.hoisted(() => ({
  hits: new Map<string, string[]>(),
  unavailable: false,
  readUnavailable: false,
  claimUnavailable: false,
  readWait: null as Promise<void> | null,
}));

// The database boundary stores the same rolling timestamp rows as the public RPC.
// Both app instances below share it, but do not share an alert sink.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (_name: string, args: { p_key: string; p_limit: number; p_window_ms: number }) => ({
      abortSignal: async () => {
        if (database.unavailable || (database.claimUnavailable && !args.p_key.startsWith("paid-spend:"))) {
          return { data: null, error: { message: "offline" } };
        }
        const now = Date.now();
        const live = (database.hits.get(args.p_key) ?? [])
          .filter((hit) => Date.parse(hit) > now - args.p_window_ms);
        const limited = live.length >= args.p_limit;
        if (!limited) live.push(new Date(now).toISOString());
        database.hits.set(args.p_key, live);
        return { data: limited, error: null };
      },
    }),
    from: () => ({
      select: () => ({
        eq: (_column: string, key: string) => ({
          abortSignal: () => ({
            maybeSingle: async () => {
              await database.readWait;
              return database.unavailable || database.readUnavailable
                ? { data: null, error: { message: "offline" } }
                : { data: { hits: database.hits.get(key) ?? [] }, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

const webhook = vi.fn(async () => new Response(null, { status: 204 }));

async function instance() {
  vi.resetModules();
  return import("@/lib/paidSpendBudget.server");
}

beforeEach(() => {
  database.hits.clear();
  database.unavailable = false;
  database.readUnavailable = false;
  database.claimUnavailable = false;
  database.readWait = null;
  webhook.mockClear();
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "10");
  vi.stubEnv("PUBMAX_ALERT_WEBHOOK_URL", "https://example.com/test-webhook");
  vi.stubGlobal("fetch", webhook);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seed(count: number, at = Date.now()) {
  database.hits.set("paid-spend:ask", Array(count).fill(new Date(at).toISOString()));
}

function messages(): string[] {
  return webhook.mock.calls.map((call) => {
    const [, init] = call as unknown as [string, RequestInit];
    return JSON.parse(String(init.body)).content as string;
  });
}

describe("paid request-cap warnings", () => {
  it("warns at 80 percent before the public limiter refuses a request", async () => {
    seed(7);
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(messages()).toEqual([
      expect.stringContaining("ask: 8/10 requests in the rolling 24-hour window (80% warning, 2 requests remaining)"),
    ]));
  });

  it.each(PAID_SPEND_LANES)("reports only system counts for the %s lane", async (lane) => {
    vi.stubEnv(paidSpendBudgetEnvName(lane), "10");
    database.hits.set(`paid-spend:${lane}`, Array(7).fill(new Date().toISOString()));
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal(lane)).toBeNull();
    await vi.waitFor(() => expect(messages()).toHaveLength(1));
    expect(messages()[0]).toMatch(new RegExp(`^\\[pubmax\\]\\[paid_spend\\.near_cap\\.${lane}\\.80\\]\\[deployment [^\\]]+\\] ${lane}: 8/10 requests in the rolling 24-hour window \\(80% warning, 2 requests remaining\\)$`));
  });

  it("escalates at 90 percent and retains the existing ceiling refusal", async () => {
    seed(8);
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(messages()).toHaveLength(1));
    expect(messages()[0]).toContain("9/10 requests in the rolling 24-hour window (90% warning, 1 request remaining)");
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    const refused = await paidSpendBudgetRefusal("ask");
    expect(refused?.status).toBe(429);
    expect(await refused?.json()).toMatchObject({ code: "DAILY_BUDGET_SPENT", retryable: true });
    expect(messages().filter((message) => message.includes("near_cap"))).toHaveLength(1);
  });

  it("sends no warning below 80 percent or for a closed lane", async () => {
    seed(6);
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "0");
    expect((await paidSpendBudgetRefusal("ask"))?.status).toBe(429);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(messages().filter((message) => message.includes("near_cap"))).toEqual([]);
  });

  it("uses the rolling day and excludes old timestamps across midnight", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T00:01:00Z"));
    seed(7, Date.parse("2026-10-19T23:59:00Z"));
    database.hits.get("paid-spend:ask")!.push(...Array(20).fill("2026-10-19T00:01:00Z"));
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(messages()[0]).toContain("8/10 requests"));
  });

  it("shares warning admission across concurrent instances and repeats after the cooldown", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "100");
    seed(79);
    const first = await instance();
    const second = await instance();
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? first : second).paidSpendBudgetRefusal("ask")));
    expect(outcomes).toEqual(Array(8).fill(null));
    await vi.waitFor(() => expect(messages()).toHaveLength(1));
    expect(messages()[0]).toContain("80% warning");
    now += 15 * 60 * 1000;
    const restarted = await instance();
    expect(await restarted.paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(messages()).toHaveLength(2));
    expect(messages()[1]).toContain("88/100 requests");
  });

  it.each(["readUnavailable", "claimUnavailable"] as const)(
    "preserves admission without an alert when %s", async (failure) => {
      seed(7);
      database[failure] = true;
      const { paidSpendBudgetRefusal } = await instance();
      expect(await paidSpendBudgetRefusal("ask")).toBeNull();
      // A second admission also drains the first call's monitoring microtasks.
      expect(await paidSpendBudgetRefusal("ask")).toBeNull();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(messages()).toEqual([]);
    },
  );

  it("continues to fail closed when the durable limiter is unavailable", async () => {
    database.unavailable = true;
    const { paidSpendBudgetRefusal } = await instance();
    expect((await paidSpendBudgetRefusal("ask"))?.status).toBe(429);
    expect(messages().filter((message) => message.includes("near_cap"))).toEqual([]);
  });

  it("emits no invented global warning in keyless development", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { paidSpendBudgetRefusal } = await instance();
    for (let request = 0; request < 9; request += 1) {
      expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    }
    expect(messages()).toEqual([]);
  });

  it("does not send or claim warnings when the webhook is unset", async () => {
    vi.stubEnv("PUBMAX_ALERT_WEBHOOK_URL", "");
    seed(7);
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    expect(messages()).toEqual([]);
    vi.stubEnv("PUBMAX_ALERT_WEBHOOK_URL", "https://example.com/test-webhook");
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(messages()[0]).toContain("90% warning"));
  });

  it("reports unknown durable usage separately from an empty rolling window", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { readRateLimitDurableUsage } = await import("@/lib/supabase");
    const read = () => readRateLimitDurableUsage("paid-spend:ask", 86_400_000, AbortSignal.timeout(2500));
    expect(await read()).toBe(0);
    database.hits.set("paid-spend:ask", [
      new Date(now - 86_400_000).toISOString(),
      new Date(now - 86_400_001).toISOString(),
      new Date(now - 86_399_999).toISOString(),
    ]);
    expect(await read()).toBe(1);
    database.readUnavailable = true;
    expect(await read()).toBeNull();
    database.readUnavailable = false;
    database.hits.set("paid-spend:ask", ["not-a-timestamp"]);
    expect(await read()).toBeNull();
  });

  it("does not hold admission behind the monitoring read", async () => {
    seed(7);
    let release!: () => void;
    database.readWait = new Promise<void>((resolve) => { release = resolve; });
    const { paidSpendBudgetRefusal } = await instance();
    try {
      expect(await paidSpendBudgetRefusal("ask")).toBeNull();
      expect(messages()).toEqual([]);
    } finally {
      release();
    }
    await vi.waitFor(() => expect(messages()[0]).toContain("80% warning"));
  });

  it("keeps admission unchanged when the webhook fails", async () => {
    seed(7);
    webhook.mockRejectedValueOnce(new Error("webhook offline"));
    const { paidSpendBudgetRefusal } = await instance();
    expect(await paidSpendBudgetRefusal("ask")).toBeNull();
    await vi.waitFor(() => expect(webhook).toHaveBeenCalledTimes(1));
  });
});
