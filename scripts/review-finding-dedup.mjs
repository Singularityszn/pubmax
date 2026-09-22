#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const MAX_JEV_PAIRS = 8;
export const MAX_SUMMARY_CHARS = 240;
export const MAX_EVIDENCE_CHARS = 800;

const JEV_TIMEOUT_MS = 5_000;
const SUGGESTION_THRESHOLD = 0.9;
const PROMPT_VERSION = "review-duplicate-v1";
const MAX_FILE_CHARS = 500;
const MAX_REVISION_CHARS = 200;
const REQUIRED_FIELDS = ["id", "file", "summary", "evidence", "revision"];

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

function exactKey(finding) {
  const content = Object.fromEntries(Object.entries(finding).filter(([key]) => key !== "id"));
  return JSON.stringify(canonicalValue(content));
}

function validateFindings(findings) {
  if (!Array.isArray(findings)) throw new Error("input must be a JSON list");

  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error(`finding ${index + 1} must be an object`);
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof finding[field] !== "string" || finding[field].trim() === "") {
        throw new Error(`finding ${index + 1} ${field} must be a non-empty string`);
      }
    }
    if (finding.file.length > MAX_FILE_CHARS) {
      throw new Error(`finding ${index + 1} file exceeds ${MAX_FILE_CHARS} characters`);
    }
    if (finding.revision.length > MAX_REVISION_CHARS) {
      throw new Error(`finding ${index + 1} revision exceeds ${MAX_REVISION_CHARS} characters`);
    }
    for (const field of ["severity", "category"]) {
      if (finding[field] !== undefined && (typeof finding[field] !== "string" || finding[field].length > 100)) {
        throw new Error(`finding ${index + 1} ${field} must be a string of at most 100 characters when present`);
      }
    }
    if (ids.has(finding.id)) throw new Error(`finding id ${finding.id} is duplicated`);
    ids.add(finding.id);
  }
}

function exactDuplicateGroups(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = exactKey(finding);
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      ids: group.map(({ id }) => id),
      file: group[0].file,
      revision: group[0].revision,
      action: "review_only",
    }));
}

function candidatePairs(findings) {
  const byExactKey = new Map();
  for (const finding of findings) {
    const key = exactKey(finding);
    if (!byExactKey.has(key)) byExactKey.set(key, finding);
  }
  const representatives = [...byExactKey.values()];
  const pairs = [];
  for (let left = 0; left < representatives.length; left += 1) {
    for (let right = left + 1; right < representatives.length; right += 1) {
      const findingA = representatives[left];
      const findingB = representatives[right];
      if (findingA.file !== findingB.file || findingA.revision !== findingB.revision) continue;
      if (findingA.severity !== findingB.severity || findingA.category !== findingB.category) continue;
      if (exactKey(findingA) === exactKey(findingB)) continue;
      if (pairs.length === MAX_JEV_PAIRS) return { pairs, pairLimitReached: true };
      pairs.push([findingA, findingB]);
    }
  }
  return { pairs, pairLimitReached: false };
}

function judgmentState(findingA, findingB) {
  const bound = (finding) => {
    const summaryTruncated = finding.summary.length > MAX_SUMMARY_CHARS;
    const evidenceTruncated = finding.evidence.length > MAX_EVIDENCE_CHARS;
    return {
      file: finding.file,
      revision: finding.revision,
      summary: finding.summary.slice(0, MAX_SUMMARY_CHARS),
      evidence: finding.evidence.slice(0, MAX_EVIDENCE_CHARS),
      summaryTruncated,
      evidenceTruncated,
      ...(finding.severity === undefined ? {} : { severity: finding.severity }),
      ...(finding.category === undefined ? {} : { category: finding.category }),
    };
  };
  return { findingA: bound(findingA), findingB: bound(findingB) };
}

function stateWasTruncated(state) {
  return (
    state.findingA.summaryTruncated ||
    state.findingA.evidenceTruncated ||
    state.findingB.summaryTruncated ||
    state.findingB.evidenceTruncated
  );
}

async function judgeWithJev(state) {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new Error("--jev requires TYPESAFE_API_KEY");

  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions: {
        same_finding: {
          type: "noul",
          instructions:
            "Do `findingA` and `findingB` describe the same underlying defect, such that showing both would be redundant in a human code review?",
          criteria: {
            true: "Same defect, cause, and impact, even if wording differs.",
            false: "Distinct defect, cause, or impact. Related findings still count as distinct.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`TypeSafe request failed with HTTP ${response.status}`);
  const body = await response.json();
  const probability = body?.answers?.same_finding?.noul;
  if (typeof probability !== "number" || probability < 0 || probability > 1) {
    throw new Error("TypeSafe response omitted a valid same_finding probability");
  }
  const inputTokens = body?.usage?.input_tokens;
  const outputTokens = body?.usage?.output_tokens;
  const usage =
    Number.isInteger(inputTokens) && Number.isInteger(outputTokens)
      ? { inputTokens, outputTokens }
      : null;
  return {
    probability,
    model: typeof body.model === "string" ? body.model : null,
    usage,
  };
}

export async function analyseReviewFindings(findings, options = {}) {
  validateFindings(findings);
  if (options.jev && !options.judge && !process.env.TYPESAFE_API_KEY?.trim()) {
    throw new Error("--jev requires TYPESAFE_API_KEY");
  }
  const exactGroups = exactDuplicateGroups(findings);
  const candidates = candidatePairs(findings);
  const report = {
    inputCount: findings.length,
    mode: options.jev ? "jev" : "offline",
    exactDuplicateGroups: exactGroups,
    semanticJudgments: [],
    jev: {
      promptVersion: PROMPT_VERSION,
      pairLimit: MAX_JEV_PAIRS,
      pairLimitReached: candidates.pairLimitReached,
      requestCount: 0,
      model: null,
      usage: null,
    },
  };
  if (!options.jev) return report;

  const judge = options.judge ?? judgeWithJev;
  let model = null;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let usageComplete = true;

  for (const [findingA, findingB] of candidates.pairs) {
    report.jev.requestCount += 1;
    const state = judgmentState(findingA, findingB);
    const inputTruncated = stateWasTruncated(state);
    try {
      const result = await judge(state);
      if (
        !Number.isFinite(result.probability) ||
        result.probability < 0 ||
        result.probability > 1
      ) {
        throw new Error("invalid Jev probability");
      }
      model ??= result.model ?? null;
      if (result.usage) {
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
      } else {
        usageComplete = false;
      }
      report.semanticJudgments.push({
        ids: [findingA.id, findingB.id],
        file: findingA.file,
        revision: findingA.revision,
        probability: result.probability,
        inputTruncated,
        action:
          result.probability >= SUGGESTION_THRESHOLD
            ? inputTruncated
              ? "review_possible_duplicate_bounded_evidence"
              : "review_possible_duplicate"
            : "retain_uncertain",
      });
    } catch {
      usageComplete = false;
      report.semanticJudgments.push({
        ids: [findingA.id, findingB.id],
        file: findingA.file,
        revision: findingA.revision,
        probability: null,
        inputTruncated,
        action: "retain_failed",
      });
    }
  }

  report.jev.model = model;
  report.jev.usage = report.jev.requestCount > 0 && usageComplete ? usage : null;
  return report;
}

function usage() {
  return "Usage: node scripts/review-finding-dedup.mjs <findings.json> [--jev]";
}

async function main() {
  const args = process.argv.slice(2);
  const jev = args.includes("--jev");
  const paths = args.filter((arg) => arg !== "--jev");
  if (paths.length !== 1) throw new Error(usage());

  let findings;
  try {
    findings = JSON.parse(await readFile(paths[0], "utf8"));
  } catch {
    throw new Error("input is not readable valid JSON");
  }
  const report = await analyseReviewFindings(findings, { jev });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`review-finding-dedup: ${error.message}\n`);
    process.exitCode = 1;
  });
}
