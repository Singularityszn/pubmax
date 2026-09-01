#!/usr/bin/env node
/*
 * probe-api-budgets.mjs — the CI probe behind perf/api-budgets.json.
 *
 * Hits each budgeted read against a deployed target, times to the first byte
 * of the body, and fails when a percentile is past its ceiling. Heavy
 * verification runs on remote CI rather than a local full build, so this takes
 * a base URL and nothing else.
 *
 *   node scripts/probe-api-budgets.mjs --base-url https://<preview>.vercel.app
 *
 * The rules (percentile, breach, tables) live in lib/apiBudgets.ts so they are
 * unit-tested without a network. This file only measures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const budgets = JSON.parse(
  readFileSync(join(ROOT, "perf/api-budgets.json"), "utf8"),
);

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const baseUrl = arg("--base-url") ?? process.env.PUBMAX_PROBE_BASE_URL;
if (!baseUrl) {
  console.error("probe-api-budgets: --base-url (or PUBMAX_PROBE_BASE_URL) is required.");
  process.exit(2);
}

/** Nearest-rank, the same rule lib/apiBudgets.ts states. */
function percentile(samples, fraction) {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Time to the first byte of the body. The response is drained afterwards:
 * a body nobody reads is a request that never finishes (lib/responseBody.ts).
 */
async function sample(url) {
  const started = performance.now();
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const reader = response.body?.getReader();
  if (reader) {
    await reader.read();
    await reader.cancel().catch(() => {});
  } else {
    await response.text().catch(() => {});
  }
  return { ms: performance.now() - started, status: response.status };
}

async function main() {
  const { samples, warmupSamples } = budgets.method;
  const measured = new Map();
  const unreachable = [];

  for (const route of budgets.routes) {
    const url = new URL(route.path, baseUrl).toString();
    const times = [];
    let lastStatus = 0;
    for (let run = 0; run < warmupSamples + samples; run += 1) {
      try {
        const result = await sample(url);
        lastStatus = result.status;
        if (run >= warmupSamples) times.push(result.ms);
      } catch (error) {
        unreachable.push(`${route.path}: ${String(error)}`);
        break;
      }
    }
    // A probe that never got a 2xx measured an error page, not the read.
    if (times.length === 0 || lastStatus >= 400) {
      unreachable.push(`${route.path}: HTTP ${lastStatus || "no response"}`);
      continue;
    }
    measured.set(route.path, {
      p50Ms: Math.round(percentile(times, 0.5)),
      p95Ms: Math.round(percentile(times, 0.95)),
    });
  }

  const { findApiBudgetBreaches, formatApiBreachTable, formatApiMeasurementTable } =
    await import("../lib/apiBudgets.ts");

  console.log(`[api-budget] ${baseUrl}`);
  console.log(formatApiMeasurementTable(budgets.routes, measured));

  if (unreachable.length > 0) {
    console.error(`\n[api-budget] routes the probe could not measure:\n  ${unreachable.join("\n  ")}`);
    process.exit(1);
  }

  const breaches = findApiBudgetBreaches(budgets.routes, measured);
  if (breaches.length > 0) {
    console.error(
      `\nOver the API latency budget. Fix the read or take the ceiling up deliberately ` +
        `(docs/PERFORMANCE_BUDGETS.md).\n\n${formatApiBreachTable(breaches)}\n`,
    );
    process.exit(1);
  }
  console.log("\n[api-budget] every budgeted read inside its ceiling.");
}

await main();
