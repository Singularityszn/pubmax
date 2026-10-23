// A ceiling no header can widen (thermonuclear review P1-3).
//
// The route case at the bottom is the one the acceptance line names: 200
// requests carrying 200 DISTINCT `x-forwarded-for` values, which the per-address
// limiter can never refuse because each value is its own bucket, and which the
// deployment ceiling refuses the moment it is spent.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/ask/runAsk", () => ({
  runAsk: vi.fn(async () => ({ answer: "A quiet one.", citations: [], tools: [] })),
}));

import { POST as ASK_POST } from "@/app/api/ask/route";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_DEFAULT_DAILY_BUDGET,
  PAID_SPEND_LANES,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendBudgetEnvName,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { __resetPintDrops } from "@/lib/pintDrops";

const ROOT = process.cwd();

// The file that owns each lane's consumption. A paid route that stops calling
// the seam fails here rather than quietly spending again.
const LANE_OWNERS: Record<PaidSpendLane, string> = {
  ask: "app/api/ask/route.ts",
  heritage: "app/api/heritage/route.ts",
  "pub-pal-chat": "app/api/pub-pal/chat/route.ts",
  "pub-pal-voice": "app/api/pub-pal/voice-token/route.ts",
  "plan-generate": "lib/planGeneration.server.ts",
  typesafe: "lib/ai/typesafe.server.ts",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

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
      expect(source, LANE_OWNERS[lane]).toContain(`paidSpendBudgetRefusal("${lane}")`);
    }
  });
});

describe("POST /api/ask under a spent deployment ceiling", () => {
  const BUDGET = 5;
  const REQUESTS = 200;

  beforeEach(() => {
    // One budget per case: the in-memory limiter is module state, so without
    // this the second case starts with the first case's ceiling already spent.
    __resetPintDrops();
    // Keyless: no Supabase, so the shared limiter uses its in-memory budget.
    // That is the same code path a deployment takes through the durable RPC,
    // and it is what makes this a route test rather than a mock assertion.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENROUTER_API_KEY;
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_ASK", String(BUDGET));
  });

  it("refuses once the ceiling is spent, however many addresses the caller invents", async () => {
    const statuses: number[] = [];
    const codes: (string | undefined)[] = [];

    for (let index = 0; index < REQUESTS; index += 1) {
      // A distinct, well-formed address on every request. Under the old
      // reading this bought a fresh 10-per-minute budget each time.
      const address = `203.0.113.${index % 256}`;
      const suffix = Math.floor(index / 256);
      const response = await ASK_POST(
        new Request("http://localhost/api/ask", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": suffix ? `198.51.100.1, ${address}` : address,
          },
          body: JSON.stringify({ query: `Where is a quiet pint ${index}` }),
        }),
      );
      statuses.push(response.status);
      const body = (await response.json()) as { code?: string; error?: string };
      codes.push(body.code);
    }

    // The ceiling let exactly BUDGET calls through and then closed.
    expect(statuses.slice(0, BUDGET)).toEqual(Array(BUDGET).fill(200));
    expect(statuses.slice(BUDGET)).toEqual(Array(REQUESTS - BUDGET).fill(429));

    // Every refusal is the DEPLOYMENT ceiling, never the per-address limiter:
    // 200 distinct addresses is 200 distinct per-address buckets, so that
    // limiter refused nobody. This is the defect and the fix in one assertion.
    expect(new Set(codes.slice(BUDGET))).toEqual(new Set([PAID_SPEND_REFUSAL_CODE]));
    expect(codes).not.toContain("RATE_LIMITED");
  });

  it("answers the same sentence to every refused caller", async () => {
    for (let index = 0; index < BUDGET + 2; index += 1) {
      const response = await ASK_POST(
        new Request("http://localhost/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": `192.0.2.${index}` },
          body: JSON.stringify({ query: "Where is a quiet pint" }),
        }),
      );
      if (index < BUDGET) continue;
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        error: PAID_SPEND_REFUSAL_LINE,
        code: PAID_SPEND_REFUSAL_CODE,
        retryable: true,
      });
    }
  });
});
