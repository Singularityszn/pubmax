#!/usr/bin/env node
// Refreshes scripts/ci/layout-pin-durations.json, the measured time of each
// layout-pin spec that scripts/ci/layout-pin-shard.mjs uses to give the three
// macOS layout shards the same amount of work (docs/CI_RUNBOOK.md, "Timeouts
// and job shape").
//
// Usage: run the layout pins with Playwright's JSON reporter on a Mac, one
// worker, then pass every report:
//   npm run ci:layout-pin-durations -- <scratch>/layout-pins.json [more reports...]
// Only specs already in the durations file are updated. A spec in no report
// keeps its old figure. Only the relative sizes matter, so a local run is good
// enough. It reads only the reports and writes only the durations file.

import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(ROOT, "scripts/ci/layout-pin-durations.json");

const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error("usage: npm run ci:layout-pin-durations -- <playwright-json-report> [...]");
  process.exit(2);
}

const current = JSON.parse(readFileSync(OUT, "utf8"));
const known = Object.keys(current.files);
const measured = {};

function addSuite(suite, file, totals) {
  const path = suite.file ?? file;
  const key = path && known.find((spec) => spec === path || spec.endsWith(`/${path}`));
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        const ms = Number(result.duration);
        if (key && Number.isFinite(ms) && ms >= 0) totals[key] = (totals[key] ?? 0) + ms;
      }
    }
  }
  for (const child of suite.suites ?? []) addSuite(child, path, totals);
}

for (const report of reports) {
  const totals = {};
  for (const suite of JSON.parse(readFileSync(report, "utf8")).suites ?? []) addSuite(suite, null, totals);
  for (const [key, ms] of Object.entries(totals)) (measured[key] ??= []).push(ms);
}

// The report names a spec relative to the Playwright testDir.
const files = { ...current.files };
let updated = 0;
for (const [key, observations] of Object.entries(measured)) {
  observations.sort((a, b) => a - b);
  const middle = Math.floor(observations.length / 2);
  files[key] = Math.round(observations.length % 2
    ? observations[middle]
    : (observations[middle - 1] + observations[middle]) / 2);
  updated += 1;
}

const today = new Date().toISOString().slice(0, 10);
const next = {
  source: `Median per-report Playwright spec durations across the layout-pin projects, refreshed ${today} from ${reports.length} JSON report(s). Refresh with npm run ci:layout-pin-durations.`,
  unit: "milliseconds",
  files,
};
writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`ci:layout-pin-durations: ${updated} of ${known.length} spec(s) measured in ${relative(ROOT, OUT)}`);
