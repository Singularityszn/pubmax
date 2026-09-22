import assert from "node:assert/strict";
import test from "node:test";

import {
  analyseReviewFindings,
  MAX_EVIDENCE_CHARS,
  MAX_JEV_PAIRS,
  MAX_SUMMARY_CHARS,
} from "../scripts/review-finding-dedup.mjs";

function finding(id, overrides = {}) {
  return {
    id,
    file: "lib/example.ts",
    summary: "Missing authorization check",
    evidence: "The update path accepts an unrelated account identifier.",
    revision: "abc123",
    ...overrides,
  };
}

test("reports exact duplicates without dropping records", async () => {
  const findings = [
    finding("A"),
    finding("B"),
    finding("C", { severity: "P1" }),
    finding("D", { category: "security" }),
    finding("E", { evidence: "A different proof." }),
  ];

  const report = await analyseReviewFindings(findings);

  assert.deepEqual(report.exactDuplicateGroups, [
    {
      ids: ["A", "B"],
      file: "lib/example.ts",
      revision: "abc123",
      action: "review_only",
    },
  ]);
  assert.equal(report.inputCount, findings.length);
  assert.equal(report.mode, "offline");
  assert.equal(report.jev.requestCount, 0);
  assert.equal(report.jev.usage, null);
  assert.deepEqual(findings.map(({ id }) => id), ["A", "B", "C", "D", "E"]);
});

test("rejects malformed normalized findings", async () => {
  await assert.rejects(
    analyseReviewFindings([finding("A", { revision: "" })]),
    /finding 1 revision must be a non-empty string/,
  );
  await assert.rejects(
    analyseReviewFindings([finding("A"), finding("A", { summary: "Different" })]),
    /finding id A is duplicated/,
  );
});

test("rejects oversized metadata before requesting a judgment", async () => {
  let called = false;
  await assert.rejects(
    analyseReviewFindings([finding("A", { category: "x".repeat(101) })], {
      jev: true,
      judge: async () => { called = true; },
    }),
    /category must be a string of at most 100 characters/,
  );
  assert.equal(called, false);
});

test("Jev receives only bounded, same-file candidate pairs", async () => {
  const calls = [];
  const findings = [
    finding("A", {
      summary: "a".repeat(MAX_SUMMARY_CHARS + 20),
      evidence: "b".repeat(MAX_EVIDENCE_CHARS + 20),
    }),
    finding("B", { summary: "Authorization is missing" }),
    finding("C", { file: "lib/other.ts" }),
    finding("D", { revision: "different-revision" }),
  ];

  const report = await analyseReviewFindings(findings, {
    jev: true,
    judge: async (state) => {
      calls.push(state);
      return {
        probability: 0.93,
        model: "jev-test",
        usage: { inputTokens: 31, outputTokens: 2 },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].findingA.summary.length, MAX_SUMMARY_CHARS);
  assert.equal(calls[0].findingA.evidence.length, MAX_EVIDENCE_CHARS);
  assert.equal(calls[0].findingA.summaryTruncated, true);
  assert.equal(calls[0].findingA.evidenceTruncated, true);
  assert.equal(calls[0].findingB.summaryTruncated, false);
  assert.equal(calls[0].findingB.evidenceTruncated, false);
  assert.equal(calls[0].findingB.file, calls[0].findingA.file);
  assert.deepEqual(report.semanticJudgments, [
    {
      ids: ["A", "B"],
      file: "lib/example.ts",
      revision: "abc123",
      probability: 0.93,
      model: "jev-test",
      inputTruncated: true,
      action: "review_possible_duplicate_bounded_evidence",
    },
  ]);
  assert.deepEqual(report.jev, {
    promptVersion: "review-duplicate-v1",
    pairLimit: MAX_JEV_PAIRS,
    pairLimitReached: false,
    requestCount: 1,
    models: ["jev-test"],
    usage: { inputTokens: 31, outputTokens: 2 },
  });
});

test("default Jev transport uses the shared TypeSafe door", async () => {
  const calls = [];
  const report = await analyseReviewFindings(
    [finding("A"), finding("B", { summary: "Authorization guard is absent" })],
    {
      jev: true,
      systemOne: async (state, questions, options) => {
        calls.push({ state, questions, options });
        return {
          model: "jev-shared-door",
          usage: { input_tokens: 7, output_tokens: 2 },
          answers: { same_finding: { noul: 0.94 } },
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions), ["same_finding"]);
  assert.deepEqual(calls[0].options, {
    lane: "review-finding-dedup",
    timeoutMs: 5_000,
    logDestination: "stderr",
  });
  assert.equal(calls[0].state.findingA.evidence, finding("A").evidence);
  assert.equal(report.semanticJudgments[0].model, "jev-shared-door");
  assert.deepEqual(report.jev.models, ["jev-shared-door"]);
});

test("attributes every semantic judgment to its actual model", async () => {
  const models = ["jev-2026-09-22-a", "jev-2026-09-22-b", "jev-2026-09-22-a"];
  const report = await analyseReviewFindings(
    [
      finding("A"),
      finding("B", { summary: "Authorization guard is absent" }),
      finding("C", { summary: "Unrelated authorization wording" }),
    ],
    {
      jev: true,
      judge: async () => ({
        probability: 0.95,
        model: models.shift(),
        usage: { inputTokens: 3, outputTokens: 1 },
      }),
    },
  );

  assert.deepEqual(
    report.semanticJudgments.map(({ model }) => model),
    ["jev-2026-09-22-a", "jev-2026-09-22-b", "jev-2026-09-22-a"],
  );
  assert.deepEqual(report.jev.models, ["jev-2026-09-22-a", "jev-2026-09-22-b"]);
});

test("uncertain and failed judgments retain both findings", async () => {
  const findings = Array.from({ length: 6 }, (_, index) =>
    finding(String(index), { summary: `Finding ${index}` }),
  );
  let call = 0;

  const report = await analyseReviewFindings(findings, {
    jev: true,
    judge: async () => {
      call += 1;
      if (call === 1) return { probability: 0.71, model: "jev-test", usage: null };
      throw new Error("synthetic failure");
    },
  });

  assert.equal(report.jev.requestCount, MAX_JEV_PAIRS);
  assert.equal(report.jev.pairLimitReached, true);
  assert.equal(report.jev.usage, null);
  assert.equal(report.semanticJudgments[0].action, "retain_uncertain");
  assert.ok(report.semanticJudgments.slice(1).every(({ action }) => action === "retain_failed"));
});

test("malformed API probabilities retain both findings", async () => {
  const probabilities = [Number.NaN, 1.1, -0.1];
  const report = await analyseReviewFindings(
    [finding("A"), finding("B", { summary: "Different" }), finding("C", { summary: "Third" })],
    {
      jev: true,
      judge: async () => ({
        probability: probabilities.shift(),
        model: "jev-test",
        usage: { inputTokens: 3, outputTokens: 1 },
      }),
    },
  );

  assert.ok(report.semanticJudgments.every(({ action }) => action === "retain_failed"));
  assert.ok(report.semanticJudgments.every(({ probability }) => probability === null));
  assert.equal(report.jev.usage, null);
});

test("uses one representative from an exact group for Jev candidates", async () => {
  const findings = [
    finding("A"),
    finding("B"),
    finding("C", { summary: "Authorization guard is absent" }),
  ];
  let calls = 0;

  const report = await analyseReviewFindings(findings, {
    jev: true,
    judge: async () => {
      calls += 1;
      return { probability: 0.92, model: "jev-test", usage: null };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(report.exactDuplicateGroups[0].ids, ["A", "B"]);
  assert.deepEqual(report.semanticJudgments[0].ids, ["A", "C"]);
});

test("different severity or category is retained without a Jev call", async () => {
  const findings = [
    finding("A", { severity: "P1", category: "quality" }),
    finding("B", { severity: "P2", category: "quality", summary: "Different wording" }),
    finding("C", { severity: "P1", category: "security", summary: "Another wording" }),
  ];
  let calls = 0;

  const report = await analyseReviewFindings(findings, {
    jev: true,
    judge: async () => {
      calls += 1;
      return { probability: 1, model: "jev-test", usage: null };
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(report.semanticJudgments, []);
  assert.equal(report.jev.requestCount, 0);
  assert.equal(report.jev.usage, null);
});
