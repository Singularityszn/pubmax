import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_ASK_MODEL } from "@/lib/ask/modelLoop";
import { runAsk } from "@/lib/ask/runAsk";
import { createUsageCapture } from "./captureUsage";
import { gradePalCase } from "./grade";
import { loadPalEvalSuite } from "./loadSuite";
import { mergePalExpectations, resolveNormativeExpectations } from "./normative";
import { offlineFetch } from "./offlineFetch";
import type { PalEvalCaseResult, PalEvalScoreboard } from "./types";
import { loadPalEvalVenueIndex } from "./venueIndex";

export type RunPalEvalOptions = {
  mode: "deterministic" | "live";
  root?: string;
  writeScoreboard?: boolean;
};

function transcript(query: string, body: { answer: string; toolsUsed: string[] }): string {
  return `user: ${query}\nassistant: ${body.answer}\ntools: ${body.toolsUsed.join(", ")}`;
}

export async function runPalEvalSuite(options: RunPalEvalOptions): Promise<PalEvalScoreboard> {
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    return await runSuiteWithoutTypesafe(options);
  } finally {
    if (typesafeKey !== undefined) process.env.TYPESAFE_API_KEY = typesafeKey;
  }
}

async function runSuiteWithoutTypesafe(options: RunPalEvalOptions): Promise<PalEvalScoreboard> {
  const root = options.root ?? process.cwd();
  const { cases, answerKey, now } = loadPalEvalSuite(root);
  const index = loadPalEvalVenueIndex(root);
  const live = options.mode === "live";
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (live && !apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set; live Pal eval is blocked.");
  }

  const usageCapture = live ? createUsageCapture() : null;
  const results: PalEvalCaseResult[] = [];

  for (const caseDef of cases) {
    const expect = answerKey[caseDef.id];
    if (!expect) {
      throw new Error(`Missing answer-key entry for case ${caseDef.id}`);
    }

    const started = performance.now();
    const body = await runAsk({
      query: caseDef.query,
      cityId: caseDef.cityId ?? "london",
      turns: caseDef.turns,
      now,
      skipModel: !live,
      fetchImpl: usageCapture ? usageCapture.fetchImpl : offlineFetch,
      traceRoute: live ? "eval/pal-live" : "eval/pal-deterministic",
    });
    const latencyMs = performance.now() - started;

    const fetchImpl = usageCapture ? usageCapture.fetchImpl : offlineFetch;
    const normative = await resolveNormativeExpectations(caseDef, {
      now,
      fetchImpl,
      cityId: caseDef.cityId,
    });
    const mergedExpect = mergePalExpectations(expect, normative);
    const graded = gradePalCase(body, mergedExpect, index);
    const usage = {
      ...(usageCapture
        ? usageCapture.take()
        : {
            modelCalls: 0,
            modelToolCalls: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          }),
      latencyMs,
    };
    const checks = live
      ? [
          ...graded.checks,
          {
            name: "model_ran",
            pass: usage.modelToolCalls > 0,
            detail: `modelCalls=${usage.modelCalls} modelToolCalls=${usage.modelToolCalls}`,
          },
        ]
      : graded.checks;

    results.push({
      id: caseDef.id,
      query: caseDef.query,
      pass: checks.every((check) => check.pass),
      checks,
      inventedVenues: graded.inventedVenues,
      toolsUsed: body.toolsUsed,
      cardCount: body.cards.length,
      answer: body.answer,
      transcript: transcript(caseDef.query, body),
      usage,
    });
  }

  const passed = results.filter((r) => r.pass).length;
  const inventedVenues = results.reduce((sum, r) => sum + r.inventedVenues, 0);
  const modelCalls = results.reduce((sum, r) => sum + r.usage.modelCalls, 0);
  const costUsd = results.reduce((sum, r) => sum + r.usage.costUsd, 0);
  const avgLatencyMs =
    results.reduce((sum, r) => sum + r.usage.latencyMs, 0) / Math.max(results.length, 1);

  const scoreboard: PalEvalScoreboard = {
    runAt: new Date().toISOString(),
    mode: options.mode,
    ...(live ? { model: process.env.OPENROUTER_MODEL ?? DEFAULT_ASK_MODEL } : {}),
    totals: {
      cases: results.length,
      passed,
      accuracy: results.length ? passed / results.length : 0,
      inventedVenues,
      modelCalls,
      costUsd,
      avgLatencyMs,
      avgCostPerCaseUsd: results.length ? costUsd / results.length : 0,
    },
    results,
  };

  if (options.writeScoreboard) {
    const dir = join(root, "evals/pal/scoreboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "latest.json"), JSON.stringify(scoreboard, null, 2));
    const failures = results.filter((r) => !r.pass).slice(0, 3);
    const lines = [
      "# Pal eval scoreboard",
      "",
      `- Mode: ${scoreboard.mode}`,
      `- Run at: ${scoreboard.runAt}`,
      `- Accuracy: ${(scoreboard.totals.accuracy * 100).toFixed(1)}% (${scoreboard.totals.passed}/${scoreboard.totals.cases})`,
      `- Invented venues: ${scoreboard.totals.inventedVenues}`,
      `- Model calls: ${scoreboard.totals.modelCalls}`,
      `- Cost per case: $${scoreboard.totals.avgCostPerCaseUsd.toFixed(4)}`,
      `- Avg latency: ${scoreboard.totals.avgLatencyMs.toFixed(0)} ms`,
      "",
      "## Worst failures",
      "",
    ];
    for (const failure of failures) {
      lines.push(`### ${failure.id}`);
      lines.push("");
      lines.push("```");
      lines.push(failure.transcript);
      lines.push("```");
      lines.push("");
      for (const check of failure.checks.filter((c) => !c.pass)) {
        lines.push(`- ${check.name}: ${check.detail}`);
      }
      lines.push("");
    }
    writeFileSync(join(dir, "latest.md"), lines.join("\n"));
  }

  return scoreboard;
}
