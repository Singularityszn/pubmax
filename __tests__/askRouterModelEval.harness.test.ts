import { describe, expect, it } from "vitest";

import { ASK_ROUTER_MODEL_EVAL_CANDIDATES } from "@/evals/askRouterModel/candidates";
import { toolChoiceMatchesCase } from "@/evals/askRouterModel/grade";
import { loadAskRouterModelEvalCases } from "@/evals/askRouterModel/loadCases";
import routerCases from "@/__tests__/fixtures/typesafe/ask-router-cases.json";
import {
  askRouterModelEvalEnabled,
  pickCheapestMatchingModel,
} from "@/evals/askRouterModel/runEval";
import { askModelLoopSystemPrompt } from "@/lib/ask/modelLoop";
import type { AskRouterModelEvalRow } from "@/evals/askRouterModel/runEval";
import { routeAskDeterministically } from "@/lib/ask/router";

describe("ask router model eval harness", () => {
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

  it("grades tool choice with Pal alternates", () => {
    const caseDef = {
      id: "x",
      query: "q",
      expectedTool: "whats_on",
      expectedTools: ["whats_on", "tonight_now"],
      source: "pal-routing" as const,
    };
    expect(toolChoiceMatchesCase(["tonight_now"], caseDef)).toBe(true);
    expect(toolChoiceMatchesCase(["search_venues"], caseDef)).toBe(false);
  });

  it("picks the cheapest model within tolerance of baseline", () => {
    const rows: AskRouterModelEvalRow[] = [
      {
        model: "cheap",
        cases: 100,
        correct: 99,
        accuracyPct: 99,
        avgLatencyMs: 100,
        totalCostUsd: 0.01,
        avgCostPerCaseUsd: 0.001,
        unpricedCalls: 0,
        errors: 0,
      },
      {
        model: "anthropic/claude-sonnet-4-5",
        cases: 10,
        correct: 10,
        accuracyPct: 100,
        avgLatencyMs: 200,
        totalCostUsd: 0.5,
        avgCostPerCaseUsd: 0.05,
        unpricedCalls: 0,
        errors: 0,
      },
    ];
    expect(pickCheapestMatchingModel(rows, "anthropic/claude-sonnet-4-5", 2)).toBe("cheap");
  });

  it("keeps the live eval behind PUBMAXX_ASK_ROUTER_MODEL_EVAL", () => {
    expect(askRouterModelEvalEnabled()).toBe(false);
    expect(askModelLoopSystemPrompt()).toContain("Night OS Ask");
  });

  it("lists the scout candidate models", () => {
    expect(ASK_ROUTER_MODEL_EVAL_CANDIDATES).toContain("openai/gpt-5-nano");
    expect(ASK_ROUTER_MODEL_EVAL_CANDIDATES.at(-1)).toBe("anthropic/claude-sonnet-4-5");
  });
});
