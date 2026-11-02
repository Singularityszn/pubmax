#!/usr/bin/env node
// Refreshes scripts/ci/vitest-shard-durations.json, the measured time of each
// unit test file that scripts/ci/vitestShardBalance.mjs uses to give the three
// CI unit shards the same amount of work (docs/CI_RUNBOOK.md, "Timeouts and
// job shape").
//
// Usage: run the suite with Vitest's JSON reporter, then pass every report:
//   npm run coverage -- --without-postgres --reporter=json --outputFile=<scratch>/unit.json
//   npm run ci:shard-durations -- <scratch>/unit.json [more reports...]
// A file in no report keeps its old figure. Only the relative sizes matter, so
// a local run is good enough; the source line records where the figures came
// from. It reads only the reports and writes only the durations file.

import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, "scripts/ci/vitest-shard-durations.json");

const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error("usage: npm run ci:shard-durations -- <vitest-json-report> [...]");
  process.exit(2);
}

const current = JSON.parse(readFileSync(OUT, "utf8"));
const files = { ...current.files };
let measured = 0;
for (const report of reports) {
  const { testResults } = JSON.parse(readFileSync(report, "utf8"));
  for (const result of testResults ?? []) {
    const path = relative(ROOT, result.name).replaceAll("\\", "/");
    const ms = Math.round(Number(result.endTime) - Number(result.startTime));
    if (!path.startsWith("__tests__/") || !Number.isFinite(ms) || ms < 0) continue;
    files[path] = ms;
    measured += 1;
  }
}

const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const today = new Date().toISOString().slice(0, 10);
const next = {
  source: `Per-file Vitest durations, refreshed ${today} from ${reports.length} JSON report(s). Refresh with npm run ci:shard-durations.`,
  unit: "milliseconds",
  files: sorted,
};
writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`ci:shard-durations: ${measured} measured file(s), ${Object.keys(sorted).length} in ${relative(ROOT, OUT)}`);
