import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve("scripts/review-finding-dedup.mjs");

function finding(id, overrides = {}) {
  return {
    id,
    file: "lib/example.ts",
    revision: "abc123",
    summary: "Missing authorisation check",
    evidence: "Private review proof that must stay out of the report.",
    ...overrides,
  };
}

function run(findings, args = [], preload = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "review-dedup-"));
  try {
    const input = path.join(dir, "findings.json");
    const original = JSON.stringify(findings);
    writeFileSync(input, original);
    const nodeArgs = [];
    if (preload) {
      const file = path.join(dir, "provider.mjs");
      writeFileSync(file, preload);
      nodeArgs.push("--import", file);
    }
    const result = spawnSync(process.execPath, [...nodeArgs, cli, input, ...args], {
      encoding: "utf8",
      env: { ...process.env, TYPESAFE_API_KEY: preload ? "synthetic-key" : "" },
      timeout: 10_000,
    });
    assert.equal(readFileSync(input, "utf8"), original);
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI reports exact duplicates without changing findings or exposing their text", () => {
  const result = run([finding("A"), finding("B"), finding("C", { severity: "P1" })]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputCount, 3);
  assert.deepEqual(report.exactDuplicateGroups, [{
    ids: ["A", "B"], file: "lib/example.ts", revision: "abc123", action: "review_only",
  }]);
  assert.equal(report.jev.requestCount, 0);
  assert.equal(report.jev.usage, null);
  assert.equal(result.stdout.includes("Private review proof"), false);
  assert.equal(result.stdout.includes("Missing authorisation"), false);
});

test("CLI rejects malformed findings without echoing private evidence", () => {
  const result = run([finding("A", { revision: "" })]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /revision must be a non-empty string/);
  assert.equal(result.stderr.includes("Private review proof"), false);
});

test("CLI bounds optional provider input and reports advice without removing findings", () => {
  const preload = `globalThis.fetch = async (_url, init) => {
    const { state } = JSON.parse(init.body);
    if (state.findingA.summary.length !== 240 || state.findingA.evidence.length !== 800) throw new Error('unbounded');
    return Response.json({ answers: { same_finding: { noul: 0.93 } }, model: 'synthetic', usage: { input_tokens: 31, output_tokens: 2 } });
  };`;
  const result = run([
    finding("A", { summary: "a".repeat(260), evidence: "b".repeat(820) }),
    finding("B", { summary: "A differently worded finding" }),
    finding("C", { file: "lib/other.ts" }),
  ], ["--jev"], preload);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputCount, 3);
  assert.equal(report.jev.requestCount, 1);
  assert.deepEqual(report.jev.usage, { inputTokens: 31, outputTokens: 2 });
  assert.deepEqual(report.semanticJudgments[0].ids, ["A", "B"]);
  assert.equal(report.semanticJudgments[0].action, "review_possible_duplicate_bounded_evidence");
});

test("CLI retains uncertain and failed provider judgments and stops after eight pairs", () => {
  const preload = `let calls = 0; globalThis.fetch = async () => {
    if (++calls === 1) return Response.json({ answers: { same_finding: { noul: 0.71 } } });
    throw new Error('synthetic transport failure');
  };`;
  const result = run(Array.from({ length: 6 }, (_, i) => finding(String(i), { summary: `Finding ${i}` })), ["--jev"], preload);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputCount, 6);
  assert.equal(report.jev.requestCount, 8);
  assert.equal(report.jev.pairLimitReached, true);
  assert.equal(report.jev.usage, null);
  assert.equal(report.semanticJudgments[0].action, "retain_uncertain");
  assert.ok(report.semanticJudgments.slice(1).every((row) => row.action === "retain_failed"));
});

test("CLI keeps malformed probabilities and different severity findings separate", () => {
  const preload = `globalThis.fetch = async () => Response.json({ answers: { same_finding: { noul: 1.1 } } });`;
  const result = run([
    finding("A", { severity: "P1" }),
    finding("B", { severity: "P1", summary: "Different" }),
    finding("C", { severity: "P2", summary: "Another" }),
  ], ["--jev"], preload);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.jev.requestCount, 1);
  assert.equal(report.semanticJudgments[0].action, "retain_failed");
  assert.equal(report.semanticJudgments[0].probability, null);
  assert.equal(report.jev.usage, null);
});
