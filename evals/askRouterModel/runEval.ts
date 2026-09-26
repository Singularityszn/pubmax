import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { probeAskModelToolChoice } from "@/lib/ask/modelLoop";
import {
  ASK_ROUTER_MODEL_EVAL_BASELINE,
  ASK_ROUTER_MODEL_EVAL_CANDIDATES,
} from "./candidates";
import { toolChoiceMatchesCase } from "./grade";
import { loadAskRouterModelEvalCases } from "./loadCases";

export type AskRouterModelEvalRow = {
  model: string;
  cases: number;
  correct: number;
  accuracyPct: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  avgCostPerCaseUsd: number;
  unpricedCalls: number;
  errors: number;
};

export type AskRouterModelEvalReport = {
  runAt: string;
  cases: number;
  models: AskRouterModelEvalRow[];
  markdownTable: string;
};

const EVAL_ENV = "PUBMAXX_ASK_ROUTER_MODEL_EVAL";

export function askRouterModelEvalEnabled(): boolean {
  return process.env[EVAL_ENV] === "1";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAskRouterModelEval(input: {
  root?: string;
  models?: readonly string[];
  writeScoreboard?: boolean;
  /** Pause between OpenRouter calls to reduce burst rate limits. */
  pauseMs?: number;
}): Promise<AskRouterModelEvalReport> {
  if (!askRouterModelEvalEnabled()) {
    throw new Error(
      `${EVAL_ENV}=1 is required to run the live ask-router model eval (OpenRouter spend).`,
    );
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const root = input.root ?? process.cwd();
  const cases = loadAskRouterModelEvalCases(root);
  const models = input.models ?? ASK_ROUTER_MODEL_EVAL_CANDIDATES;
  const pauseMs = input.pauseMs ?? 120;

  const modelRows: AskRouterModelEvalRow[] = [];

  for (const model of models) {
    let correct = 0;
    let totalLatency = 0;
    let totalCost = 0;
    let unpricedCalls = 0;
    let errors = 0;

    for (const caseDef of cases) {
      const probe = await probeAskModelToolChoice({
        query: caseDef.query,
        apiKey,
        model,
      });
      totalLatency += probe.latencyMs;
      if (probe.costUsd === null) {
        if (!probe.error?.startsWith("OpenRouter responded")) unpricedCalls += 1;
      } else {
        totalCost += probe.costUsd;
      }
      if (probe.error && probe.error !== "no_tool_calls") {
        if (probe.httpStatus === 401 || probe.httpStatus === 402) {
          throw new Error(
            `OpenRouter auth or billing failed (${probe.httpStatus}) for model ${model}: ${probe.error}`,
          );
        }
        errors += 1;
      }
      if (toolChoiceMatchesCase(probe.tools, caseDef)) correct += 1;
      if (pauseMs > 0) await sleep(pauseMs);
    }

    const n = cases.length;
    modelRows.push({
      model,
      cases: n,
      correct,
      accuracyPct: n ? (correct / n) * 100 : 0,
      avgLatencyMs: n ? totalLatency / n : 0,
      totalCostUsd: totalCost,
      avgCostPerCaseUsd: n ? totalCost / n : 0,
      unpricedCalls,
      errors,
    });
  }

  const markdownTable = formatMarkdownTable(modelRows, ASK_ROUTER_MODEL_EVAL_BASELINE);
  const report: AskRouterModelEvalReport = {
    runAt: new Date().toISOString(),
    cases: cases.length,
    models: modelRows,
    markdownTable,
  };

  if (input.writeScoreboard) {
    const dir = join(root, "evals/askRouterModel/scoreboard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "latest.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(dir, "latest.md"), markdownTable);
  }

  return report;
}

function formatMarkdownTable(rows: AskRouterModelEvalRow[], baselineModel: string): string {
  const baseline = rows.find((row) => row.model === baselineModel);
  const baselineAcc = baseline?.accuracyPct ?? 0;
  const lines = [
    "## Ask router model eval (tool choice)",
    "",
    "| Model | Accuracy | Δ vs Sonnet 4.5 | Avg latency | Total cost | Cost / case |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    const delta = row.accuracyPct - baselineAcc;
    const deltaStr =
      row.model === baselineModel ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`;
    lines.push(
      `| \`${row.model}\` | ${row.accuracyPct.toFixed(1)}% (${row.correct}/${row.cases}) | ${deltaStr} | ${row.avgLatencyMs.toFixed(0)} ms | $${row.totalCostUsd.toFixed(4)} | $${row.avgCostPerCaseUsd.toFixed(5)} |`,
    );
  }
  lines.push("");
  lines.push(
    "_Within ~2 percentage points of baseline accuracy is the bar for changing `DEFAULT_ASK_MODEL`._",
  );
  return lines.join("\n");
}

/** Cheapest candidate within `tolerancePct` points of baseline accuracy (excludes baseline if tied). */
export function pickCheapestMatchingModel(
  rows: AskRouterModelEvalRow[],
  baselineModel: string,
  tolerancePct = 2,
): string | null {
  const baseline = rows.find((row) => row.model === baselineModel);
  if (!baseline) return null;
  const floor = baseline.accuracyPct - tolerancePct;
  const eligible = rows.filter((row) => row.accuracyPct >= floor);
  eligible.sort((a, b) => a.avgCostPerCaseUsd - b.avgCostPerCaseUsd);
  return eligible[0]?.model ?? null;
}
