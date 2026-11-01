// A ceiling no header can widen (thermonuclear review P1-3), and a share of it
// no single address can exceed (audit finding
// lib/paidSpendBudget:lane-ceiling-single-shared-allocation).
//
// The route case at the bottom is the one the acceptance line names: 200
// requests carrying 200 DISTINCT `x-forwarded-for` values, which the per-address
// limiter can never refuse because each value is its own bucket, and which the
// deployment ceiling stops reaching the model the moment it is spent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/ask/runAsk", () => ({
  runAsk: vi.fn(async () => ({ answer: "A quiet one.", citations: [], tools: [] })),
}));

vi.mock("@/lib/heritage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/heritage")>();
  return {
    ...actual,
    answerHeritage: vi.fn(async () => ({ answer: "Here's what's on record.", citations: [] })),
  };
});

import { POST as ASK_POST } from "@/app/api/ask/route";
import { POST as HERITAGE_POST } from "@/app/api/heritage/route";
import { runAsk } from "@/lib/ask/runAsk";
import { answerHeritage } from "@/lib/heritage";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_DEFAULT_DAILY_BUDGET,
  PAID_SPEND_LANES,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendAddressKey,
  paidSpendAddressShare,
  paidSpendBudgetEnvName,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
} from "@/lib/paidSpendBudget";
import { admitPaidSpend, paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { __resetPintDrops } from "@/lib/pintDrops";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.mocked(runAsk).mockClear();
  vi.mocked(answerHeritage).mockClear();
});

/** A request from one caller address, read the way every paid route reads it. */
function from(address: string, url = "http://localhost/api/heritage"): Request {
  return new Request(url, { method: "POST", headers: { "x-real-ip": address } });
}

/** Keyless: no Supabase, so every limiter uses its in-memory budget. */
function keyless(): void {
  __resetPintDrops();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.OPENROUTER_API_KEY;
}

describe("the budget key", () => {
  it("names the lane and nothing a caller controls", () => {
    for (const lane of PAID_SPEND_LANES) {
      const key = paidSpendBudgetKey(lane);
      expect(key).toBe(`paid-spend:${lane}`);
      // No address, no account, no day stamp: anything here that varies per
      // caller would be a budget the caller chose, which is the whole defect.
      expect(key).not.toMatch(/[0-9a-f]{64}/);
      expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("gives every lane its own key, so one lane cannot starve another", () => {
    const keys = new Set(PAID_SPEND_LANES.map(paidSpendBudgetKey));
    expect(keys.size).toBe(PAID_SPEND_LANES.length);
  });

  it("covers a rolling day rather than a calendar one", () => {
    expect(PAID_SPEND_BUDGET_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("the ceiling", () => {
  it("ships a positive default for every lane", () => {
    for (const lane of PAID_SPEND_LANES) {
      expect(PAID_SPEND_DEFAULT_DAILY_BUDGET[lane]).toBeGreaterThan(0);
      expect(paidSpendDailyBudget(lane, {})).toBe(PAID_SPEND_DEFAULT_DAILY_BUDGET[lane]);
    }
  });

  it("is operable from the environment, and zero closes one lane", () => {
    expect(paidSpendBudgetEnvName("pub-pal-chat")).toBe("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT");
    expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: "25" })).toBe(25);
    expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: "0" })).toBe(0);
  });

  it("keeps the default when an override is not an instruction", () => {
    for (const raw of ["", "  ", "lots", "-1", "12.5", "1e3"]) {
      expect(paidSpendDailyBudget("ask", { PUBMAX_PAID_SPEND_BUDGET_ASK: raw }), raw).toBe(
        PAID_SPEND_DEFAULT_DAILY_BUDGET.ask,
      );
    }
  });
});

describe("the address share", () => {
  it("caps the preferred ten-call minimum at half the lane rounded up", () => {
    expect(paidSpendAddressShare(1_000)).toBe(50);
    expect(paidSpendAddressShare(5_000)).toBe(250);
    expect(paidSpendAddressShare(200)).toBe(10);
    expect(paidSpendAddressShare(30)).toBe(10);
    expect(paidSpendAddressShare(10)).toBe(5);
    expect(paidSpendAddressShare(5)).toBe(3);
    expect(paidSpendAddressShare(1)).toBe(1);
    expect(paidSpendAddressShare(0)).toBe(0);
  });

  it("is keyed on the lane and the hashed address, apart from the lane's own key", () => {
    const key = paidSpendAddressKey("ask", "a".repeat(64));
    expect(key).toBe(`paid-spend:ask:${"a".repeat(64)}`);
    for (const lane of PAID_SPEND_LANES) {
      expect(paidSpendAddressKey(lane, "a".repeat(64))).not.toBe(paidSpendBudgetKey(lane));
    }
  });

  it("refuses one address after its share while other addresses still spend the lane", async () => {
    keyless();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_HERITAGE", "10");
    for (let call = 0; call < 5; call += 1) {
      expect(await admitPaidSpend("heritage", from("203.0.113.10"))).toBe(true);
    }
    for (let call = 0; call < 5; call += 1) {
      expect(await admitPaidSpend("heritage", from("203.0.113.10"))).toBe(false);
    }
    for (let call = 0; call < 5; call += 1) {
      expect(await admitPaidSpend("heritage", from("198.51.100.20"))).toBe(true);
    }
    expect(await admitPaidSpend("heritage", from("192.0.2.30"))).toBe(false);
  });

  it("answers the same sentence to every refused caller", async () => {
    keyless();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_PAL_CHAT", "1");
    expect(await paidSpendBudgetRefusal("pub-pal-chat")).toBeNull();
    for (const address of ["203.0.113.1", "198.51.100.2"]) {
      const response = await paidSpendBudgetRefusal("pub-pal-chat", from(address));
      expect(response?.status).toBe(429);
      expect(await response?.json()).toEqual({
        error: PAID_SPEND_REFUSAL_LINE,
        code: PAID_SPEND_REFUSAL_CODE,
        retryable: true,
      });
    }
  });
});

function askFrom(headers: Record<string, string>, query = "Where is a quiet pint"): Promise<Response> {
  return ASK_POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ query }),
    }),
  );
}

/** Whether each `runAsk` call so far was allowed the model. */
function askModelCalls(): boolean[] {
  return vi.mocked(runAsk).mock.calls.map(([input]) => !input.skipModel);
}

describe("POST /api/ask under a spent deployment ceiling", () => {
  const BUDGET = 5;
  const REQUESTS = 200;

  beforeEach(() => {
    // One budget per case: the in-memory limiter is module state, so without
    // this the second case starts with the first case's ceiling already spent.
    // Keyless: no Supabase, so the shared limiter uses its in-memory budget.
    // That is the same code path a deployment takes through the durable RPC,
    // and it is what makes this a route test rather than a mock assertion.
    keyless();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", String(BUDGET));
  });

  it("withholds the model once the ceiling is spent, however many addresses the caller invents", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < REQUESTS; index += 1) {
      // A distinct, well-formed address on every request. Under the old
      // reading this bought a fresh 10-per-minute budget each time.
      const address = `203.0.113.${index % 256}`;
      const suffix = Math.floor(index / 256);
      const response = await askFrom(
        { "x-forwarded-for": suffix ? `198.51.100.1, ${address}` : address },
        `Where is a quiet pint ${index}`,
      );
      statuses.push(response.status);
    }

    // Every caller is answered: the deterministic tools still work, so a spent
    // ceiling withholds the paid model rather than refusing the question.
    expect(statuses).toEqual(Array(REQUESTS).fill(200));
    // The ceiling let exactly BUDGET calls reach the model and then closed.
    expect(askModelCalls()).toEqual([
      ...Array(BUDGET).fill(true),
      ...Array(REQUESTS - BUDGET).fill(false),
    ]);
  });
});

describe("POST /api/ask from one address", () => {
  it("withholds the model when the ask ceiling is zero", async () => {
    keyless();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "0");
    const response = await askFrom({ "x-real-ip": "203.0.113.10" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer: "A quiet one." });
    expect(askModelCalls()).toEqual([false]);
  });
  it("spends only that address's share, and another address still reaches the model", async () => {
    keyless();
    vi.useFakeTimers({ toFake: ["Date"] });
    // A ceiling of 400 gives each address a share of 20.
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", "400");
    for (let index = 0; index < 25; index += 1) {
      // Step past the 10-per-minute address limiter, which is not under test.
      if (index % 10 === 0) vi.setSystemTime(Date.now() + 61_000);
      expect((await askFrom({ "x-real-ip": "203.0.113.10" })).status).toBe(200);
    }
    expect(askModelCalls()).toEqual([...Array(20).fill(true), ...Array(5).fill(false)]);

    expect((await askFrom({ "x-real-ip": "198.51.100.20" })).status).toBe(200);
    expect(askModelCalls().at(-1)).toBe(true);
  });
});

describe("POST /api/heritage under a spent deployment ceiling", () => {
  it("answers from the grounded facts rather than refusing", async () => {
    keyless();
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_HERITAGE", "0");
    const response = await HERITAGE_POST(
      new Request("http://localhost/api/heritage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
        body: JSON.stringify({ venueName: "The Lamb", question: "How old is this pub?" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Here's what's on record.", citations: [] });
    expect(vi.mocked(answerHeritage).mock.calls.map(([input]) => input.skipModel)).toEqual([true]);
  });

  it("lets an admitted question reach the model", async () => {
    keyless();
    await HERITAGE_POST(
      new Request("http://localhost/api/heritage", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "203.0.113.11" },
        body: JSON.stringify({ venueName: "The Lamb", question: "How old is this pub?" }),
      }),
    );
    expect(vi.mocked(answerHeritage).mock.calls.map(([input]) => input.skipModel)).toEqual([false]);
  });
});
