#!/usr/bin/env node

import { readFile } from "node:fs/promises";

function usage() {
  console.error(
    "Usage: node scripts/assert-playwright-gate.mjs <report.json> [--require-zero-skipped] " +
      "[--skips-argued <allowlist.json>] [--report-retries]",
  );
}

/**
 * The spec file a test came from, as the report writes it: a path relative to
 * the Playwright testDir. Falls back through the suite tree, because only the
 * file-level suite carries it.
 */
function specFile(test) {
  return typeof test.file === "string" && test.file ? test.file : null;
}

/** Compare a report path against an allowlist path without caring about the testDir prefix. */
function samePath(reportFile, allowlistFile) {
  if (!reportFile || !allowlistFile) return false;
  const trim = (value) => value.replace(/^\.\//, "").replace(/^e2e\//, "");
  return trim(reportFile) === trim(allowlistFile);
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
          file: spec.file ?? suite.file ?? null,
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

function decodeJsonAttachment(attachment) {
  if (!attachment || typeof attachment !== "object" || typeof attachment.body !== "string") {
    return null;
  }
  if (
    attachment.contentType !== "application/json" &&
    !String(attachment.name ?? "").toLowerCase().includes("axe")
  ) {
    return null;
  }

  const candidates = [
    Buffer.from(attachment.body, "base64").toString("utf8"),
    attachment.body,
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next representation. Playwright JSON reporter uses base64 bodies,
      // while hand-authored fixtures may contain plain JSON.
    }
  }
  return null;
}

function collectAttachmentAxeViolations(tests) {
  const violations = [];
  for (const test of tests) {
    for (const result of test.results ?? []) {
      for (const attachment of result.attachments ?? []) {
        const payload = decodeJsonAttachment(attachment);
        if (payload) collectAxeViolations(payload, violations);
      }
    }
  }
  return violations;
}

const args = process.argv.slice(2);
const requireZeroSkipped = args.includes("--require-zero-skipped");
// A SKIP IS ARGUED OR IT IS REFUSED. e2e/conditional-skips.allowlist.json is
// the one place a browser skip is argued (the spec, the exact condition, the
// reason and what ends it), and scripts/assert-no-conditional-e2e-skips.mjs
// already holds the source to it. Without this the run gate refused a skip the
// source gate had accepted, so a spec file carrying one argued skip could never
// join a gated run however much else it proved. An unargued skip still fails.
const skipsArguedIndex = args.indexOf("--skips-argued");
const skipsArguedPath = skipsArguedIndex >= 0 ? args[skipsArguedIndex + 1] : null;
if (skipsArguedIndex >= 0 && (!skipsArguedPath || skipsArguedPath.startsWith("--"))) {
  usage();
  process.exit(2);
}
const reportPath = args.find(
  (arg, index) =>
    !arg.startsWith("--") && !(skipsArguedIndex >= 0 && index === skipsArguedIndex + 1),
);
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

const arguedSkips = [];
if (skipsArguedPath) {
  let allowlist;
  try {
    allowlist = JSON.parse(await readFile(skipsArguedPath, "utf8"));
  } catch (error) {
    fail(
      `cannot parse ${skipsArguedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit();
  }
  if (!allowlist || !Array.isArray(allowlist.allowed)) {
    fail(`${skipsArguedPath} must hold an "allowed" array`);
    process.exit();
  }
  for (const row of allowlist.allowed) {
    if (!row || typeof row.file !== "string" || !row.file) {
      fail(`${skipsArguedPath} holds a row with no file`);
      process.exit();
    }
    // A ROW ARGUES NAMED TESTS, NEVER A WHOLE FILE. Reading `file` alone made
    // every skipped test in a named spec argued, so a new unargued test.skip
    // in either allowlisted spec passed this gate in silence.
    if (!Array.isArray(row.tests) || row.tests.length === 0) {
      fail(`${skipsArguedPath} row ${row.file} must name the tests it argues in a "tests" array`);
      process.exit();
    }
    arguedSkips.push({ file: row.file, tests: row.tests.map(String) });
  }
}

/** True when the allowlist argues THIS test, by spec file and by title. */
function skipIsArgued(test) {
  const titles = test.titlePath ?? [];
  return arguedSkips.some(
    (row) =>
      samePath(specFile(test), row.file) &&
      row.tests.some((title) => titles.includes(title)),
  );
}

const tests = collectTests(report.suites);
if (tests.length === 0) fail("zero tests discovered");

const allSkipped = tests.filter(
  (test) =>
    test.status === "skipped" ||
    test.expectedStatus === "skipped" ||
    (test.results ?? []).some((result) => result.status === "skipped"),
);
const argued = allSkipped.filter((test) => skipIsArgued(test));
const skipped = allSkipped.filter((test) => !argued.includes(test));
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
const axeViolations = [
  ...collectAxeViolations(report),
  ...collectAttachmentAxeViolations(tests),
];

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
  arguedSkips: argued.length,
  unexpected: unexpected.length,
  retried: retried.length,
  axeSeriousOrCritical: axeViolations.length,
};

console.log(JSON.stringify(stats));
if (reportRetries && retried.length === 0) console.log("retries: none");
