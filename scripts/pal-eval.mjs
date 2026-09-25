#!/usr/bin/env node
import { runPalEvalSuite } from "../evals/pal/runSuite.ts";

const live = process.argv.includes("--live");
const writeScoreboard = process.argv.includes("--write-scoreboard") || live;

try {
  const scoreboard = await runPalEvalSuite({
    mode: live ? "live" : "deterministic",
    writeScoreboard,
  });
  const line = JSON.stringify({
    mode: scoreboard.mode,
    accuracy: scoreboard.totals.accuracy,
    passed: scoreboard.totals.passed,
    cases: scoreboard.totals.cases,
    inventedVenues: scoreboard.totals.inventedVenues,
    modelCalls: scoreboard.totals.modelCalls,
    avgCostPerCaseUsd: scoreboard.totals.avgCostPerCaseUsd,
  });
  console.log(line);
  if (scoreboard.totals.passed < scoreboard.totals.cases) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
