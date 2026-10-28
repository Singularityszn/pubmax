// A ceiling no header can widen (thermonuclear review P1-3), and a share of it
// no single address can exceed (audit finding
// lib/paidSpendBudget:lane-ceiling-single-shared-allocation).
//
// The route case at the bottom is the one the acceptance line names: 200
// requests carrying 200 DISTINCT `x-forwarded-for` values, which the per-address
// limiter can never refuse because each value is its own bucket, and which the
// deployment ceiling stops reaching the model the moment it is spent.

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { admitPaidSpend, paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { __resetPintDrops } from "@/lib/pintDrops";

const ROOT = process.cwd();

// The file that owns each lane's consumption. A paid route that stops calling
// the seam fails here rather than quietly spending again.
const LANE_OWNERS: Record<PaidSpendLane, string> = {
  ask: "app/api/ask/route.ts",
  heritage: "app/api/heritage/route.ts",
  "pub-pal-chat": "app/api/pub-pal/chat/route.ts",
  "pub-pal-voice": "app/api/pub-pal/voice-token/route.ts",
  "pub-list-import": "lib/pubListImport.server.ts",
  typesafe: "lib/ai/typesafe.server.ts",
};

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

describe("lane coverage", () => {
  it("has every paid lane consuming the ceiling in its own file", () => {
    for (const lane of PAID_SPEND_LANES) {
      const source = readFileSync(join(ROOT, LANE_OWNERS[lane]), "utf8");
      expect(
        source.includes(`paidSpendBudgetRefusal("${lane}"`) || source.includes(`admitPaidSpend("${lane}"`),
        LANE_OWNERS[lane],
      ).toBe(true);
    }
  });

  // Plan generation calls no paid model: its import closure holds no
  // OpenRouter, TypeSafe or ElevenLabs client, and its one provider
  // (OpenRouteService walking legs) spends its own fail-soft `ors-global`
  // budget. A lane there defended no spend and let one address switch the
  // planner off for everybody for a rolling day.
  it("charges no paid lane for plan generation", () => {
    expect(PAID_SPEND_LANES).not.toContain("plan-generate");
    const source = readFileSync(join(ROOT, "lib/planGeneration.server.ts"), "utf8");
    expect(source).not.toMatch(/paidSpendBudgetRefusal|admitPaidSpend/);
  });
});

describe("the address share", () => {
  it("is a twentieth of the lane, never under ten calls and never over the lane", () => {
    expect(paidSpendAddressShare(1_000)).toBe(50);
    expect(paidSpendAddressShare(5_000)).toBe(250);
    expect(paidSpendAddressShare(200)).toBe(10);
    expect(paidSpendAddressShare(30)).toBe(10);
    expect(paidSpendAddressShare(5)).toBe(5);
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
    // A ceiling of 30 gives each address a share of 10.
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_HERITAGE", "30");
    const admitted = async (address: string, calls: number) => {
      const answers: boolean[] = [];
      for (let call = 0; call < calls; call += 1) {
        answers.push(await admitPaidSpend("heritage", from(address)));
      }
      return answers.filter(Boolean).length;
    };

    // Address A is held to its share.
    expect(await admitted("203.0.113.10", 15)).toBe(10);
    // Address B is still admitted after A is refused.
    expect(await admitted("198.51.100.20", 10)).toBe(10);
    // A's five refused calls never reached the lane, so C gets its whole share
    // and the lane closes at exactly 30.
    expect(await admitted("192.0.2.30", 10)).toBe(10);
    expect(await admitted("192.0.2.31", 1)).toBe(0);
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
