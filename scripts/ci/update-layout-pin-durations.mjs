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

function addSuite(suite, file) {
  const path = suite.file ?? file;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        const ms = Number(result.duration);
        if (path && Number.isFinite(ms) && ms >= 0) measured[path] = (measured[path] ?? 0) + ms;
      }
    }
  }
  for (const child of suite.suites ?? []) addSuite(child, path);
}

for (const report of reports) {
  for (const suite of JSON.parse(readFileSync(report, "utf8")).suites ?? []) addSuite(suite, null);
}

// The report names a spec relative to the Playwright testDir.
const files = { ...current.files };
let updated = 0;
for (const [path, ms] of Object.entries(measured)) {
  const key = known.find((spec) => spec === path || spec.endsWith(`/${path}`));
  if (key === undefined) continue;
  files[key] = Math.round(ms);
  updated += 1;
}

const today = new Date().toISOString().slice(0, 10);
const next = {
  source: `Per-spec Playwright durations across the layout-pin projects, refreshed ${today} from ${reports.length} JSON report(s). Refresh with npm run ci:layout-pin-durations.`,
  unit: "milliseconds",
  files,
};
writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`ci:layout-pin-durations: ${updated} of ${known.length} spec(s) measured in ${relative(ROOT, OUT)}`);
