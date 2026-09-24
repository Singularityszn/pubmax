import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { runAsk } from "@/lib/ask/runAsk";
import { routeAskDeterministically } from "@/lib/ask/router";
import { createUsageCapture } from "./captureUsage";
import { gradePalCase } from "./grade";
import { loadPalEvalSuite } from "./loadSuite";
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
  const root = options.root ?? process.cwd();
  const { cases, answerKey } = loadPalEvalSuite(root);
  const index = loadPalEvalVenueIndex(root);
  const live = options.mode === "live";
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (live && !apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set; live Pal eval is blocked.");
  }

  const usageCapture = live ? createUsageCapture(process.env.OPENROUTER_MODEL) : null;
  const results: PalEvalCaseResult[] = [];

  for (const caseDef of cases) {
    const expect = answerKey[caseDef.id];
    if (!expect) {
      throw new Error(`Missing answer-key entry for case ${caseDef.id}`);
    }

    const started = performance.now();
    let body;
    if (caseDef.recordedResponse) {
      body = caseDef.recordedResponse;
    } else {
      body = await runAsk({
        query: caseDef.query,
        cityId: caseDef.cityId ?? "london",
        turns: caseDef.turns,
        skipModel: !live,
        ...(usageCapture ? { fetchImpl: usageCapture.fetchImpl } : {}),
        traceRoute: live ? "eval/pal-live" : "eval/pal-deterministic",
      });
    }
    const latencyMs = performance.now() - started;

    const routeTools = routeAskDeterministically(caseDef.query).map((call) => call.name);
    const graded = gradePalCase(body, expect, index, routeTools);
    const usage = usageCapture
      ? {
          promptTokens: usageCapture.promptTokens,
          completionTokens: usageCapture.completionTokens,
          totalTokens: usageCapture.totalTokens,
          latencyMs,
          costUsd: usageCapture.costUsd,
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs, costUsd: 0 };

    results.push({
      id: caseDef.id,
      query: caseDef.query,
      pass: graded.pass,
      checks: graded.checks,
      inventedVenues: graded.inventedVenues,
      toolsUsed: body.toolsUsed,
      cardCount: body.cards.length,
      answer: body.answer,
      transcript: transcript(caseDef.query, body),
      usage,
    });

    if (usageCapture) {
      usageCapture.promptTokens = 0;
      usageCapture.completionTokens = 0;
      usageCapture.totalTokens = 0;
      usageCapture.costUsd = 0;
      usageCapture.latencyMs = 0;
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const inventedVenues = results.reduce((sum, r) => sum + r.inventedVenues, 0);
  const costUsd = results.reduce((sum, r) => sum + (r.usage?.costUsd ?? 0), 0);
  const avgLatencyMs =
    results.reduce((sum, r) => sum + (r.usage?.latencyMs ?? 0), 0) / Math.max(results.length, 1);

  const scoreboard: PalEvalScoreboard = {
    runAt: new Date().toISOString(),
    mode: options.mode,
    ...(live && process.env.OPENROUTER_MODEL
      ? { model: process.env.OPENROUTER_MODEL }
      : live
        ? { model: "anthropic/claude-sonnet-4-5" }
        : {}),
    totals: {
      cases: results.length,
      passed,
      accuracy: results.length ? passed / results.length : 0,
      inventedVenues,
      costUsd,
      avgLatencyMs,
      avgCostPerCaseUsd: results.length ? costUsd / results.length : 0,
    },
    results,
  };

  if (options.writeScoreboard) {
    const dir = join(root, "evals/pal/scoreboard");
    writeFileSync(join(dir, "latest.json"), JSON.stringify(scoreboard, null, 2));
    const failures = results.filter((r) => !r.pass).slice(0, 3);
    const lines = [
      "# Pal eval scoreboard",
      "",
      `- Mode: ${scoreboard.mode}`,
      `- Run at: ${scoreboard.runAt}`,
      `- Accuracy: ${(scoreboard.totals.accuracy * 100).toFixed(1)}% (${scoreboard.totals.passed}/${scoreboard.totals.cases})`,
      `- Invented venues: ${scoreboard.totals.inventedVenues}`,
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
