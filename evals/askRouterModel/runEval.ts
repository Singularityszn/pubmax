import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { probeAskModelToolChoice } from "@/lib/ask/modelLoop";
import {
  ASK_ROUTER_MODEL_EVAL_BASELINE,
  ASK_ROUTER_MODEL_EVAL_CANDIDATES,
} from "./candidates";
import { anyToolMatchesCase, firstToolMatchesCase } from "./grade";
import { loadAskRouterModelEvalCases } from "./loadCases";

export type AskRouterModelEvalRow = {
  model: string;
  cases: number;
  /** Transport failures (HTTP error, timeout, network); excluded from every other figure. */
  errors: number;
  /** Cases that got a model reply: `cases - errors`. */
  answered: number;
  /** Answered cases whose first tool call is an expected tool. */
  correct: number;
  accuracyPct: number;
  /** Answered cases where any picked tool is an expected tool. */
  anyToolCorrect: number;
  anyToolAccuracyPct: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  /** Answered calls whose response carried no `usage.cost`; excluded from cost figures. */
  unpricedCalls: number;
  avgCostPerCaseUsd: number | null;
};

export type AskRouterModelEvalReport = {
  runAt: string;
  cases: number;
  models: AskRouterModelEvalRow[];
  markdownTable: string;
};

const EVAL_ENV = "PUBMAXX_ASK_ROUTER_MODEL_EVAL";

function askRouterModelEvalEnabled(): boolean {
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
    let errors = 0;
    let correct = 0;
    let anyToolCorrect = 0;
    let totalLatency = 0;
    let totalCost = 0;
    let unpricedCalls = 0;

    for (const caseDef of cases) {
      const probe = await probeAskModelToolChoice({
        query: caseDef.query,
        apiKey,
        model,
      });
      if (pauseMs > 0) await sleep(pauseMs);
      if (probe.error) {
        if (probe.httpStatus === 401 || probe.httpStatus === 402) {
          throw new Error(
            `OpenRouter auth or billing failed (${probe.httpStatus}) for model ${model}: ${probe.error}`,
          );
        }
        errors += 1;
        continue;
      }
      totalLatency += probe.latencyMs;
      if (probe.costUsd === null) unpricedCalls += 1;
      else totalCost += probe.costUsd;
      if (firstToolMatchesCase(probe.tools, caseDef)) correct += 1;
      if (anyToolMatchesCase(probe.tools, caseDef)) anyToolCorrect += 1;
    }

    const answered = cases.length - errors;
    const priced = answered - unpricedCalls;
    modelRows.push({
      model,
      cases: cases.length,
      errors,
      answered,
      correct,
      accuracyPct: answered ? (correct / answered) * 100 : 0,
      anyToolCorrect,
      anyToolAccuracyPct: answered ? (anyToolCorrect / answered) * 100 : 0,
      avgLatencyMs: answered ? totalLatency / answered : 0,
      totalCostUsd: totalCost,
      unpricedCalls,
      avgCostPerCaseUsd: priced ? totalCost / priced : null,
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
    "| Model | First-tool accuracy | Δ vs Sonnet 4.5 | Any-tool match | Errors | Unpriced | Avg latency | Total cost | Cost / case |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of rows) {
    const delta = row.accuracyPct - baselineAcc;
    const deltaStr =
      row.model === baselineModel ? "baseline" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`;
    const costPerCase =
      row.avgCostPerCaseUsd === null ? "n/a" : `$${row.avgCostPerCaseUsd.toFixed(5)}`;
    lines.push(
      `| \`${row.model}\` | ${row.accuracyPct.toFixed(1)}% (${row.correct}/${row.answered}) | ${deltaStr} | ${row.anyToolAccuracyPct.toFixed(1)}% (${row.anyToolCorrect}/${row.answered}) | ${row.errors} | ${row.unpricedCalls} | ${row.avgLatencyMs.toFixed(0)} ms | $${row.totalCostUsd.toFixed(4)} | ${costPerCase} |`,
    );
  }
  lines.push("");
  const flagged = rows.filter((row) => row.errors > 0 || row.unpricedCalls > 0);
  for (const row of flagged) {
    lines.push(
      `**Warning:** \`${row.model}\` had ${row.errors} transport error(s) and ${row.unpricedCalls} unpriced call(s); accuracy covers ${row.answered}/${row.cases} cases and cost covers priced calls only. Rerun before comparing.`,
    );
  }
  if (flagged.length) lines.push("");
  lines.push(
    "_Within ~2 percentage points of baseline first-tool accuracy, with no errors or unpriced calls, is the bar for changing `DEFAULT_ASK_MODEL`._",
  );
  return lines.join("\n");
}
