import { afterEach, describe, expect, it, vi } from "vitest";

import { anyToolMatchesCase, firstToolMatchesCase } from "@/evals/askRouterModel/grade";
import { loadAskRouterModelEvalCases } from "@/evals/askRouterModel/loadCases";
import routerCases from "@/__tests__/fixtures/typesafe/ask-router-cases.json";
import { runAskRouterModelEval } from "@/evals/askRouterModel/runEval";
import { routeAskDeterministically } from "@/lib/ask/router";

function toolReply(tools: string[], cost?: number): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: tools.map((name, index) => ({
              id: `call-${index}`,
              type: "function",
              function: { name, arguments: "{}" },
            })),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function userQuery(init: RequestInit | undefined): string {
  const body = JSON.parse(String(init?.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  return body.messages.at(-1)!.content;
}

describe("ask router model eval harness", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads gold router fixtures plus Pal routing cases", () => {
    const goldRouter = (routerCases.cases as Array<{ gold?: boolean }>).filter(
      (row) => row.gold,
    ).length;
    const cases = loadAskRouterModelEvalCases();
    expect(cases.length).toBeGreaterThanOrEqual(goldRouter);
    expect(cases.some((row) => row.source === "pal-routing")).toBe(true);
  });

  it("keeps deterministic gold labels aligned with routeAskDeterministically", () => {
    const cases = loadAskRouterModelEvalCases().filter(
      (row) => row.source === "ask-router-fixture",
    );
    for (const row of cases) {
      const calls = routeAskDeterministically(row.query);
      expect(calls.map((call) => call.name), row.id).toContain(row.expectedTool);
    }
  });

  it("grades the first tool strictly and any tool leniently, with Pal alternates", () => {
    const caseDef = {
      id: "x",
      query: "q",
      expectedTool: "whats_on",
      expectedTools: ["whats_on", "tonight_now"],
      source: "pal-routing" as const,
    };
    expect(firstToolMatchesCase(["tonight_now"], caseDef)).toBe(true);
    expect(firstToolMatchesCase(["search_venues", "whats_on"], caseDef)).toBe(false);
    expect(anyToolMatchesCase(["search_venues", "whats_on"], caseDef)).toBe(true);
    expect(firstToolMatchesCase([], caseDef)).toBe(false);
    expect(anyToolMatchesCase(["search_venues"], caseDef)).toBe(false);
  });

  it("refuses to run the live eval without PUBMAXX_ASK_ROUTER_MODEL_EVAL=1", async () => {
    vi.stubEnv("PUBMAXX_ASK_ROUTER_MODEL_EVAL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(runAskRouterModelEval({})).rejects.toThrow(
      /PUBMAXX_ASK_ROUTER_MODEL_EVAL=1 is required/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("counts transport errors and unpriced calls apart from wrong answers and flags them", async () => {
    vi.stubEnv("PUBMAXX_ASK_ROUTER_MODEL_EVAL", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const cases = loadAskRouterModelEvalCases();
    const expectedByQuery = new Map(
      cases.map((row) => [row.query.slice(0, 500), row.expectedTool]),
    );
    const [rateLimited, unpriced, sprayed] = cases;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls += 1;
        const query = userQuery(init);
        if (query === rateLimited!.query) return new Response("slow down", { status: 429 });
        const expected = expectedByQuery.get(query)!;
        if (query === sprayed!.query) {
          const decoy = expected === "search_venues" ? "whats_on" : "search_venues";
          return toolReply([decoy, expected], 0.001);
        }
        return toolReply([expected], query === unpriced!.query ? undefined : 0.001);
      }),
    );

    const report = await runAskRouterModelEval({ models: ["cheap/model"], pauseMs: 0 });

    expect(calls).toBe(cases.length);
    const [row] = report.models;
    expect(row).toMatchObject({
      model: "cheap/model",
      cases: cases.length,
      errors: 1,
      answered: cases.length - 1,
      correct: cases.length - 2,
      anyToolCorrect: cases.length - 1,
      anyToolAccuracyPct: 100,
      unpricedCalls: 1,
    });
    expect(row!.totalCostUsd).toBeCloseTo(0.001 * (cases.length - 2));
    expect(row!.avgCostPerCaseUsd).toBeCloseTo(0.001);
    expect(report.markdownTable).toContain(
      "**Warning:** `cheap/model` had 1 transport error(s) and 1 unpriced call(s)",
    );
  });

  it("aborts the run on an OpenRouter auth failure", async () => {
    vi.stubEnv("PUBMAXX_ASK_ROUTER_MODEL_EVAL", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "bad-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorised", { status: 401 })),
    );
    await expect(
      runAskRouterModelEval({ models: ["cheap/model"], pauseMs: 0 }),
    ).rejects.toThrow(/auth or billing failed \(401\)/);
  });
});
