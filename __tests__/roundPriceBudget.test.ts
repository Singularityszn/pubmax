import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The device budget a Round's drink lines pay before they may become community
// observations. supabase-js is mocked so the check_rate_limit RPC outcome is
// fully controllable offline (the house pattern — see rateLimitFailOpen.test).
//
// The case that matters most here is the OUTAGE: the durable limiter's own
// fallback tightens to a handful of calls, which one honest itemised round
// would exhaust on its fourth drink. This module must instead hand out a
// bounded allowance sized for one genuine round, and say so in the log.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

async function loadBudget() {
  vi.resetModules();
  return import("@/lib/roundPriceBudget");
}

function failOpenRecords(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call: unknown[]) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r != null && r.event === "rate_limit.fail_open");
}

beforeEach(() => {
  rpc.mockReset();
  process.env.SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  delete process.env.RATE_LIMIT_STRICT;
});

afterAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RATE_LIMIT_STRICT;
});

describe("chargeRoundPriceLines", () => {
  it("charges one durable unit per line while the limiter answers", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: false, error: null });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const verdict = await chargeRoundPriceLines("actor-a", 6);

    expect(verdict).toEqual({ allowed: true, mode: "durable" });
    expect(rpc).toHaveBeenCalledTimes(6);
    expect(failOpenRecords(logSpy)).toHaveLength(0);
    logSpy.mockRestore();
  });

  it("refuses on the limiter's own verdict, blaming nobody's outage", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: true, error: null });

    expect(await chargeRoundPriceLines("actor-b", 3)).toEqual({
      allowed: false,
      mode: "durable",
    });
  });

  it("hands out one genuine round's worth while the limiter is unreachable", async () => {
    const { chargeRoundPriceLines, ROUND_PRICE_WINDOW_MS } = await loadBudget();
    const { ROUND_SPEND_PRICE_LINE_MAX } = await import("@/lib/rounds");
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // A full itemised round lands rather than dying on its fourth drink.
    const first = await chargeRoundPriceLines("actor-c", ROUND_SPEND_PRICE_LINE_MAX);
    expect(first).toEqual({ allowed: true, mode: "degraded" });

    // ONE warn per turn, not one per line, so the log drain stays readable
    // during exactly the incident an operator is reading.
    const records = failOpenRecords(logSpy);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "warn",
      event: "rate_limit.fail_open",
      reason: "error",
      mode: "degraded",
      surface: "round.price_lines",
      effectiveLimit: ROUND_SPEND_PRICE_LINE_MAX,
      windowMs: ROUND_PRICE_WINDOW_MS,
      allowed: true,
    });

    // The allowance is one round, so a device cannot spray during the outage.
    const second = await chargeRoundPriceLines("actor-c", ROUND_SPEND_PRICE_LINE_MAX);
    expect(second).toEqual({ allowed: false, mode: "degraded" });
    expect(failOpenRecords(logSpy)).toHaveLength(2);

    // Another drinker's device still gets its own round.
    expect(await chargeRoundPriceLines("actor-d", ROUND_SPEND_PRICE_LINE_MAX)).toEqual({
      allowed: true,
      mode: "degraded",
    });
    logSpy.mockRestore();
  });

  it("refuses under RATE_LIMIT_STRICT rather than opening an allowance", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    process.env.RATE_LIMIT_STRICT = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(await chargeRoundPriceLines("actor-e", 2)).toEqual({
      allowed: false,
      mode: "degraded",
    });
    expect(failOpenRecords(logSpy)[0]).toMatchObject({ allowed: false, effectiveLimit: 0 });
    logSpy.mockRestore();
  });

  it("uses the local budget when there is no durable limiter to ask", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { chargeRoundPriceLines, ROUND_PRICE_ACTOR_LIMIT } = await loadBudget();

    expect(await chargeRoundPriceLines("actor-f", ROUND_PRICE_ACTOR_LIMIT)).toEqual({
      allowed: true,
      mode: "memory",
    });
    expect(await chargeRoundPriceLines("actor-f", 1)).toEqual({
      allowed: false,
      mode: "memory",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
