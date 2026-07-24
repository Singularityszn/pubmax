#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function usage() {
  console.error(
    "Usage: node scripts/assert-playwright-gate.mjs <report.json> [--require-zero-skipped] [--report-retries]",
  );
}

function fail(message) {
  console.error(`playwright gate failed: ${message}`);
  process.exitCode = 1;
}

function collectTests(suites, path = []) {
  const tests = [];

  for (const suite of suites) {
    const suitePath = [...path, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests.push({
          ...test,
          titlePath: [...suitePath, spec.title, test.projectName].filter(Boolean),
        });
      }
    }
    tests.push(...collectTests(suite.suites ?? [], suitePath));
  }

  return tests;
}

function collectAxeViolations(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAxeViolations(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value.violations)) {
    for (const violation of value.violations) {
      if (violation && ["critical", "serious"].includes(violation.impact)) {
        found.push({
          id: violation.id ?? "unknown",
          impact: violation.impact,
          description: violation.description ?? "",
        });
      }
    }
  }

  for (const child of Object.values(value)) collectAxeViolations(child, found);
  return found;
}

const args = process.argv.slice(2);
const reportPath = args.find((arg) => !arg.startsWith("--"));
const requireZeroSkipped = args.includes("--require-zero-skipped");
const reportRetries = args.includes("--report-retries");

if (!reportPath) {
  usage();
  process.exit(2);
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  fail(`cannot parse ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit();
}

if (!report || typeof report !== "object" || !Array.isArray(report.suites)) {
  fail("report must be a Playwright JSON object with a suites array");
  process.exit();
}

const tests = collectTests(report.suites);
if (tests.length === 0) fail("zero tests discovered");

const skipped = tests.filter(
  (test) =>
    test.status === "skipped" ||
    test.expectedStatus === "skipped" ||
    (test.results ?? []).some((result) => result.status === "skipped"),
);
const unexpected = tests.filter(
  (test) =>
    test.status === "unexpected" ||
    (test.results ?? []).some((result) =>
      ["failed", "timedOut", "interrupted"].includes(result.status),
    ),
);
const retried = tests.filter(
  (test) =>
    test.status === "flaky" ||
    (test.results ?? []).some((result, index) => (result.retry ?? index) > 0),
);
const axeViolations = collectAxeViolations(report);

if (unexpected.length > 0) {
  fail(
    `${unexpected.length} unexpected test result(s): ${unexpected
      .map((test) => test.titlePath.join(" > "))
      .join(", ")}`,
  );
}
if (requireZeroSkipped && skipped.length > 0) {
  fail(
    `${skipped.length} skipped test(s): ${skipped
      .map((test) => test.titlePath.join(" > "))
      .join(", ")}`,
  );
}
if (retried.length > 0) {
  fail(
    `${retried.length} retried/flaky test(s): ${retried
      .map((test) => test.titlePath.join(" > "))
      .join(", ")}`,
  );
}
if (axeViolations.length > 0) {
  fail(
    `${axeViolations.length} serious/critical axe violation(s): ${axeViolations
      .map((violation) => `${violation.impact}:${violation.id}`)
      .join(", ")}`,
  );
}

const stats = {
  discovered: tests.length,
  skipped: skipped.length,
  unexpected: unexpected.length,
  retried: retried.length,
  axeSeriousOrCritical: axeViolations.length,
};

console.log(JSON.stringify(stats));
if (reportRetries && retried.length === 0) console.log("retries: none");
