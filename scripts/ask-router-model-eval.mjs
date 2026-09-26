#!/usr/bin/env node
import { runAskRouterModelEval } from "../evals/askRouterModel/runEval.ts";

const writeScoreboard = process.argv.includes("--write-scoreboard");

try {
  const report = await runAskRouterModelEval({ writeScoreboard });
  console.log(report.markdownTable);
  console.log("");
  console.log(
    JSON.stringify({
      cases: report.cases,
      models: report.models.map((row) => ({
        model: row.model,
        accuracyPct: row.accuracyPct,
        avgLatencyMs: row.avgLatencyMs,
        totalCostUsd: row.totalCostUsd,
      })),
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
